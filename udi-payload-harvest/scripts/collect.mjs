#!/usr/bin/env node
/**
 * Launches each configured browser, opens the UDI collector, extracts the payload,
 * then appends a labeled block to the shared text page (does not replace existing text).
 *
 * Env:
 *   UDIBROWSERS       Comma list: chrome,chromium,firefox,brave,opera,tor,webkit (default: chrome,firefox,chromium)
 *   COLLECTOR_URL     Default: https://gdtm-dev.globalsiteanalytics.com/index.html
 *   TEXT_SYNC_URL     Default: https://gdtm-dev.globalsiteanalytics.com/text.html
 *   HEADLESS          1/true for headless (default: false — use headed on KASM)
 *   BRAVE_PATH        Executable for Brave (default: /usr/bin/brave-browser)
 *   OPERA_PATH        Executable for Opera (default: /usr/bin/opera)
 *   FIREFOX_PATH      Override Firefox binary
 *   TOR_BROWSER_PATH  Tor Browser binary (e.g. .../Browser/start-tor-browser or tor-browser)
 */

import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import process from 'node:process';

const COLLECTOR_URL =
  process.env.COLLECTOR_URL ||
  'https://gdtm-dev.globalsiteanalytics.com/index.html';
const TEXT_SYNC_URL =
  process.env.TEXT_SYNC_URL ||
  'https://gdtm-dev.globalsiteanalytics.com/text.html';

const HEADLESS =
  process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';

const COLLECTOR_ORIGIN = new URL(COLLECTOR_URL).origin;
const TEXT_ORIGIN = new URL(TEXT_SYNC_URL).origin;

const DEFAULT_BROWSERS = ['chrome', 'firefox', 'chromium'];

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

/**
 * @param {import('playwright').Page} page
 */
async function extractPayloadFromDom(page) {
  return page.evaluate(() => {
    const textOf = (el) => {
      if (!el) return '';
      if ('value' in el && typeof el.value === 'string') return el.value;
      return el.innerText || '';
    };
    const selectors = [
      '#payload',
      '[data-payload]',
      'textarea[name*="payload" i]',
      'pre#payload',
      'code#payload',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = textOf(el).trim();
      if (t.length > 32) return t;
    }
    const pres = [...document.querySelectorAll('pre')];
    for (const pre of pres) {
      const t = textOf(pre).trim();
      if (t.length > 32 && !/^collected payload/i.test(t)) return t;
    }
    const codes = [...document.querySelectorAll('code')];
    for (const c of codes) {
      const t = textOf(c).trim();
      if (t.length > 32) return t;
    }
    return null;
  });
}

/**
 * @param {import('playwright').Page} page
 */
async function waitAndCopyPayload(page) {
  const copyBtn = page.getByRole('button', { name: /copy\s*payload/i }).first();
  await copyBtn.waitFor({ state: 'visible', timeout: 120000 });
  await copyBtn.click();
  await page.waitForTimeout(500);
  try {
    return await page.evaluate(() => navigator.clipboard.readText());
  } catch {
    return null;
  }
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 */
async function grantClipboard(context, origins) {
  for (const origin of origins) {
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin,
      });
    } catch {
      /* non-fatal */
    }
  }
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
    await textarea.evaluate(
      (el, append) => {
        el.value += append;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      block,
    );
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
  await grantClipboard(context, [COLLECTOR_ORIGIN, TEXT_ORIGIN]);

  const page = await context.newPage();
  let version = '';
  try {
    version = await browser.version();
  } catch {
    version = 'unknown';
  }

  await page.goto(COLLECTOR_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  let payload = await extractPayloadFromDom(page);
  if (!payload || payload.length < 16) {
    payload = await waitAndCopyPayload(page);
  }
  if (!payload || payload.length < 8) {
    throw new Error(
      `Could not read payload (DOM + clipboard empty). Check selectors for ${COLLECTOR_URL}`,
    );
  }

  const ua = await page.evaluate(() => navigator.userAgent);
  const ts = new Date().toISOString();
  const block = `\n--- BROWSER: ${displayName} | engine: ${version} | ${ts} ---\n${ua}\n${payload}\n`;

  await appendToSharedText(page, block);
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
