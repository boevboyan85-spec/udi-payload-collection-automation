/**
 * Reads results/payloads.csv (type, browser, headless, payload, documentHasFocus, documentVisibility), calls the risk service
 * for each row like sample-risk-request.sh, and writes a markdown report of isBot signals.
 * The HTTP body `payload` is the inner base64 UDI (see `extractEncodedUdiFromCollectorPayload`), not the full collector JSON cell.
 * `documentHasFocus` / `documentVisibility` in the CSV are expected to match the decompressed JSC (see `src/udiDecompress.js`).
 * Emits one section per IS_BOT strategy (see `isBotStrategies.mjs`) plus the full isBot matrix.
 * Also writes `results/risk-report-isbot-matrix.md` (matrix only) for `npm run report:risk:isbot-matrix-pdf`.
 */
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import {
  BOT_BY_DOCUMENT_FOCUS_SIGNAL_NAME,
  IS_BOT_STRATEGY_SECTIONS,
  sortIsBotSignalColumnNames,
} from "./isBotStrategies.mjs";
import {
  CSV_INPUT,
  PROJECT_ROOT,
  RISK_REPORT_JSON,
  RISK_REPORT_MATRIX_MD,
  RISK_REPORT_MD,
  RISK_REQUEST_IP,
  RISK_SERVICE_URL,
  resolveProjectPath,
} from "../src/env.js";
import { normalizeRequestHeaders } from "../src/httpHeadersNormalize.js";
import { extractEncodedUdiFromCollectorPayload } from "../src/udiDecompress.js";

const RISK_URL = RISK_SERVICE_URL;
const CSV_PATH = resolveProjectPath(CSV_INPUT);
const REPORT_MD = resolveProjectPath(RISK_REPORT_MD);
const REPORT_JSON = resolveProjectPath(RISK_REPORT_JSON);
const REPORT_MATRIX_MD = resolveProjectPath(RISK_REPORT_MATRIX_MD);
const REQUEST_IP = RISK_REQUEST_IP;

/** Lowercase — compared against `(s.category || "").toLowerCase()` */
const IS_BOT_CATEGORY = "isbot";
const BROWSER_SPOOFING_CATEGORY = "browser spoofing";
const CANVAS_ANOMALY_SIGNAL_NAME = "Canvas anomaly";
const SERVICE_WORKER_ISBOT_SIGNAL_NAME = "Bot by service worker";
const SERVICE_WORKER_BROWSER_SPOOFING_SIGNAL_NAME = "Service worker";

const IS_BOT_REASON_ORDER = Object.fromEntries(
  IS_BOT_STRATEGY_SECTIONS.map((d, i) => [d.signalName, i])
);

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
  /* Legacy headerless rows: four columns without headless (headless shows as — in the report). */
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

function escCell(s) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** TRUE/FALSE only — inline HTML for PDF / Markdown preview (do not pass through escCell again). */
function escCellBoolColored(s) {
  const t = String(s ?? "").trim();
  const low = t.toLowerCase();
  const safe = escCell(t);
  if (low === "true") {
    return `<span style="color:#b91c1c;font-weight:600;">${safe}</span>`;
  }
  if (low === "false") {
    return `<span style="color:#15803d;font-weight:600;">${safe}</span>`;
  }
  return safe;
}

function signalValueToString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.name) return v.name;
  return String(v);
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

/** Builds request `httpHeaders` from the payload cell JSON (`headers` envelope) and `RISK_HTTP_HEADERS_JSON`. */
function mergeRiskHttpHeadersFromPayload(payloadCell) {
  const fromEnv = parseJsonObject(process.env.RISK_HTTP_HEADERS_JSON);
  const parsed = parseJsonObject(payloadCell);
  const fromPayload =
    parsed.headers != null &&
    typeof parsed.headers === "object" &&
    !Array.isArray(parsed.headers)
      ? normalizeRequestHeaders(
          /** @type {Record<string, unknown>} */ (parsed.headers)
        )
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
    ...normalizeRequestHeaders(fromEnv),
    "user-agent": ua,
  };
}

