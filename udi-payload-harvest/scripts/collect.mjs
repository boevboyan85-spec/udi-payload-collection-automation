#!/usr/bin/env node
/**
 * Launches each configured browser, opens the UDI collector, extracts the payload,
 * then appends a labeled block to the shared text page (does not replace existing text).
 *
 * Env:
 *   UDIBROWSERS       Comma list: chrome,chromium,firefox,brave,opera,tor,webkit (default: chrome,firefox,chromium)
 *   COLLECTOR_URL     Default: https://gdtm-dev.globalsiteanalytics.com/kasm.html (#udip payload, #txId)
 *   TEXT_SYNC_URL     Default: https://gdtm-dev.globalsiteanalytics.com/text.html
 *   HEADLESS          1/true for headless (default: false — use headed on KASM)
 *   BRAVE_PATH        Executable for Brave (default: /usr/bin/brave-browser)
 *   OPERA_PATH        Executable for Opera (default: /usr/bin/opera)
 *   FIREFOX_PATH      Override Firefox binary
 *   TOR_BROWSER_PATH  Tor Browser binary (e.g. .../Browser/start-tor-browser or tor-browser)
 *   TEXT_SYNC_DRAIN_MS  Wait after appending so WebSocket can flush before browser closes (default: 3000)
 *   TEXT_SYNC_STABLE_MS Poll interval while waiting for textarea to finish loading (default: 400)
 *   TEXT_SYNC_STABLE_TICKS Value unchanged this many polls => stable (default: 4)
 *   COLLECTOR_SETTLE_MS  Extra wait after load so GDTM can inject #udip / #txId (default: 2000)
 *   RESULTS_FILE       Path to JSONL log (default: <project>/results/txids.jsonl)
 *   SKIP_RESULTS_FILE  Set to 1 to disable writing txId records
 *   AUTO_PUSH_RESULTS  Set to 0/false to skip git commit+push after the last browser (default: on)
 */

import { spawnSync } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const COLLECTOR_URL =
  process.env.COLLECTOR_URL ||
  'https://gdtm-dev.globalsiteanalytics.com/kasm.html';
const TEXT_SYNC_URL =
  process.env.TEXT_SYNC_URL ||
  'https://gdtm-dev.globalsiteanalytics.com/text.html';

const HEADLESS =
  process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';

const TEXT_SYNC_DRAIN_MS = Number(process.env.TEXT_SYNC_DRAIN_MS || 3000);
const TEXT_SYNC_STABLE_MS = Number(process.env.TEXT_SYNC_STABLE_MS || 400);
const TEXT_SYNC_STABLE_TICKS = Number(process.env.TEXT_SYNC_STABLE_TICKS || 4);
const COLLECTOR_SETTLE_MS = Number(process.env.COLLECTOR_SETTLE_MS || 2000);

const DEFAULT_RESULTS_FILE = path.join(PROJECT_ROOT, 'results', 'txids.jsonl');

const DEFAULT_BROWSERS = ['chrome', 'firefox', 'chromium'];

/**
 * Append one JSON object per line (JSONL) for downstream consumption.
 * @param {{ txId: string, browserName: string, browserVersion: string, fetchedAt: string }} row
 */
function appendTxIdRecord(row) {
  if (process.env.SKIP_RESULTS_FILE === '1' || process.env.SKIP_RESULTS_FILE === 'true') {
    return;
  }
  const dest =
    process.env.RESULTS_FILE && process.env.RESULTS_FILE.length > 0
      ? path.isAbsolute(process.env.RESULTS_FILE)
        ? process.env.RESULTS_FILE
        : path.join(PROJECT_ROOT, process.env.RESULTS_FILE)
      : DEFAULT_RESULTS_FILE;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const line = `${JSON.stringify(row)}\n`;
    fs.appendFileSync(dest, line, 'utf8');
    process.stderr.write(
      `Appended txId record (${row.browserName}) → ${path.relative(PROJECT_ROOT, dest)}\n`,
    );
  } catch (e) {
    process.stderr.write(`Warning: could not write results file: ${e?.message || e}\n`);
  }
}

/**
 * Run scripts/push-results.sh after all browsers (commit + push results/txids.jsonl to origin develop).
 */
