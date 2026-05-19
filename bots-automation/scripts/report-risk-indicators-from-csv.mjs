/**
 * Reads results/payloads.csv, POSTs each row to the risk service (same body as `report-risk-from-csv.mjs`),
 * and writes a **transposed** Markdown table like `report-identifiers-from-csv.mjs`:
 * columns = one run, rows = `type`, `browser`, `headless`, CSV focus columns, then one row per
 * **risk indicator** (`category` + `name`) with the signal **value** only (no reasons).
 *
 * Env: `CSV_INPUT`, `RISK_SERVICE_URL`, `RISK_REQUEST_IP`, `RISK_HTTP_HEADERS_JSON`,
 * `RISK_INDICATORS_REPORT_MD`, `RISK_INDICATORS_REPORT_JSON`, `RISK_INDICATORS_CELL_MAX_CHARS`.
 */
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import {
  CSV_INPUT,
  PROJECT_ROOT,
  RISK_INDICATORS_CELL_MAX_CHARS,
  RISK_INDICATORS_REPORT_JSON,
  RISK_INDICATORS_REPORT_MD,
  RISK_REQUEST_IP,
  RISK_SERVICE_URL,
  resolveProjectPath,
} from "../src/env.js";
import { extractEncodedUdiFromCollectorPayload } from "../src/udiDecompress.js";

const RISK_URL = RISK_SERVICE_URL;
const CSV_PATH = resolveProjectPath(CSV_INPUT);
const REPORT_MD = resolveProjectPath(RISK_INDICATORS_REPORT_MD);
const REPORT_JSON = resolveProjectPath(RISK_INDICATORS_REPORT_JSON);
const REQUEST_IP = RISK_REQUEST_IP;
const CELL_MAX_CHARS = Math.max(0, RISK_INDICATORS_CELL_MAX_CHARS);

function parseCsvRows(content) {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  const first = lines[0];
  const hasHeader =
    /^(bot|type)\s*,/i.test(first) &&
    first.toLowerCase().includes("browser") &&
    first.toLowerCase().includes("payload");

  if (hasHeader) {
    return parse(trimmed, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });
  }
  return parse(trimmed, {
    columns: ["type", "browser", "payload", "userAgent"],
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

function normalizeHeadlessCell(v) {
  if (v === true || v === "true") return "true";
  if (v === false || v === "false") return "false";
  const s = String(v ?? "").trim();
  return s || "—";
}

function normalizeDocumentHasFocusCell(v) {
  if (v === true || v === "true") return "true";
  if (v === false || v === "false") return "false";
  const s = String(v ?? "").trim();
  return s || "—";
}

function normalizeDocumentVisibilityCell(v) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function parseJsonObject(value) {
  if (value == null || !String(value).trim()) return {};
  try {
    const o = JSON.parse(String(value));
    return o && typeof o === "object" && !Array.isArray(o) ? { ...o } : {};
  } catch {
    return {};
  }
}

function mergeRiskHttpHeadersFromPayload(payloadCell) {
  const fromEnv = parseJsonObject(process.env.RISK_HTTP_HEADERS_JSON);
  const parsed = parseJsonObject(payloadCell);
  const fromPayload =
    parsed.headers != null &&
    typeof parsed.headers === "object" &&
    !Array.isArray(parsed.headers)
      ? { ...parsed.headers }
      : {};
  const ua = String(
    fromEnv["user-agent"] ??
      fromEnv["User-Agent"] ??
      fromPayload["user-agent"] ??
      fromPayload["User-Agent"] ??
      ""
  );
  return {
    ...fromPayload,
    ...fromEnv,
    "user-agent": ua,
  };
}

function signalValueToString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.name) return v.name;
  return String(v);
}

/**
 * @param {unknown} json
 * @returns {Record<string, unknown>[]}
 */
function extractAllSignals(json) {
  if (json == null) return [];
  if (typeof json !== "object") return [];
  const raw =
    "signals" in /** @type {Record<string, unknown>} */ (json) &&
    Array.isArray(/** @type {Record<string, unknown>} */ (json).signals)
      ? /** @type {Record<string, unknown>} */ (json).signals
      : Array.isArray(json)
        ? json
        : [];
  return /** @type {Record<string, unknown>[]} */ (raw);
}

function escCell(s) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function valueToReportString(value) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function mdCell(s) {
  const t = s == null ? "" : String(s);
  const cut =
    CELL_MAX_CHARS > 0 && t.length > CELL_MAX_CHARS
      ? t.slice(0, CELL_MAX_CHARS) + "… (truncated)"
      : t;
  return escCell(cut);
}

function displayCell(value) {
  if (value === undefined) {
    return "—";
  }
  return mdCell(valueToReportString(value));
}

/**
 * @param {string[]} headers
 * @param {string[][]} bodyRows
 * @returns {string[]}
 */