function userAgentFromPayloadCell(payloadCell) {
  const parsed = parseJsonObject(payloadCell);
  const fromPayload =
    parsed.headers != null &&
    typeof parsed.headers === "object" &&
    !Array.isArray(parsed.headers)
      ? parsed.headers
      : {};
  return String(fromPayload["user-agent"] ?? fromPayload["User-Agent"] ?? "");
}

async function postRisk(payloadCell) {
  /** Risk API expects base64 UDI, not the full collector textarea JSON envelope. */
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

function extractIsBotSignals(signals) {
  const list = Array.isArray(signals) ? signals : [];
  return list.filter((s) => (s.category || "").toLowerCase() === IS_BOT_CATEGORY);
}

function extractBrowserSpoofingCanvasAnomaly(signals) {
  const list = Array.isArray(signals) ? signals : [];
  const s = list.find(
    (x) =>
      x &&
      String(x.category || "")
        .trim()
        .toLowerCase() === BROWSER_SPOOFING_CATEGORY &&
      String(x.name || "").trim() === CANVAS_ANOMALY_SIGNAL_NAME
  );
  if (!s) return null;
  return {
    value: signalValueToString(s.value),
    reason: s.reason != null ? String(s.reason) : "",
  };
}

function extractBrowserSpoofingServiceWorker(signals) {
  const list = Array.isArray(signals) ? signals : [];
  const s = list.find(
    (x) =>
      x &&
      String(x.category || "")
        .trim()
        .toLowerCase() === BROWSER_SPOOFING_CATEGORY &&
      String(x.name || "").trim() === SERVICE_WORKER_BROWSER_SPOOFING_SIGNAL_NAME
  );
  if (!s) return null;
  return {
    value: signalValueToString(s.value),
    reason: s.reason != null ? String(s.reason) : "",
  };
}

/**
 * @param {unknown} isBotSignals
 * @param {string} signalName
 * @returns {{ value: string, reason: string } | null}
 */
function extractIsBotStrategySignal(isBotSignals, signalName) {
  const list = Array.isArray(isBotSignals) ? isBotSignals : [];
  const s = list.find((x) => x && x.name === signalName);
  if (!s) return null;
  return {
    value: signalValueToString(s.value),
    reason: s.reason != null ? String(s.reason) : "",
  };
}

function buildStrategySummaries(isBotSignals) {
  /** @type {Record<string, { value: string, reason: string } | null>} */
  const out = {};
  for (const def of IS_BOT_STRATEGY_SECTIONS) {
    out[def.signalName] = extractIsBotStrategySignal(
      isBotSignals,
      def.signalName
    );
  }
  return out;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("CSV not found:", CSV_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsvRows(raw);

  const reportRows = [];
  const allSignalNames = new Set();

  for (const def of IS_BOT_STRATEGY_SECTIONS) {
    allSignalNames.add(def.signalName);
  }

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
    const userAgent = userAgentFromPayloadCell(payload);
    const headless = normalizeHeadlessCell(row.headless);
    const documentHasFocus = normalizeDocumentHasFocusCell(row.documentHasFocus);
    const documentVisibility = normalizeDocumentVisibilityCell(row.documentVisibility);

    const entry = {
      type,
      browser,
      headless,
      documentHasFocus,
      documentVisibility,
      userAgent,
      ok: false,
      error: null,
      isBotSignals: [],
      browserSpoofingCanvasAnomaly: null,
      browserSpoofingServiceWorker: null,
      strategySummaries: {},
      botByDocumentFocusStrategy: null,
      rawResponse: null,
    };

    try {
      const json = await postRisk(payload);
      entry.rawResponse = json;
      const signals = json.signals ?? json;
      entry.browserSpoofingCanvasAnomaly =
        extractBrowserSpoofingCanvasAnomaly(signals);
      entry.browserSpoofingServiceWorker =
        extractBrowserSpoofingServiceWorker(signals);
      entry.isBotSignals = extractIsBotSignals(
        Array.isArray(signals) ? signals : []
      );
      entry.strategySummaries = buildStrategySummaries(entry.isBotSignals);
      entry.botByDocumentFocusStrategy =
        entry.strategySummaries[BOT_BY_DOCUMENT_FOCUS_SIGNAL_NAME] ?? null;
      entry.ok = true;
      for (const s of entry.isBotSignals) {
        if (s.name) allSignalNames.add(s.name);
      }
    } catch (e) {
      entry.error = e.message || String(e);
    }
    reportRows.push(entry);
  }

  const sortedNames = sortIsBotSignalColumnNames(allSignalNames);

  function displayIsBotMatrixColumn(name) {
    const n = String(name ?? "").trim();
    if (!n) return "";
    if (n === CANVAS_ANOMALY_SIGNAL_NAME) return "Browser spoofing: Canvas anomaly";
    if (n === SERVICE_WORKER_ISBOT_SIGNAL_NAME) return "Browser spoofing: Service worker";
    return `isBot: ${n}`;
  }

  const matrixHeader = [
    "type",
    "browser",
    "headless",
    ...sortedNames.map((n) => displayIsBotMatrixColumn(n)),
  ];
  const matrixSep = matrixHeader.map(() => "---");
  const lines = [
    "# Risk service report (isBot signals)",
    "",
    `Generated from \`${path.relative(PROJECT_ROOT, CSV_PATH)}\`.`,
    `Endpoint: \`${RISK_URL}\``,
    `Request IP: \`${REQUEST_IP}\` (override with RISK_REQUEST_IP).`,
    "",
    "Cell values are **signal value** (TRUE / FALSE / UNKNOWN / UNDEFINED).",
    "",
  ];

  for (const def of IS_BOT_STRATEGY_SECTIONS) {
    lines.push(`## ${def.signalName} (\`${def.strategyClass}\`)`);
    lines.push("");
    lines.push(def.description);
    lines.push("");
    if (def.signalName === BOT_BY_DOCUMENT_FOCUS_SIGNAL_NAME) {
      lines.push(
        "| type | browser | headless | CSV `documentHasFocus` | CSV `documentVisibility` | Signal value | Reason |"
      );
      lines.push(
        "| --- | --- | --- | --- | --- | --- | --- |"
      );
      for (const r of reportRows) {
        if (!r.ok) {
          lines.push(
            `| ${escCell(r.type)} | ${escCell(r.browser)} | ${escCell(r.headless)} | ${escCell(r.documentHasFocus)} | ${escCell(r.documentVisibility)} | — | ${escCell((r.error || "ERROR").slice(0, 200))} |`
          );
          continue;
        }
        const cell = r.strategySummaries[def.signalName];
        lines.push(
          `| ${escCell(r.type)} | ${escCell(r.browser)} | ${escCell(r.headless)} | ${escCell(r.documentHasFocus)} | ${escCell(r.documentVisibility)} | ${escCell(cell?.value ?? "—")} | ${escCell(cell?.reason ?? "—")} |`
        );
      }
    } else {
      lines.push("| type | browser | headless | Signal value | Reason |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const r of reportRows) {
        if (!r.ok) {
          lines.push(
            `| ${escCell(r.type)} | ${escCell(r.browser)} | ${escCell(r.headless)} | — | ${escCell((r.error || "ERROR").slice(0, 200))} |`
          );
          continue;
        }
        const cell = r.strategySummaries[def.signalName];
        lines.push(
          `| ${escCell(r.type)} | ${escCell(r.browser)} | ${escCell(r.headless)} | ${escCell(cell?.value ?? "—")} | ${escCell(cell?.reason ?? "—")} |`
        );
      }
    }
    lines.push("");
  }

  const matrixSectionLines = [
    "## All isBot signals (matrix)",
    "",
    "Columns follow the canonical IS_BOT order from `isBotStrategies.mjs`, then any extra `isBot` names returned by this service build (A–Z).",
    "isBot value cells use HTML so **TRUE** / **FALSE** render red / green in PDF (`md-to-pdf`) and Markdown preview.",
    "",
    `| ${matrixHeader.map(escCell).join(" | ")} |`,
    `| ${matrixSep.join(" | ")} |`,
  ];

  for (const r of reportRows) {
    if (!r.ok) {
      const errText = (r.error || "ERROR").slice(0, 800);
      const tail =
        sortedNames.length === 0
          ? []
          : [
              escCell(errText),
              ...Array(sortedNames.length - 1).fill("—").map(escCell),
            ];
      const row = `| ${[
        escCell(r.type),
        escCell(r.browser),
        escCell(r.headless),
        ...tail,
      ].join(" | ")} |`;
      matrixSectionLines.push(row);
      continue;
    }
    const byName = Object.fromEntries(
      r.isBotSignals.map((s) => [s.name, s])
    );
    const vals = sortedNames.map((name) => {
      if (name === CANVAS_ANOMALY_SIGNAL_NAME) {
        const v = r.browserSpoofingCanvasAnomaly?.value;
        if (!v) return "—";
        return escCellBoolColored(v);
      }
      if (name === SERVICE_WORKER_ISBOT_SIGNAL_NAME) {
        const v = r.browserSpoofingServiceWorker?.value;
        if (!v) return "—";
        return escCellBoolColored(v);
      }
      const s = byName[name];
      if (!s) return "—";
      return escCellBoolColored(signalValueToString(s.value));
    });
    matrixSectionLines.push(
      `| ${[
        escCell(r.type),
        escCell(r.browser),
        escCell(r.headless),
        ...vals,
      ].join(" | ")} |`
    );
  }

  lines.push(...matrixSectionLines);
  lines.push("");

  const matrixOnlyMd = [
    "# All isBot signals (matrix)",
    "",
    `Generated from \`${path.relative(PROJECT_ROOT, CSV_PATH)}\`.`,
    `Endpoint: \`${RISK_URL}\`.`,
    "",
    ...matrixSectionLines,
    "",
  ].join("\n");
  fs.writeFileSync(REPORT_MATRIX_MD, matrixOnlyMd, "utf8");

  lines.push("## Reasons (isBot signals only)");
  lines.push("");
  for (const r of reportRows) {
    if (!r.ok) {
      lines.push(
        `### ${escCell(r.type)} / ${escCell(r.browser)} (headless ${escCell(r.headless)}) — failed`
      );
      lines.push("");
      lines.push("```");
      lines.push(escCell(r.error));
      lines.push("```");
      lines.push("");
      continue;
    }
    lines.push(
      `### ${escCell(r.type)} / ${escCell(r.browser)} (headless ${escCell(r.headless)})`
    );
    lines.push("");
    lines.push("| Signal | Value | Reason |");
    lines.push("| --- | --- | --- |");
    const sortedForReasons = [...r.isBotSignals].sort((a, b) => {
      const an = a.name || "";
      const bn = b.name || "";
      const ia = IS_BOT_REASON_ORDER[an];
      const ib = IS_BOT_REASON_ORDER[bn];
      if (ia != null && ib != null) return ia - ib;
      if (ia != null) return -1;
      if (ib != null) return 1;
      return an.localeCompare(bn, "en");
    });
    for (const s of sortedForReasons) {
      lines.push(
        `| ${escCell(s.name)} | ${escCell(signalValueToString(s.value))} | ${escCell(s.reason)} |`
      );
    }
    lines.push("");
  }

  fs.writeFileSync(REPORT_MD, lines.join("\n"), "utf8");
  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
        riskUrl: RISK_URL,
        requestIp: REQUEST_IP,
        botByDocumentFocusSignalName: BOT_BY_DOCUMENT_FOCUS_SIGNAL_NAME,
        isBotStrategySections: IS_BOT_STRATEGY_SECTIONS,
        isBotSignalColumns: sortedNames,
        rows: reportRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("Wrote:", REPORT_MD);
  console.log("Wrote:", REPORT_MATRIX_MD);
  console.log("Wrote:", REPORT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
