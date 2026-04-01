#!/usr/bin/env node
/**
 * Launches each configured browser, opens the UDI collector, extracts the payload and txId,
 * then records rows to results/txids.jsonl (and optional git push).
 *
 * Env:
 *   UDIBROWSERS       Comma list: chrome,chromium,firefox,brave,opera,tor,webkit (default: chrome,firefox,chromium)
 *   COLLECTOR_URL     Default: https://gdtm-dev.globalsiteanalytics.com/kasm.html (#udip payload, #txId)
 *   HEADLESS          1/true for headless (default: false — use headed on KASM)
 *   BRAVE_PATH        Executable for Brave (default: /usr/bin/brave-browser)
 *   OPERA_PATH        Executable for Opera (default: /usr/bin/opera)
 *   FIREFOX_PATH      Override Firefox binary
 *   TOR_BROWSER_PATH  Tor Browser binary (e.g. .../Browser/start-tor-browser or tor-browser)
 *   COLLECTOR_SETTLE_MS  Extra wait after load so GDTM can inject #udip / #txId (default: 2000)
 *   RESULTS_FILE       Path to JSONL log (default: <project>/results/txids.jsonl)
 *   SKIP_RESULTS_FILE  Set to 1 to disable writing txId records
 *   AUTO_PUSH_RESULTS  Set to 0/false to skip git commit+push after the last browser (default: on)
 *   GITHUB_USERNAME     For HTTPS push without prompts (use with GITHUB_TOKEN)
 *   GITHUB_TOKEN        GitHub PAT for git push over HTTPS (never commit this value)
 *   PLAYWRIGHT_IGNORE_HTTPS_ERRORS  Default on (unset or 1/true). Set 0/false to enforce TLS.
 *                                   Firefox bundled with Playwright uses its own trust store; corp MITM
 *                                   often causes SEC_ERROR_UNKNOWN_ISSUER without this.
 *   PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX  Default on (unset or 1/true). Sets several MOZ_DISABLE_* env vars
 *                                   for Firefox / Tor Browser (Docker/Kasm user-namespace EPERM). Set 0/false off.
 *   TOR_PLAYWRIGHT_PROFILE_DIR  Optional absolute or project-relative path for Tor persistent profile (default:
 *                                   .playwright-tor-profile). A user.js is written here so sandbox prefs apply
 *                                   before Juggler connects (Tor often still needs this in addition to env).
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

const HEADLESS =
  process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';

const COLLECTOR_SETTLE_MS = Number(process.env.COLLECTOR_SETTLE_MS || 2000);

const PLAYWRIGHT_IGNORE_HTTPS_ERRORS = (() => {
  const v = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS;
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return true;
})();

/** Extra env for Firefox / Tor so `clone()` user-namespace sandbox does not EPERM in Kasm/Docker. */
const PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX = (() => {
  const v = process.env.PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX;
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return true;
})();

/** Env vars read at Firefox/Tor process start (before Juggler / protocol prefs). */
const MOZ_SANDBOX_ENV_DISABLE = {
  MOZ_DISABLE_CONTENT_SANDBOX: '1',
  MOZ_DISABLE_GMP_SANDBOX: '1',
  MOZ_DISABLE_RDD_SANDBOX: '1',
  MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1',
};

function firefoxLaunchOptions(base) {
  if (!PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX) return base;
  const overlay =
    base.env && typeof base.env === 'object' && !Array.isArray(base.env)
      ? base.env
      : {};
  const env = {
    ...process.env,
    ...overlay,
    ...MOZ_SANDBOX_ENV_DISABLE,
  };
  const firefoxUserPrefs = {
    'security.sandbox.content.level': 0,
    ...(base.firefoxUserPrefs || {}),
  };
  return {
    ...base,
    env,
    firefoxUserPrefs,
  };
}

function resolveTorPlaywrightProfileDir() {
  const raw = process.env.TOR_PLAYWRIGHT_PROFILE_DIR;
  if (!raw || !String(raw).trim()) {
    return path.join(PROJECT_ROOT, '.playwright-tor-profile');
  }
  const s = String(raw).trim();
  return path.isAbsolute(s) ? s : path.join(PROJECT_ROOT, s);
}

/**
 * Tor: Playwright only applies firefoxUserPrefs after Juggler connects — too late if the parent
 * process dies on sandbox init. Write user.js into a persistent profile so prefs load at startup.
 */
function ensureTorPlaywrightProfileUserJs(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const userJsPath = path.join(profileDir, 'user.js');
  const body = [
    '// udi-payload-harvest: relax sandboxes for Playwright + Tor in Kasm/Docker (user namespaces EPERM)',
    'user_pref("security.sandbox.content.level", 0);',
    'user_pref("security.sandbox.socket.process.level", 0);',
    'user_pref("media.cubeb.sandbox", false);',
    '',
  ].join('\n');
  fs.writeFileSync(userJsPath, body, 'utf8');
}

