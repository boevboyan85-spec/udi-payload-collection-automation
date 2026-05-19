/**
 * Runtime helpers for collection runs. Loads env via `./env.js`.
 * Re-exports configuration constants for backward compatibility.
 */
export * from "./env.js";

/**
 * Headless is the default for all stacks. Set `BOTS_HEADLESS=false` to show browser windows everywhere.
 * Per-runner overrides: `PUPPETEER_HEADLESS`, `PLAYWRIGHT_HEADLESS`, `SELENIUM_HEADLESS`, `TESTCAFE_HEADLESS`
 * set to `true` or `false` (when unset, `BOTS_HEADLESS` applies).
 * @param {string} toolEnvKey
 * @returns {boolean}
 */
export function resolveHeadless(toolEnvKey) {
  const t = process.env[toolEnvKey];
  if (t === "false") return false;
  if (t === "true") return true;
  return process.env.BOTS_HEADLESS !== "false";
}

/** Env vars that influence headless; all set together for a forced mode. */
const HEADLESS_ENV_KEYS = [
  "BOTS_HEADLESS",
  "PUPPETEER_HEADLESS",
  "PLAYWRIGHT_HEADLESS",
  "SELENIUM_HEADLESS",
  "TESTCAFE_HEADLESS",
];

/**
 * Runs `fn` while forcing every runner to headless or headed (ignores mixed per-tool overrides for this call).
 * @param {boolean} headless
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function runWithGlobalHeadless(headless, fn) {
  const saved = {};
  for (const k of HEADLESS_ENV_KEYS) {
    saved[k] = process.env[k];
    process.env[k] = headless ? "true" : "false";
  }
  try {
    return await fn();
  } finally {
    for (const k of HEADLESS_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** When true (default), each stack runs twice: headless then headed. Safari runs once (headed only). Set to `false` for a single pass using `BOTS_HEADLESS` / per-tool vars. */
export function isDualCollectionEnabled() {
  return process.env.BOTS_COLLECT_DUAL !== "false";
}