function markdownTable(headers, bodyRows) {
  const lines = [
    `| ${headers.map(escCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  if (!bodyRows.length) {
    lines.push(`| ${headers.map(() => "—").join(" | ")} |`);
    return lines;
  }
  for (const row of bodyRows) {
    const padded = headers.map((_, i) => mdCell(row[i] ?? ""));
    lines.push(`| ${padded.join(" | ")} |`);
  }
  return lines;
}

/**
 * @param {Record<string, unknown>[]} signals
 * @param {string} normCategory
 * @param {string} name
 */
function findSignal(signals, normCategory, name) {
  return signals.find((s) => {
    const c = String(s.category ?? "")
      .trim()
      .toLowerCase();
    const n = String(s.name ?? "").trim();
    return c === normCategory && n === name;
  });
}

/**
 * @typedef {{ displayCategory: string, normCategory: string, name: string }} IndicatorMeta
 */

/**
 * @param {{ type: string, browser: string, headless: string, documentHasFocus: string, documentVisibility: string, ok: boolean, error: string | null, signals: Record<string, unknown>[] }[]} reportRows
 * @returns {string[]}
 */
function buildTransposedMarkdownRows(reportRows) {
  const n = reportRows.length;
  if (n === 0) {
    return markdownTable([""], [["— (no data rows)"]]);
  }

  const columnTitles = reportRows.map(
    (r) => `${r.type} / ${r.browser} / ${r.headless}`
  );

  /** @type {Map<string, IndicatorMeta>} */
  const indicatorKeys = new Map();

  for (const r of reportRows) {
    if (!r.ok) continue;
    for (const s of r.signals) {
      const name = String(s.name ?? "").trim();
      const dispCat = String(s.category ?? "").trim();
      const normCat = dispCat.toLowerCase();
      const id = `${normCat}|||${name}`;
      if (!indicatorKeys.has(id)) {
        indicatorKeys.set(id, {
          displayCategory: dispCat || "(no category)",
          normCategory: normCat,
          name,
        });
      }
    }
  }

  const sortedIds = [...indicatorKeys.keys()].sort((a, b) => {
    const A = indicatorKeys.get(a);
    const B = indicatorKeys.get(b);
    if (!A || !B) return 0;
    const c = A.normCategory.localeCompare(B.normCategory);
    if (c !== 0) return c;
    return A.name.localeCompare(B.name, "en", { sensitivity: "base" });
  });

  const tableHeaders = ["", ...columnTitles];
  /** @type {string[][]} */
  const body = [];

  body.push([
    "type",
    ...reportRows.map((r) => displayCell(r.type)),
  ]);
  body.push([
    "browser",
    ...reportRows.map((r) => displayCell(r.browser)),
  ]);
  body.push([
    "headless",
    ...reportRows.map((r) => displayCell(r.headless)),
  ]);
  body.push([
    "documentHasFocus (CSV)",
    ...reportRows.map((r) => displayCell(r.documentHasFocus)),
  ]);
  body.push([
    "documentVisibility (CSV)",
    ...reportRows.map((r) => displayCell(r.documentVisibility)),
  ]);

  for (const id of sortedIds) {
    const meta = indicatorKeys.get(id);
    if (!meta) continue;

    body.push([
      `risk - ${meta.displayCategory} - ${meta.name}`,
      ...reportRows.map((r) => {
        if (!r.ok) {
          return displayCell(r.error || "request failed");
        }
        const sig = findSignal(r.signals, meta.normCategory, meta.name);
        if (!sig) return "—";
        return displayCell(signalValueToString(sig.value));
      }),
    ]);
  }

  return markdownTable(tableHeaders, body);
}

async function postRisk(payloadCell) {
  const udiPayload = extractEncodedUdiFromCollectorPayload(
    String(payloadCell ?? "")
  );
  const body = {
    payload: udiPayload,
    httpHeaders: mergeRiskHttpHeadersFromPayload(payloadCell),
    ip: REQUEST_IP,
  };
  const res = await fetch(RISK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Correlation-Id": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
  return json;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("CSV not found:", CSV_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsvRows(raw);

  const reportRows = [];

  for (const row of rows) {
    const type = String((row.type ?? row.bot ?? "")).trim();
    const browser = (row.browser ?? "").trim();
    if (
      (type.toLowerCase() === "bot" || type.toLowerCase() === "type") &&
      browser.toLowerCase() === "browser"
    ) {
      continue;
    }
    const payload = row.payload ?? "";
    const headless = normalizeHeadlessCell(row.headless);
    const documentHasFocus = normalizeDocumentHasFocusCell(row.documentHasFocus);
    const documentVisibility = normalizeDocumentVisibilityCell(
      row.documentVisibility
    );

    /** @type {{ type: string, browser: string, headless: string, documentHasFocus: string, documentVisibility: string, ok: boolean, error: string | null, signals: Record<string, unknown>[] }} */
    const entry = {
      type,
      browser,
      headless,
      documentHasFocus,
      documentVisibility,
      ok: false,
      error: null,
      signals: [],
    };

    try {
      const json = await postRisk(payload);
      entry.signals = extractAllSignals(json);
      entry.ok = true;
    } catch (e) {
      entry.error = e.message || String(e);
    }
    reportRows.push(entry);
  }

  const lines = [
    "# Risk indicators report (all signals, cases as columns)",
    "",
    `Generated from \`${path.relative(PROJECT_ROOT, CSV_PATH)}\`.`,
    "",
    `Endpoint: \`${RISK_URL}\`. Request IP: \`${REQUEST_IP}\` (\`RISK_REQUEST_IP\`).`,
    "",
    "Each **column** is one CSV run. Each `risk - <category> - <name>` row is the signal **value** from the risk service (all categories; reasons are omitted). Failed requests put the error text in that column’s cells.",
    "",
    `Long Markdown cells are truncated to ${CELL_MAX_CHARS} characters (\`RISK_INDICATORS_CELL_MAX_CHARS\`). **${path.basename(REPORT_JSON)}** has full data.`,
    "",
    ...buildTransposedMarkdownRows(reportRows),
    "",
  ];

  fs.writeFileSync(REPORT_MD, lines.join("\n"), "utf8");
  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
        riskUrl: RISK_URL,
        requestIp: REQUEST_IP,
        csvPath: path.relative(PROJECT_ROOT, CSV_PATH),
        rows: reportRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("Wrote:", REPORT_MD);
  console.log("Wrote:", REPORT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
