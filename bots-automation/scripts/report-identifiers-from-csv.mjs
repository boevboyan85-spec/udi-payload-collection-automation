/**
 * Reads results/payloads.csv and writes a **transposed** Markdown table:
 * - **Columns:** one per CSV row (each automation run).
 * - **Rows:** `type`, `browser`, `headless`, then `header - <key>` for every HTTP header key seen,
 *   then `payload - <taskName>` for every JSC task name seen (plain text cells; objects as JSON).
 *
 * Env: `CSV_INPUT`, `IDENTIFIERS_REPORT_MD`, `IDENTIFIERS_REPORT_JSON`, `IDENTIFIERS_CELL_MAX_CHARS`.
 */
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

import {
  CSV_INPUT,
  IDENTIFIERS_CELL_MAX_CHARS,
  IDENTIFIERS_REPORT_JSON,
  IDENTIFIERS_REPORT_MD,
  PROJECT_ROOT,
  resolveProjectPath,
} from "../src/env.js";
import {
  decompressUdiPayload,
  extractEncodedUdiFromCollectorPayload,
} from "../src/udiDecompress.js";

const CSV_PATH = resolveProjectPath(CSV_INPUT);
const REPORT_MD = resolveProjectPath(IDENTIFIERS_REPORT_MD);
const REPORT_JSON = resolveProjectPath(IDENTIFIERS_REPORT_JSON);
const CELL_MAX_CHARS = Math.max(0, IDENTIFIERS_CELL_MAX_CHARS);

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

function parseJsonObject(value) {
  if (value == null || !String(value).trim()) return {};
  try {
    const o = JSON.parse(String(value));
    return o && typeof o === "object" && !Array.isArray(o) ? { ...o } : {};
  } catch {
    return {};
  }
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

function taskFieldToReportString(value) {
  if (value === undefined) return "";
  return valueToReportString(value);
}

/**
 * @returns {{ tasks: { name: string, value: string, error: string }[], error: string | null }}
 */
function decodeTasksFromPayloadCell(payloadCell) {
  const encoded = extractEncodedUdiFromCollectorPayload(String(payloadCell ?? ""));
  if (!encoded) {
    return {
      tasks: [],
      error: "empty inner UDI / payload",
    };
  }
  try {
    const taskResults = decompressUdiPayload(encoded);
    if (!Array.isArray(taskResults)) {
      return {
        tasks: [],
        error: "decompressed JSON is not an array",
      };
    }
    const tasks = [];
    for (const item of taskResults) {
      if (!item || typeof item.name !== "string") continue;
      const errRaw = item.error;
      tasks.push({
        name: item.name,
        value: taskFieldToReportString(item.data),
        error:
          errRaw === undefined || errRaw === null || errRaw === ""
            ? ""
            : taskFieldToReportString(errRaw),
      });
    }
    return {
      tasks,
      error: null,
    };
  } catch (e) {
    return {
      tasks: [],
      error: e.message || String(e),
    };
  }
}

function normalizeHeadlessCell(v) {
  if (v === true || v === "true") return "true";
  if (v === false || v === "false") return "false";
  const s = String(v ?? "").trim();
  return s || "—";
}

function escCell(s) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function mdCell(s) {
  const t = s == null ? "" : String(s);
  const cut =
    CELL_MAX_CHARS > 0 && t.length > CELL_MAX_CHARS
      ? t.slice(0, CELL_MAX_CHARS) + "… (truncated)"
      : t;
  return escCell(cut);
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
    lines.push(
      `| ${headers.map(() => "—").join(" | ")} |`
    );
    return lines;
  }
  for (const row of bodyRows) {
    const padded = headers.map((_, i) => mdCell(row[i] ?? ""));
    lines.push(`| ${padded.join(" | ")} |`);
  }
  return lines;
}

/**
 * @returns {Record<string, unknown> | null}
 */
function rawHeadersObjectFromPayloadCell(payloadCell) {
  const parsed = parseJsonObject(payloadCell);
  const h = parsed.headers;
  if (h == null || typeof h !== "object" || Array.isArray(h)) return null;
  return /** @type {Record<string, unknown>} */ ({ ...h });
}

/**
 * Table cell text: strings as-is (no JSON quote wrapping); objects/arrays via JSON.stringify.
 * @param {unknown} value
 */
function displayCell(value) {
  if (value === undefined) {
    return "—";
  }
  return mdCell(valueToReportString(value));
}

/**
 * First occurrence wins per task name.
 * @param {{ name: string, value: string, error: string }[]} tasks
 * @returns {Map<string, { name: string, value: string, error: string }>}
 */
function taskMapFirstWins(tasks) {
  const m = new Map();
  for (const t of tasks) {
    if (!m.has(t.name)) {
      m.set(t.name, t);
    }
  }
  return m;
}

/**
 * @param {{ value: string, error: string } | undefined} t
 */
function payloadTaskCell(t) {
  if (!t) return "—";
  let combined = t.value;
  if (t.error) {
    combined = combined
      ? `${combined} [task error: ${t.error}]`
      : t.error;
  }
  return displayCell(combined);
}

/**
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

  const headerKeys = new Set();
  const taskNames = new Set();
  for (const r of reportRows) {
    const h = r.headersObject;
    if (h && typeof h === "object") {
      for (const k of Object.keys(h)) {
        headerKeys.add(k);
      }
    }
    for (const t of r.tasksOrdered) {
      taskNames.add(t.name);
    }
  }
  const headerKeysSorted = [...headerKeys].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
  const taskNamesSorted = [...taskNames].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );

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

  for (const key of headerKeysSorted) {
    body.push([
      `header - ${key}`,
      ...reportRows.map((r) => {
        const h = r.headersObject;
        if (!h || !(key in h)) return "—";
        return displayCell(h[key]);
      }),
    ]);
  }

  const maps = reportRows.map((r) => ({
    decodeError: r.decodeError,
    byName: taskMapFirstWins(r.tasksOrdered),
  }));

  for (const name of taskNamesSorted) {
    body.push([
      `payload - ${name}`,
      ...maps.map((m) => {
        if (m.decodeError) {
          return displayCell(m.decodeError);
        }
        const t = m.byName.get(name);
        if (!t) return "—";
        return payloadTaskCell(t);
      }),
    ]);
  }

  return markdownTable(tableHeaders, body);
}

function main() {
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
    const decoded = decodeTasksFromPayloadCell(payload);
    const tasks = decoded.tasks;

    reportRows.push({
      type,
      browser,
      headless,
      headersObject: rawHeadersObjectFromPayloadCell(payload),
      tasksOrdered: tasks,
      decodeError: decoded.error,
    });
  }

  const lines = [
    "# Identifiers report (cases as columns)",
    "",
    `Generated from \`${path.relative(PROJECT_ROOT, CSV_PATH)}\`.`,
    "",
    "Each **column** is one CSV row (run). Each **row** is `type`, `browser`, `headless`, then `header - …` for each HTTP header key (union across runs), then `payload - …` for each JSC task name (union). String values are plain text (no extra quote marks). Object/array payload values are JSON. Missing keys show **—**. Decode failures put the error message in every payload row for that column.",
    "",
    `Long Markdown cells are truncated to ${CELL_MAX_CHARS} characters (see \`IDENTIFIERS_CELL_MAX_CHARS\`). **${path.basename(REPORT_JSON)}** has full raw rows.`,
    "",
    ...buildTransposedMarkdownRows(reportRows),
    "",
  ];

  fs.writeFileSync(REPORT_MD, lines.join("\n"), "utf8");
  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
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

main();
