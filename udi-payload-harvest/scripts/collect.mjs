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
 *   TOR_BROWSER_PATH  Tor **`Browser/firefox`** binary (Gecko). Tor is driven via **Selenium + GeckoDriver**,
 *                     not Playwright — stock Tor/Firefox does not ship Playwright’s Juggler patch (launch would hang).
 *   GECKODRIVER_PATH  Optional path to **`geckodriver`** (else Selenium 4 may auto-download; or install `geckodriver` / `firefox-geckodriver`).
 *   TOR_WARMUP_MS     Default 15000 — sleep after WebDriver session before `driver.get` (Tor bootstrap).
 *   TOR_SETTLE_AFTER_LOAD_MS  Default COLLECTOR_SETTLE_MS — sleep after navigation before polling #udip.
 *   TOR_SELENIUM_KEEP_OPEN    Set 1 to skip driver.quit() so the window stays up for debugging.
 *   TOR_SELENIUM_PROFILE_DIR  Override path for the **persistent** Marionette profile (default: ~/.udi-tor-selenium-profile).
 *                             With TOR_SELENIUM_EPHEMERAL_PROFILE=1, each run uses a fresh profile and Tor’s
 *                             “Always connect” cannot persist across runs.
 *   TOR_SELENIUM_TOR_LAUNCHER_PROMPT  Default on: prefs to skip the Tor Launcher startup modal and enable
 *                             quickstart (“always connect”). Set 0/false to use Tor defaults only.
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
 */

