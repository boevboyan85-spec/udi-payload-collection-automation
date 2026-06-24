import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

import { formatDocumentHasFocusForCsv } from "./documentFocus.js";

/** @type {readonly string[]} */
const HEADERS = [
  "type",
  "browser",
  "headless",
  "stealth",
  "payload",
  "documentHasFocus",
  "documentVisibility",
];

const HEADER_LINE = HEADERS.join(",");

function formatBooleanForCsv(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === "true" || value === "false") return value;
  return value == null ? "" : String(value);
}

function escapeCsvField(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToLine(row) {
  return [
    escapeCsvField(row.type),
    escapeCsvField(row.browser),
    escapeCsvField(formatBooleanForCsv(row.headless)),
    escapeCsvField(formatBooleanForCsv(row.stealth)),
    escapeCsvField(row.payload),
    escapeCsvField(formatDocumentHasFocusForCsv(row.documentHasFocus)),
    escapeCsvField(row.documentVisibility ?? ""),
  ].join(",");
}

/**
 * Rewrites payloads.csv to the current schema (6 columns) when the header row differs.
 * @param {string} filePath
 */
function migratePayloadsCsvIfNeeded(filePath) {
  if (!fs.existsSync(filePath)) return;
  let raw = fs.readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const trimmed = raw.trim();
  if (!trimmed) return;
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine === HEADER_LINE) return;
  if (!/^(bot|type)\s*,/i.test(firstLine)) return;

  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  const lines = [HEADER_LINE];
  for (const row of rows) {
    lines.push(
      rowToLine({
        type: row.type ?? row.bot,
        browser: row.browser,
        headless: row.headless,
        stealth: row.stealth,
        payload: row.payload,
        documentHasFocus: row.documentHasFocus,
        documentVisibility: row.documentVisibility,
      })
    );
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

export { isFirefoxAvailable as firefoxExecutableOnPath } from "./browserBinaries.js";

/**
 * Appends one row; writes UTF-8 header row if the file does not exist yet.
 * @param {string} filePath - absolute or cwd-relative path
 * @param {{ type: string, browser: string, headless: boolean|string, stealth?: boolean|string, payload: string, documentHasFocus?: boolean|string, documentVisibility?: string }} row
 */
export function appendPayloadRow(filePath, row) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(filePath)) {
    migratePayloadsCsvIfNeeded(filePath);
    const firstLine =
      fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (
      /^(bot|type)\s*,/i.test(firstLine) &&
      (!/\bheadless\b/i.test(firstLine) || !/\bdocumentHasFocus\b/i.test(firstLine))
    ) {
      throw new Error(
        "CSV uses an old schema (missing headless and/or document focus columns). Delete or rename the file, then run again."
      );
    }
  }
  const docFocus = row.documentHasFocus;
  const docVis = row.documentVisibility ?? "";
  const line =
    [
      escapeCsvField(row.type),
      escapeCsvField(row.browser),
      escapeCsvField(formatBooleanForCsv(row.headless)),
      escapeCsvField(formatBooleanForCsv(row.stealth)),
      escapeCsvField(row.payload),
      escapeCsvField(formatDocumentHasFocusForCsv(docFocus)),
      escapeCsvField(docVis),
    ].join(",") + "\n";
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, HEADER_LINE + "\n" + line, "utf8");
  } else {
    fs.appendFileSync(filePath, line, "utf8");
  }
}
