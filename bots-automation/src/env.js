/**
 * Central configuration: loads `.env` from the project root, then exposes typed helpers and constants.
 * Import this module (or `./config.js`) before reading other env-dependent settings.
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (directory containing `package.json`). */
export const PROJECT_ROOT = path.resolve(__dirname, "..");

const envPath = path.join(PROJECT_ROOT, ".env");
dotenv.config(
  fs.existsSync(envPath)
    ? { path: envPath, quiet: true }
    : { quiet: true }
);

/**
 * @param {string} key
 * @param {string} [defaultValue=""]
 */
export function stringEnv(key, defaultValue = "") {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return String(v);
}

/**
 * @param {string} key
 * @param {number} defaultValue
 */
export function numberEnv(key, defaultValue) {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * @param {string} key
 * @param {boolean} [defaultValue=false]
 */
export function boolEnv(key, defaultValue = false) {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v === "true" || v === "1";
}

// --- Local collector HTTP server (collector-page) ---
export const COLLECTOR_HOST = stringEnv("COLLECTOR_HOST", "127.0.0.1");
export const COLLECTOR_PORT = numberEnv("COLLECTOR_PORT", 7778);
/** Directory under project root with `index.html` and JSC bundle */
export const COLLECTOR_PAGE_DIR = stringEnv("COLLECTOR_PAGE_DIR", "collector-page");

/** Absolute path served by `collector-http.mjs` */
export const COLLECTOR_ROOT = path.resolve(PROJECT_ROOT, COLLECTOR_PAGE_DIR);

function defaultCollectorBaseUrl() {
  return `http://${COLLECTOR_HOST}:${COLLECTOR_PORT}/`;
}

const collectorUrlOverride = stringEnv("COLLECTOR_URL", "").trim();

/**
 * Page URL for automation. When `COLLECTOR_URL` is unset, defaults to `http://COLLECTOR_HOST:COLLECTOR_PORT/`.
 */
export const TARGET_URL = collectorUrlOverride
  ? collectorUrlOverride.endsWith("/")
    ? collectorUrlOverride
    : `${collectorUrlOverride}/`
  : defaultCollectorBaseUrl();

/** `#id` of the textarea that receives the serialized payload */
export const PAYLOAD_ELEMENT_ID = stringEnv(
  "PAYLOAD_ELEMENT_ID",
  "textareaPayload"
);

/** Max wait for non-empty payload text (ms) */
export const PAYLOAD_TIMEOUT_MS = numberEnv("PAYLOAD_TIMEOUT_MS", 180_000);

/** CSV output path relative to project root */
export const CSV_PATH = stringEnv("CSV_PATH", "results/payloads.csv");

/** Input CSV for report scripts; falls back to `CSV_PATH` when unset */
export const CSV_INPUT = stringEnv("CSV_INPUT", "") || CSV_PATH;

// --- Risk service ---
export const RISK_SERVICE_URL = stringEnv(
  "RISK_SERVICE_URL",
  "http://localhost:8080/v1/risk/signals"
);
export const RISK_REQUEST_IP = stringEnv("RISK_REQUEST_IP", "185.212.107.9");

// --- Report outputs (paths relative to project root unless absolute) ---
export const RISK_REPORT_MD = stringEnv("RISK_REPORT_MD", "results/risk-report.md");
export const RISK_REPORT_JSON = stringEnv(
  "RISK_REPORT_JSON",
  "results/risk-report-data.json"
);
export const RISK_REPORT_MATRIX_MD = stringEnv(
  "RISK_REPORT_MATRIX_MD",
  "results/risk-report-isbot-matrix.md"
);

export const IDENTIFIERS_REPORT_MD = stringEnv(
  "IDENTIFIERS_REPORT_MD",
  "results/identifiers-report.md"
);
export const IDENTIFIERS_REPORT_JSON = stringEnv(
  "IDENTIFIERS_REPORT_JSON",
  "results/identifiers-report.json"
);
export const IDENTIFIERS_CELL_MAX_CHARS = numberEnv(
  "IDENTIFIERS_CELL_MAX_CHARS",
  8192
);

export const RISK_INDICATORS_REPORT_MD = stringEnv(
  "RISK_INDICATORS_REPORT_MD",
  "results/risk-indicators-report.md"
);
export const RISK_INDICATORS_REPORT_JSON = stringEnv(
  "RISK_INDICATORS_REPORT_JSON",
  "results/risk-indicators-report.json"
);
export const RISK_INDICATORS_CELL_MAX_CHARS = numberEnv(
  "RISK_INDICATORS_CELL_MAX_CHARS",
  8192
);

export const RISK_REPORT_MATRIX_PDF = stringEnv(
  "RISK_REPORT_MATRIX_PDF",
  "results/risk-report-isbot-matrix.pdf"
);

/** Puppeteer PDF / Chromium: disable sandbox (CI or restrictive environments) */
export function isMdToPdfNoSandbox() {
  return (
    process.env.CI === "true" ||
    process.env.MD_TO_PDF_NO_SANDBOX === "1" ||
    boolEnv("MD_TO_PDF_NO_SANDBOX", false)
  );
}

/**
 * @param {string} relativeOrAbsolute
 * @returns {string}
 */
export function resolveProjectPath(relativeOrAbsolute) {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  return path.resolve(PROJECT_ROOT, relativeOrAbsolute);
}
