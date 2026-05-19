/**
 * Exports the main Markdown report tables under results/ to .xlsx workbooks.
 *
 * Inputs (defaults):
 * - results/risk-report-isbot-matrix.md   -> results/risk-report-isbot-matrix.xlsx
 * - results/risk-indicators-report.md    -> results/risk-indicators-report.xlsx
 * - results/identifiers-report.md        -> results/identifiers-report.xlsx
 */
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESULTS_DIR = path.join(PROJECT_ROOT, "results");

function stripBom(s) {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function htmlToPlainCell(s) {
  const t = String(s ?? "");
  // Common in isBot matrix: <span ...>TRUE</span>
  return t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?span\b[^>]*>/gi, "")
    .replace(/<\/?code\b[^>]*>/gi, "")
    .replace(/<\/?strong\b[^>]*>/gi, "")
    .replace(/<\/?em\b[^>]*>/gi, "")
    .trim();
}

function splitMdRow(line) {
  // Line looks like: | a | b \| c | d |
  const raw = line.trim();
  if (!raw.startsWith("|")) return null;
  const inner = raw.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  let esc = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells.map((c) => htmlToPlainCell(c.replace(/\\\|/g, "|")));
}

function isSeparatorRow(cells) {
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(String(c).trim()) || c === "");
}

function extractFirstMarkdownTable(md) {
  const lines = stripBom(md).split(/\r?\n/);
  const tableLines = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isTableLike = trimmed.startsWith("|") && trimmed.includes("|");
    if (!inTable) {
      if (isTableLike) {
        inTable = true;
        tableLines.push(line);
      }
      continue;
    }
    if (!isTableLike) break;
    tableLines.push(line);
  }

  const rows = [];
  for (const l of tableLines) {
    const cells = splitMdRow(l);
    if (!cells) continue;
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

function padToRect(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push("");
    return out;
  });
}

function writeXlsxFromMarkdownTable({ inputMdPath, outputXlsxPath, sheetName }) {
  if (!fs.existsSync(inputMdPath)) {
    throw new Error(`Input not found: ${inputMdPath}`);
  }
  const md = fs.readFileSync(inputMdPath, "utf8");
  const rows = extractFirstMarkdownTable(md);
  if (!rows.length) {
    throw new Error(`No markdown table found in ${inputMdPath}`);
  }

  const rect = padToRect(rows);
  const ws = XLSX.utils.aoa_to_sheet(rect);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  XLSX.writeFile(wb, outputXlsxPath, { compression: true });
}

function main() {
  const exports = [
    {
      md: path.join(RESULTS_DIR, "risk-report-isbot-matrix.md"),
      xlsx: path.join(RESULTS_DIR, "risk-report-isbot-matrix.xlsx"),
      sheet: "isbot-matrix",
    },
    {
      md: path.join(RESULTS_DIR, "risk-indicators-report.md"),
      xlsx: path.join(RESULTS_DIR, "risk-indicators-report.xlsx"),
      sheet: "risk-indicators",
    },
    {
      md: path.join(RESULTS_DIR, "identifiers-report.md"),
      xlsx: path.join(RESULTS_DIR, "identifiers-report.xlsx"),
      sheet: "identifiers",
    },
  ];

  for (const e of exports) {
    writeXlsxFromMarkdownTable({
      inputMdPath: e.md,
      outputXlsxPath: e.xlsx,
      sheetName: e.sheet,
    });
    console.log("Wrote:", path.relative(PROJECT_ROOT, e.xlsx));
  }
}

main();