function maybeAutoPushResults() {
  const opt = process.env.AUTO_PUSH_RESULTS;
  if (opt === '0' || opt === 'false') {
    process.stderr.write('Auto-push skipped (AUTO_PUSH_RESULTS=0).\n');
    return;
  }

  const dest =
    process.env.RESULTS_FILE && process.env.RESULTS_FILE.length > 0
      ? path.isAbsolute(process.env.RESULTS_FILE)
        ? process.env.RESULTS_FILE
        : path.join(PROJECT_ROOT, process.env.RESULTS_FILE)
      : DEFAULT_RESULTS_FILE;

  if (!fs.existsSync(dest)) {
    process.stderr.write('Auto-push skipped: no results file on disk.\n');
    return;
  }

  const script = path.join(PROJECT_ROOT, 'scripts', 'push-results.sh');
  if (!fs.existsSync(script)) {
    process.stderr.write('Auto-push skipped: scripts/push-results.sh missing.\n');
    return;
  }

  const msg = `chore(results): append txId capture records (${new Date().toISOString()})`;
  process.stderr.write('\n--- Auto-push results to origin develop ---\n');
  const r = spawnSync('bash', [script, msg], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });

  if (r.error) {
    process.stderr.write(`Auto-push failed: ${r.error.message}\n`);
    if (!process.exitCode) process.exitCode = 1;
    return;
  }
  if (r.status !== 0) {
    process.stderr.write(
      `Auto-push exited with code ${r.status}. Configure git remote and credentials, or set AUTO_PUSH_RESULTS=0.\n`,
    );
    if (!process.exitCode) process.exitCode = 1;
  }
}

/**
 * Playwright may resolve inputValue() to undefined; String(undefined) is the literal word "undefined".
 * Some React stacks also briefly surface the literal strings "undefined" / "null" when empty.
 * @param {unknown} v
 */
function normalizeSyncedText(v) {
  if (v == null) return '';
  const s = String(v);
  if (s === 'undefined' || s === 'null') return '';
  return s;
}

/**
 * @param {import('playwright').Locator} textarea
 */
async function readTextareaValue(textarea) {
  try {
    const v = await textarea.inputValue();
    return normalizeSyncedText(v);
  } catch {
    return '';
  }
}

function parseBrowserList() {
  const raw = process.env.UDIBROWSERS || DEFAULT_BROWSERS.join(',');
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function resolveExecutable(name, defaults) {
  const envKey = `${name.toUpperCase().replace(/-/g, '_')}_PATH`;
  if (process.env[envKey]) return process.env[envKey];
  for (const p of defaults) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return defaults[0];
}

/** Heuristic: encrypted / encoded collector blobs are usually high alphanumeric ratio. */
function looksLikePayload(s) {
  if (!s || s.length < 24) return false;
  const sample = s.slice(0, 500);
  const enc = (sample.match(/[a-zA-Z0-9+/=_:-]/g) || []).length / sample.length;
  return enc > 0.82;
}

/**
 * Clipboard reads on WebKit/Linux can return stale OS clipboard (terminal selection, old Playwright errors).
 * Strip obvious non-payload lines before using the string.
 * @param {string} s
 */
function stripClipboardNoise(s) {
  if (!s || typeof s !== 'string') return '';
  const lines = s.split('\n');
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (/^>>>\s/.test(t)) return false;
    if (/^Run failed:/i.test(t)) return false;
    if (/browserContext\.newPage/i.test(t)) return false;
    if (/Unknown permission:\s*clipboard/i.test(t)) return false;
    return true;
  });
  return kept.join('\n').trim();
}

/**
 * Find #udip / #txId on the main document or inside a child frame (same-origin iframes).
 * @param {import('playwright').Page} page
 */
async function locateKasmInputLocators(page) {
  const tryLocators = (root) => ({
    udip: root.locator('#udip'),
    txIdInput: root.locator('#txId'),
  });

  let { udip, txIdInput } = tryLocators(page);
  const hasPair = async () =>
    (await udip.count()) > 0 && (await txIdInput.count()) > 0;

  if (await hasPair()) return { udip, txIdInput };

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    ({ udip, txIdInput } = tryLocators(frame));
    if (await hasPair()) return { udip, txIdInput };
  }

  return tryLocators(page);
}