import { spawnSync } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';
import { Builder, By } from 'selenium-webdriver';
import { Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import fs from 'node:fs';
import os from 'node:os';
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

function intEnv(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** Wait after Marionette session starts before loading HTTPS (Tor must connect to the Tor network first). */
const TOR_WARMUP_MS = intEnv('TOR_WARMUP_MS', 15000);
/** Extra wait after `driver.get` for GDTM / Tor circuits (defaults to COLLECTOR_SETTLE_MS). */
const TOR_SETTLE_AFTER_LOAD_MS = intEnv(
  'TOR_SETTLE_AFTER_LOAD_MS',
  COLLECTOR_SETTLE_MS,
);

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

function resolveGeckodriverPath() {
  const raw = process.env.GECKODRIVER_PATH || process.env.GECKODRIVER || '';
  if (raw && fs.existsSync(raw)) return raw;
  for (const p of ['/usr/bin/geckodriver', '/usr/local/bin/geckodriver']) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOR_SELENIUM_EPHEMERAL_PROFILE =
  process.env.TOR_SELENIUM_EPHEMERAL_PROFILE === '1' ||
  process.env.TOR_SELENIUM_EPHEMERAL_PROFILE === 'true';

/**
 * Persistent on-disk profile for Tor + Selenium. Selenium’s `setProfile()` only **copies** a template each
 * session and never writes back, so “Always connect” could not persist; `-profile` uses one directory in place.
 * @returns {string} absolute profile path, or '' for ephemeral (legacy behavior).
 */
function resolveTorSeleniumProfileDir() {
  if (TOR_SELENIUM_EPHEMERAL_PROFILE) return '';
  const raw = (process.env.TOR_SELENIUM_PROFILE_DIR || '').trim();
  const dir = raw
    ? path.resolve(raw)
    : path.join(os.homedir(), '.udi-tor-selenium-profile');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Prefs aligned with Tor’s quickstart / fewer launcher prompts on automation runs. */
const TOR_SELENIUM_QUICKSTART_PREFS = (() => {
  const v = process.env.TOR_SELENIUM_TOR_LAUNCHER_PROMPT;
  if (v === '0' || v === 'false') return false;
  return true;
})();

/**
 * Real Tor Browser is stock Mozilla Gecko without Playwright’s **Juggler** protocol — `firefox.launch`
 * hangs waiting for the pipe. Use **Marionette** via Selenium + GeckoDriver instead.
 */
async function buildTorWebDriver() {
  const exe = resolveExecutable('tor_browser', [
    '/usr/bin/tor-browser',
    '/usr/local/bin/tor-browser',
  ]);

  const options = new Options()
    .setBinary(exe)
    .setAcceptInsecureCerts(PLAYWRIGHT_IGNORE_HTTPS_ERRORS);

  const profileDir = resolveTorSeleniumProfileDir();
  if (profileDir) {
    options.addArguments('-profile', profileDir);
    process.stderr.write(`Tor: persistent Marionette profile: ${profileDir}\n`);
  } else {
    process.stderr.write(
      'Tor: ephemeral profile (TOR_SELENIUM_EPHEMERAL_PROFILE) — Tor may show the connect dialog every run.\n',
    );
  }

  if (HEADLESS) {
    options.addArguments('-headless');
  }

  if (TOR_SELENIUM_QUICKSTART_PREFS) {
    options.setPreference('extensions.torlauncher.prompt_at_startup', false);
    options.setPreference('torbrowser.settings.quickstart.enabled', true);
  }

  options.setPreference('security.sandbox.content.level', 0);
  options.setPreference('security.sandbox.socket.process.level', 0);
  options.setPreference('gfx.webrender.enabled', false);
  options.setPreference('layers.acceleration.disabled', true);
  options.setPreference('media.cubeb.sandbox', false);

  let builder = new Builder().forBrowser('firefox').setFirefoxOptions(options);

  const gecko = resolveGeckodriverPath();
  if (gecko) {
    builder = builder.setFirefoxService(new ServiceBuilder(gecko));
    process.stderr.write(`Tor: GeckoDriver ${gecko}\n`);
  } else {
    process.stderr.write(
      'Tor: GeckoDriver not in PATH / GECKODRIVER_PATH — Selenium may download one on first run.\n',
    );
  }

  process.stderr.write(
    'Tor: Selenium WebDriver (Tor Browser has no Playwright Juggler; do not use firefox.launch).\n',
  );

  return builder.build();
}

/**
 * Find #udip / #txId on the main document or inside iframes (driver left in winning frame).
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function findUdipTxElementsDriver(driver) {
  async function tryInCurrentContext() {
    const udips = await driver.findElements(By.css('#udip'));
    const txs = await driver.findElements(By.css('#txId'));
    if (udips.length && txs.length) {
      return { udip: udips[0], txIdInput: txs[0] };
    }
    return null;
  }

  await driver.switchTo().defaultContent();
  let hit = await tryInCurrentContext();
  if (hit) return hit;

  const frames = await driver.findElements(By.css('iframe'));
  for (const frame of frames) {
    await driver.switchTo().defaultContent();
    try {
      await driver.switchTo().frame(frame);
    } catch {
      continue;
    }
    hit = await tryInCurrentContext();
    if (hit) return hit;
  }

  await driver.switchTo().defaultContent();
  throw new Error('no #udip/#txId pair');
}

/**
 * Poll for #udip / #txId. Re-finds elements every iteration — Tor/GDTM can replace the DOM and
 * stale WebElement references would throw and (with a bare catch upstream) look like “browser just closed”.
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function obtainKasmPayloadAndTxDriver(driver) {
  const deadline = Date.now() + 120000;
  let lastLog = 0;
  while (Date.now() < deadline) {
    try {
      const { udip, txIdInput } = await findUdipTxElementsDriver(driver);
      const payload = stripClipboardNoise((await udip.getAttribute('value')) || '');
      const txId = stripClipboardNoise((await txIdInput.getAttribute('value')) || '');
      if (payload.length >= 16 || looksLikePayload(payload)) {
        return { payload: payload.trim(), txId: txId.trim() };
      }
      if (payload.length >= 8 && txId.length > 0) {
        return { payload: payload.trim(), txId: txId.trim() };
      }
    } catch {
      /* DOM not ready, stale element, or wrong frame */
    }
    if (Date.now() - lastLog > 10000) {
      lastLog = Date.now();
      process.stderr.write(
        '[tor] Still waiting for #udip / #txId (Tor circuit + snippet can be slow)…\n',
      );
    }
    await sleep(400);
  }
  throw new Error(
    `Could not read #udip in time. Try larger TOR_WARMUP_MS / TOR_SETTLE_AFTER_LOAD_MS, or open ${COLLECTOR_URL} manually in Tor.`,
  );
}

/**
 * GeckoDriver inherits **process.env** when spawning Firefox — needed for Kasm `clone() EPERM` sandboxes.
 * @returns {() => void}
 */
function applyMozEnvForGeckoChild() {
  if (!PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX) return () => {};
  const backup = {};
  for (const k of Object.keys(MOZ_SANDBOX_ENV_DISABLE)) {
    backup[k] = process.env[k];
  }
  Object.assign(process.env, MOZ_SANDBOX_ENV_DISABLE);
  return () => {
    for (const k of Object.keys(MOZ_SANDBOX_ENV_DISABLE)) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  };
}

/**
 * @param {string} displayName
 */
async function runTorSelenium(displayName) {
  const restoreEnv = applyMozEnvForGeckoChild();
  try {
    process.stderr.write('[tor] Starting GeckoDriver / Tor Browser session…\n');
    const driver = await buildTorWebDriver();
    try {
      await driver.manage().setTimeouts({
        pageLoad: 180000,
        script: 120000,
        implicit: 0,
      });

      process.stderr.write(
        `[tor] Waiting ${TOR_WARMUP_MS}ms for Tor to finish bootstrapping (TOR_WARMUP_MS)…\n`,
      );
      await sleep(TOR_WARMUP_MS);

      process.stderr.write(`[tor] Navigating to ${COLLECTOR_URL}…\n`);
      try {
        await driver.get(COLLECTOR_URL);
      } catch (e) {
        process.stderr.write(`[tor] Navigation error: ${e?.message || e}\n`);
        throw e;
      }

      process.stderr.write(
        `[tor] Waiting ${TOR_SETTLE_AFTER_LOAD_MS}ms after load (TOR_SETTLE_AFTER_LOAD_MS)…\n`,
      );
      await sleep(TOR_SETTLE_AFTER_LOAD_MS);

      process.stderr.write('[tor] Polling for collector fields…\n');
      const { payload, txId } = await obtainKasmPayloadAndTxDriver(driver);
      process.stderr.write(
        `Payload captured (${payload.length} chars), txId: ${txId || '(empty)'}\n`,
      );

      let version = 'unknown';
      try {
        const ua = await driver.executeScript('return navigator.userAgent');
        version = ua ? String(ua) : 'unknown';
      } catch {
        /* ignore */
      }
      const ts = new Date().toISOString();
      currentRunTxRows.push({
        txId: txId || '',
        browserName: displayName,
        browserVersion: version,
        fetchedAt: ts,
      });
    } finally {
      const keep =
        process.env.TOR_SELENIUM_KEEP_OPEN === '1' ||
        process.env.TOR_SELENIUM_KEEP_OPEN === 'true';
      if (keep) {
        process.stderr.write(
          '[tor] TOR_SELENIUM_KEEP_OPEN=1 — leaving browser open (quit manually).\n',
        );
      } else {
        process.stderr.write('[tor] Closing WebDriver session…\n');
        await driver.quit().catch((e) => {
          process.stderr.write(`[tor] driver.quit failed: ${e?.message || e}\n`);
        });
      }
    }
  } finally {
    restoreEnv();
  }
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
      throw new Error('Tor uses runTorSelenium() — not launchBrowser(tor)');
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
      try {
        await runTorSelenium(label);
        process.stderr.write(`OK: ${label}\n`);
      } catch (e) {
        failures.push({ kind, phase: 'run', error: e });
        process.stderr.write(`Tor (Selenium) failed: ${e?.message || e}\n`);
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