/**
 * Tor Browser via persistent context + disk user.js (see ensureTorPlaywrightProfileUserJs).
 */
async function launchTorPersistentContext() {
  const exe = resolveExecutable('tor_browser', [
    '/usr/bin/tor-browser',
    '/usr/local/bin/tor-browser',
  ]);
  const profileDir = resolveTorPlaywrightProfileDir();
  ensureTorPlaywrightProfileUserJs(profileDir);
  process.stderr.write(`Tor Playwright profile (user.js sandbox prefs): ${profileDir}\n`);

  const baseOpts = {
    headless: HEADLESS,
    executablePath: exe,
    args: ['--no-remote'],
    ignoreHTTPSErrors: PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
  };
  return firefox.launchPersistentContext(
    profileDir,
    firefoxLaunchOptions(baseOpts),
  );
}

const DEFAULT_RESULTS_FILE = path.join(PROJECT_ROOT, 'results', 'txids.jsonl');

const DEFAULT_BROWSERS = ['chrome', 'firefox', 'chromium'];

/** Rows collected in the current `npm run collect` only (replaces file on each run). */
let currentRunTxRows = [];

function getResultsFilePath() {
  return process.env.RESULTS_FILE && process.env.RESULTS_FILE.length > 0
    ? path.isAbsolute(process.env.RESULTS_FILE)
      ? process.env.RESULTS_FILE
      : path.join(PROJECT_ROOT, process.env.RESULTS_FILE)
    : DEFAULT_RESULTS_FILE;
}

/**
 * Overwrite JSONL with **only this run’s** rows (previous file contents are discarded).
 */
function writeTxIdResultsFile() {
  if (process.env.SKIP_RESULTS_FILE === '1' || process.env.SKIP_RESULTS_FILE === 'true') {
    return;
  }
  const dest = getResultsFilePath();
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const lines = currentRunTxRows.map((r) => JSON.stringify(r));
    const body = lines.length ? `${lines.join('\n')}\n` : '';
    fs.writeFileSync(dest, body, 'utf8');
    process.stderr.write(
      `Wrote ${currentRunTxRows.length} txId row(s) (this run only, file replaced) → ${path.relative(PROJECT_ROOT, dest)}\n`,
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
  if (process.env.SKIP_RESULTS_FILE === '1' || process.env.SKIP_RESULTS_FILE === 'true') {
    process.stderr.write('Auto-push skipped (SKIP_RESULTS_FILE=1).\n');
    return;
  }

  const dest = getResultsFilePath();

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
 * @param {import('playwright').Page} page
 * @param {import('playwright').Browser} browser
 * @param {string} displayName
 */
async function runCollectorInPage(page, browser, displayName) {
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

  const ts = new Date().toISOString();

  currentRunTxRows.push({
    txId: txId || '',
    browserName: displayName,
    browserVersion: String(version || 'unknown'),
    fetchedAt: ts,
  });
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} displayName
 */
async function runOneBrowser(browser, displayName) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
  });
  const page = await context.newPage();
  try {
    await runCollectorInPage(page, browser, displayName);
  } finally {
    await context.close();
  }
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
        firefoxLaunchOptions(exe ? { ...opts, executablePath: exe } : opts),
      );
    }
    case 'tor':
      throw new Error('Tor is launched via launchTorPersistentContext() — not launchBrowser(tor)');
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
  currentRunTxRows = [];
  const kinds = parseBrowserList();
  const failures = [];

  for (const kind of kinds) {
    const label = displayLabel(kind);
    process.stderr.write(`\n>>> ${label} (${kind})\n`);

    if (kind === 'tor') {
      /** @type {import('playwright').BrowserContext | null} */
      let pctx = null;
      try {
        pctx = await launchTorPersistentContext();
      } catch (e) {
        failures.push({ kind, phase: 'launch', error: e });
        process.stderr.write(`Launch failed: ${e?.message || e}\n`);
        continue;
      }
      try {
        const page = pctx.pages()[0] ?? (await pctx.newPage());
        const br = pctx.browser();
        if (!br) {
          throw new Error('Persistent Tor context has no Browser handle');
        }
        await runCollectorInPage(page, br, label);
        process.stderr.write(`OK: ${label}\n`);
      } catch (e) {
        failures.push({ kind, phase: 'run', error: e });
        process.stderr.write(`Run failed: ${e?.message || e}\n`);
      } finally {
        await pctx.close().catch(() => {});
      }
      continue;
    }

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

  writeTxIdResultsFile();
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