/**
 * Read payload and transaction id from KASM test page inputs (populated by GDTM snippet).
 * @param {import('playwright').Page} page
 */
async function obtainKasmPayloadAndTx(page) {
  const { udip, txIdInput } = await locateKasmInputLocators(page);

  // `visible` never resolves if inputs are hidden (display:none) until filled — use `attached`.
  await udip.first().waitFor({ state: 'attached', timeout: 120000 });
  await txIdInput.first().waitFor({ state: 'attached', timeout: 120000 });

  const deadline = Date.now() + 120000;
  let payload = '';
  let txId = '';
  let lastLog = 0;
  while (Date.now() < deadline) {
    payload = stripClipboardNoise(
      (await udip.first().inputValue().catch(() => '')) || '',
    );
    txId = stripClipboardNoise(
      (await txIdInput.first().inputValue().catch(() => '')) || '',
    );
    if (payload.length >= 16 || looksLikePayload(payload)) break;
    if (payload.length >= 8 && txId.length > 0) break;
    const now = Date.now();
    if (now - lastLog > 10000) {
      lastLog = now;
      process.stderr.write(
        'Still waiting for #udip / #txId values (snippet may still be loading)…\n',
      );
    }
    await page.waitForTimeout(400);
  }

  if (!payload || payload.length < 8) {
    throw new Error(
      `Could not read payload from #udip. Open ${COLLECTOR_URL} and confirm inputs exist (see DOM / iframes).`,
    );
  }
  return { payload: payload.trim(), txId: txId.trim() };
}

/**
 * Wait until textarea#text stops changing (WebSocket / React often fills it after load).
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} textarea
 */
async function waitForStableTextareaValue(page, textarea) {
  const maxWaitMs = 25000;
  const start = Date.now();
  let prev = await readTextareaValue(textarea);
  let stableCount = 0;
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(TEXT_SYNC_STABLE_MS);
    const cur = await readTextareaValue(textarea);
    if (cur === prev) {
      stableCount += 1;
      if (stableCount >= TEXT_SYNC_STABLE_TICKS) return cur;
    } else {
      stableCount = 0;
      prev = cur;
    }
  }
  return await readTextareaValue(textarea);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} block
 */
