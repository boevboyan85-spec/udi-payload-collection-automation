/**
 * Local static server for `collector-page/` with request header injection for index.html
 * (placeholder `__REQUEST_HEADERS_JSON__`) and JSON at `/__collector/request-headers.json`.
 */
import fs from "fs";
import http from "http";
import path from "path";

import { fileURLToPath } from "url";

import { COLLECTOR_HOST, COLLECTOR_PORT, COLLECTOR_ROOT, CSV_PATH } from "../src/env.js";
import { appendPayloadRow } from "../src/csvStore.js";
import { getDocumentFocusCsvColumnsFromEncodedUdi } from "../src/udiDecompress.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

let indexTemplate = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const csvAbsolute = path.resolve(PROJECT_ROOT, CSV_PATH);

function getIndexTemplate() {
  if (!indexTemplate) {
    indexTemplate = fs.readFileSync(path.join(COLLECTOR_ROOT, "index.html"), "utf8");
  }
  return indexTemplate;
}

function headerRecord(req) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function safeJoinUnderRoot(urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.join(COLLECTOR_ROOT, rel);
  if (!abs.startsWith(COLLECTOR_ROOT)) return null;
  return abs;
}

function readJsonBody(req, limitBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function inferBrowserLabelFromUserAgent(uaRaw) {
  const ua = String(uaRaw ?? "");
  if (/Edg\//.test(ua)) return "edge";
  if (/Brave\//.test(ua) || /brave/i.test(ua)) return "brave";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "chrome";
  if (/Firefox\//.test(ua)) return "firefox";
  // Safari UA also contains "Safari/" in Chrome; ensure not Chrome
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "safari";
  return "unknown";
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (pathname === "/__collector/request-headers.json") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(headerRecord(req)));
      return;
    }

    if (pathname === "/__collector/save-payload" && req.method === "POST") {
      readJsonBody(req)
        .then((body) => {
          const textarea = String(body?.textarea ?? "").trim();
          if (!textarea) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: "Missing textarea payload" }));
            return;
          }

          const { documentHasFocus, documentVisibility } =
            getDocumentFocusCsvColumnsFromEncodedUdi(textarea);
          const ua = req.headers["user-agent"] ?? "";
          const browser = inferBrowserLabelFromUserAgent(ua);

          appendPayloadRow(csvAbsolute, {
            type: "human",
            browser,
            headless: false,
            payload: textarea,
            documentHasFocus,
            documentVisibility,
          });

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              ok: true,
              csvPath: CSV_PATH,
              type: "human",
              browser,
            })
          );
        })
        .catch((e) => {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
        });
      return;
    }

    if (pathname === "/" || pathname === "/index.html") {
      const html = getIndexTemplate().replace(
        "__REQUEST_HEADERS_JSON__",
        JSON.stringify(headerRecord(req))
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    const filePath = safeJoinUnderRoot(pathname.slice(1) || "index.html");
    if (!filePath) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      fs.readFile(filePath, (e2, data) => {
        if (e2) {
          res.writeHead(500).end(String(e2.message));
          return;
        }
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
      });
    });
  } catch (e) {
    res.writeHead(500).end(String(e && e.message ? e.message : e));
  }
}

/**
 * @param {{ host?: string, port?: number }} [options]
 * @returns {Promise<{ baseUrl: string, host: string, port: number, close: () => Promise<void> }>}
 */
export function startCollectorServer(options = {}) {
  const host = options.host ?? COLLECTOR_HOST;
  const port = options.port ?? COLLECTOR_PORT;

  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve({
        baseUrl: `http://${host}:${port}/`,
        host,
        port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