async function appendToSharedText(page, block) {
  await page.goto(TEXT_SYNC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Shared sync page uses <textarea id="text">; avoid textarea.first() when multiple textareas exist.
  const textarea = page.locator('textarea#text');
  const hasTextarea = await textarea.count().then((c) => c > 0);

  if (hasTextarea) {
    await textarea.waitFor({ state: 'visible', timeout: 30000 });
    const existing = normalizeSyncedText(
      await waitForStableTextareaValue(page, textarea),
    );
    const next = existing + String(block ?? '');
    await textarea.click();
    // Locator.evaluate(fn, arg) calls fn(element, arg) — not fn(arg). First param is the textarea node.
    await textarea.evaluate(
      (el, { fullValue, appendedBlock }) => {
        if (!el || !('value' in el)) return;
        const proto = window.HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const v = fullValue == null ? '' : String(fullValue);
        const app = appendedBlock == null ? '' : String(appendedBlock);
        if (desc?.set) {
          desc.set.call(el, v);
        } else {
          el.value = v;
        }
        // One input event: duplicate Event + InputEvent can confuse React and flash the literal "undefined".
        try {
          const opts =
            app.length <= 8000
              ? {
                  bubbles: true,
                  inputType: 'insertFromPaste',
                  data: app,
                }
              : { bubbles: true, inputType: 'insertFromPaste' };
          el.dispatchEvent(new InputEvent('input', opts));
        } catch {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { fullValue: next, appendedBlock: block },
    );
    await textarea.blur();
    // Let the doc sync out before the next browser navigates away or context closes.
    await page.waitForTimeout(TEXT_SYNC_DRAIN_MS);
    return;
  }

  const editable = page.locator('[contenteditable="true"]').first();
  await editable.waitFor({ state: 'visible', timeout: 30000 });
  await editable.evaluate((el, append) => {
    el.innerText = (el.innerText || '') + append;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, block);
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} displayName
 */
async function runOneBrowser(browser, displayName) {
  const context = await browser.newContext();

  const page = await context.newPage();
  let version = '';
  try {
    version = await browser.version();
  } catch {
    version = 'unknown';
  }

  await page.goto(COLLECTOR_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Avoid `networkidle` — analytics / WebSockets often keep connections open so it may never resolve.
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(COLLECTOR_SETTLE_MS);

  const { payload, txId } = await obtainKasmPayloadAndTx(page);
  process.stderr.write(
    `Payload captured (${payload.length} chars), txId: ${txId || '(empty)'}\n`,
  );

  const ua =
    (await page.evaluate(() => navigator.userAgent).catch(() => '')) || '';
  const ts = new Date().toISOString();
  const block = `\n--- BROWSER: ${String(displayName)} | engine: ${String(version || 'unknown')} | ${ts} ---\ntxId: ${String(txId || '')}\n${String(ua)}\n\n${String(payload)}\n`;

  await appendToSharedText(page, block);

  appendTxIdRecord({
    txId: txId || '',
    browserName: displayName,
    browserVersion: String(version || 'unknown'),
    fetchedAt: ts,
  });

  await context.close();
}

async function launchBrowser(kind) {
  const opts = { headless: HEADLESS };
  switch (kind) {
    case 'chrome': {
      try {
        return await chromium.launch({ ...opts, channel: 'chrome' });
      } catch {
        const exe = resolveExecutable('chrome', [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/opt/google/chrome/chrome',
        ]);
        return chromium.launch({ ...opts, executablePath: exe });
      }
    }
    case 'chromium':
      return chromium.launch(opts);
    case 'brave': {
      const exe = resolveExecutable('brave', [
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/opt/brave.com/brave/brave-browser',
      ]);
      return chromium.launch({ ...opts, executablePath: exe });
    }
    case 'opera': {
      const exe = resolveExecutable('opera', [
        '/usr/bin/opera',
        '/usr/bin/opera-stable',
      ]);
      return chromium.launch({ ...opts, executablePath: exe });
    }
    case 'firefox': {
      const exe = process.env.FIREFOX_PATH || undefined;
      return firefox.launch(
        exe ? { ...opts, executablePath: exe } : opts,
      );
    }
    case 'tor': {
      const exe = resolveExecutable('tor_browser', [
        '/usr/bin/tor-browser',
        '/usr/local/bin/tor-browser',
      ]);
      return firefox.launch({
        ...opts,
        executablePath: exe,
        args: ['--no-remote'],
      });
    }
    case 'webkit':
      return webkit.launch(opts);
    default:
      throw new Error(`Unknown browser kind: ${kind}`);
  }
}

function displayLabel(kind) {
  const map = {
    chrome: 'Google Chrome',
    chromium: 'Chromium',
    brave: 'Brave',
    opera: 'Opera',
    firefox: 'Mozilla Firefox',
    tor: 'Tor Browser',
    webkit: 'WebKit (Playwright)',
  };
  return map[kind] || kind;
}

async function main() {
  const kinds = parseBrowserList();
  const failures = [];

  for (const kind of kinds) {
    const label = displayLabel(kind);
    process.stderr.write(`\n>>> ${label} (${kind})\n`);
    let browser;
    try {
      browser = await launchBrowser(kind);
    } catch (e) {
      failures.push({ kind, phase: 'launch', error: e });
      process.stderr.write(`Launch failed: ${e?.message || e}\n`);
      continue;
    }
    try {
      await runOneBrowser(browser, label);
      process.stderr.write(`OK: ${label}\n`);
    } catch (e) {
      failures.push({ kind, phase: 'run', error: e });
      process.stderr.write(`Run failed: ${e?.message || e}\n`);
    } finally {
      await browser.close().catch(() => {});
    }
  }

  maybeAutoPushResults();

  if (failures.length) {
    process.stderr.write(
      `\nCompleted with ${failures.length} failure(s). Fix paths (see README) or run with fewer UDIBROWSERS.\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
