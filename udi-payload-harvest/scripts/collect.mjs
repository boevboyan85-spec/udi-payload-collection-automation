#!/usr/bin/env node
/**
 * Launches each configured browser, opens the UDI collector, extracts the payload and txId,
 * then records rows to results/txids.jsonl (and optional git push).
 *
 * Env:
 *   collect.env       Optional project file (see **`collect.env.example`**). Loaded before other env reads. By default,
 *                     each **`KEY=value`** in the file **overwrites** the same key in **`process.env`** (so **`UDIBROWSERS`**
 *                     in the file wins over a narrow value exported from the shell or CI). Set **`UDI_COLLECT_ENV_OVERRIDE=0`**
 *                     for legacy behavior: only fill variables that are **unset** in the environment. Path: **`UDI_COLLECT_ENV`**
 *                     (absolute or relative to project root).
 *   UDIBROWSERS       Comma list: chrome,chromium,firefox,brave,opera,tor,webkit (default: chrome,chromium,firefox,tor,brave)
 *   COLLECTOR_URL     Default: https://gdtm-dev.globalsiteanalytics.com/kasm.html (#udip payload, #txId)
 *   HEADLESS          1/true for headless (default: false — use headed on KASM). Applies to **Chrome** and all Playwright
 *                     browsers; **Tor** (Selenium) uses Firefox **`-headless`** when set.
 *   DISABLE_PLUGINS   Default **off** (unset or 0/false). When **on** (1/true), non-stealth **`chrome`** injects empty
 *                     **`navigator.plugins` / `mimeTypes`** (see **`CHROME_SIMULATE_REAL_USER`**). Ignored for stealth Chrome.
 *   CHROME_SIMULATE_REAL_USER  Default **off** (unset or 0/false). When **on** (1/true), **`chrome`** may use
 *                     **`CHROME_DESKTOP_FILE`** (if set) and the same Chromium stealth options as
 *                     **`PLAYWRIGHT_AUTOMATION_MITIGATIONS`** for that browser. When **off** (0/false),
 *                     **`chrome`** ignores **`CHROME_DESKTOP_FILE`**, launches via **`channel: 'chrome'`** (or path
 *                     fallback), and does **not** apply those mitigations — automation UI / **`--enable-automation`**
 *                     behave like stock Playwright. **`chromium`**, **`brave`**, **`opera`** are unchanged (still follow
 *                     **`PLAYWRIGHT_AUTOMATION_MITIGATIONS`** only). Playwright also defaults to **`--disable-infobars`**,
 *                     which hides the yellow automation bar; for **`chrome`**, that switch is removed when this flag is off
 *                     or when **`PLAYWRIGHT_AUTOMATION_MITIGATIONS`** is off so the infobar can show.
 *                     With this flag off, **`chrome`** also uses **`launchPersistentContext`** and
 *                     **`~/.config/udi-payload-harvest/chromium-profile-chrome-show-automation/`** unless you already set
 *                     **`PLAYWRIGHT_CHROMIUM_USER_DATA_DIR`** or **`PLAYWRIGHT_PERSISTENT_CHROMIUM_PROFILE`** — headed
 *                     ephemeral **`launch()`** often never draws the native yellow bar (Chromium/Playwright), even with
 *                     **`--enable-automation`**. (Skipped when **`HEADLESS`** is on — no UI infobar then.)
 *                     Non-stealth **`chrome`** also passes **`--disable-extensions`** (Playwright’s default too) for a minimal
 *                     extension surface; stealth **`chrome`** strips that default so the launch can align with interactive Chrome.
 *                     When **`DISABLE_PLUGINS=1`**, non-stealth **`chrome`** injects empty **`navigator.plugins`** /
 *                     **`navigator.mimeTypes`** (and tries **`pdfViewerEnabled` → false** when configurable).
 *   CHROME_DESKTOP_FILE  Optional path to a Google Chrome **.desktop** file (e.g. Kasm:
 *                     **`/home/kasm-user/Desktop/google-chrome.desktop`**). Parses **`[Desktop Entry]`** **`Exec=`**, strips field codes (`%U`, …), and launches that **binary** via Playwright (not the `.desktop`
 *                     itself). Used only when **`CHROME_SIMULATE_REAL_USER`** is on; when set, **`chrome`** in UDIBROWSERS uses this path instead of **`channel: 'chrome'`**.
 *   BRAVE_PATH        Executable for Brave (default: /usr/bin/brave-browser)
 *   OPERA_PATH        Executable for Opera (default: /usr/bin/opera)
 *   FIREFOX_PATH      Override Firefox binary
 *   TOR_BROWSER_PATH  Tor **`Browser/firefox-bin`** (Gecko ELF) or a non-script **`Browser/firefox`**. The file
 *                     named **`firefox`** in official Linux bundles is often a **`#!` wrapper** — GeckoDriver needs
 *                     **`firefox-bin`**. If unset, auto-detect under **`~/tor-browser/Browser`** and torbrowser-launcher’s
 *                     **`tbb/.../Browser`**. Avoid **`/usr/bin/tor-browser`** when it is a distro script.
 *   GECKODRIVER_PATH  Optional path to **`geckodriver`** (else Selenium 4 may auto-download; or install `geckodriver` / `firefox-geckodriver`).
 *   TOR_WARMUP_MS     Default 20000 — sleep after WebDriver session before `driver.get` (Tor bootstrap).
 *   TOR_SETTLE_AFTER_LOAD_MS  Default 4000 — sleep after Tor navigation before polling #udip (Playwright uses COLLECTOR_SETTLE_MS).
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
 *   GITHUB_TOKEN_FILE   If GITHUB_TOKEN is unset, push-results.sh reads the PAT from this file (one line).
 *                       setup-kasm-ubuntu.sh also writes ~/.config/udi-payload-harvest/git-push.env (merged on push).
 *   PLAYWRIGHT_IGNORE_HTTPS_ERRORS  Default on (unset or 1/true). Set 0/false to enforce TLS.
 *                                   Firefox bundled with Playwright uses its own trust store; corp MITM
 *                                   often causes SEC_ERROR_UNKNOWN_ISSUER without this.
 *   PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX  Default on (unset or 1/true). Sets several MOZ_DISABLE_* env vars
 *                                   for Firefox / Tor Browser (Docker/Kasm user-namespace EPERM). Set 0/false off.
 *   PLAYWRIGHT_AUTOMATION_MITIGATIONS  Default on (unset or 1/true) for **Chromium-family** Playwright runs only.
 *                                   Drops **`--enable-automation`**, adds **`--disable-blink-features=AutomationControlled`**,
 *                                   **`--start-maximized`** when headed, and uses **`viewport: null`** when headed — reduces
 *                                   some automation / “devtools” heuristics (not a full anti-detect guarantee). Set 0/false off.
 *   PLAYWRIGHT_MASK_NAVIGATOR_WEBDRIVER  Default **off**. If 1/true, injects **`navigator.webdriver` → false** before page
 *                                   scripts — can flip “bot by web driver” but often triggers **“Override properties”** /
 *                                   **“Navigator own properties”** on strict fingerprint backends; leave off unless you need it.
 *   PLAYWRIGHT_LOCALE  Playwright **`locale`** (e.g. **`en-US`**). Aligns **`navigator.language` / languages** with default
 *                                   **`Accept-Language`**. If unset, **`LANG`** is parsed when it looks like **`en_US.UTF-8`**.
 *   PLAYWRIGHT_TIMEZONE_ID  IANA zone for Playwright **`timezoneId`** (e.g. **`America/New_York`** when IP geolocation is US).
 *                                   Reduces “time zone mismatch vs IP” when the session TZ differs from the egress IP region.
 *   CHROME_USER_DATA_DIR  **Google Chrome only:** absolute or `~`-style path to Chrome’s **user data** directory (the profile
 *                                   where extensions like Canvas Blocker live). Linux/Kasm typical: **`~/.config/google-chrome`**;
 *                                   macOS: **`~/Library/Application Support/Google/Chrome`**. When set, **`chrome`** uses
 *                                   **`launchPersistentContext`** with this directory so **installed extensions load**.
 *                                   **Close** any normal Chrome windows using this profile first (singleton lock). Takes
 *                                   precedence over **`PLAYWRIGHT_CHROMIUM_USER_DATA_DIR`** for **`kind=chrome`** only.
 *                                   **`CHROME_DESKTOP_FILE`** still selects the **binary**; it does **not** attach your desktop
 *                                   profile by itself.
 *   PLAYWRIGHT_CHROMIUM_USER_DATA_DIR  If set, **non-Chrome** Chromium-family kinds (and **chrome** only if
 *                                   **`CHROME_USER_DATA_DIR`** is unset) use **`launchPersistentContext`** with this directory.
 *                                   Use a dedicated path; avoid your interactive profile while that browser is running
 *                                   (profile lock). Per-browser default when **`PLAYWRIGHT_PERSISTENT_CHROMIUM_PROFILE=1`**:
 *                                   **`~/.config/udi-payload-harvest/chromium-profile-<kind>`**.
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

/**
 * Load `collect.env` (or `UDI_COLLECT_ENV`) into `process.env`.
 * Default: keys in the file overwrite existing `process.env` entries (so `UDIBROWSERS` in the file beats a stale shell export).
 * Set `UDI_COLLECT_ENV_OVERRIDE=0` to only assign when `process.env[key]` is undefined.
 * @param {string} rootDir
 */
function loadCollectEnvFile(rootDir) {
  const rawPath = process.env.UDI_COLLECT_ENV?.trim();
  const envPath = rawPath
    ? path.isAbsolute(rawPath)
      ? rawPath
      : path.join(rootDir, rawPath)
    : path.join(rootDir, 'collect.env');
  if (!fs.existsSync(envPath)) return;
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  const o = process.env.UDI_COLLECT_ENV_OVERRIDE;
  const fileOverridesShell =
    o !== '0' && o !== 'false' && o !== 'off';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (fileOverridesShell || process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadCollectEnvFile(PROJECT_ROOT);

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
const TOR_WARMUP_MS = intEnv('TOR_WARMUP_MS', 20000);
/** Extra wait after `driver.get` for GDTM / Tor circuits (Tor-only; Playwright uses COLLECTOR_SETTLE_MS). */
const TOR_SETTLE_AFTER_LOAD_MS = intEnv('TOR_SETTLE_AFTER_LOAD_MS', 4000);

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

/** Reduce obvious Playwright/Chromium automation signals (see header: PLAYWRIGHT_AUTOMATION_MITIGATIONS). */
const PLAYWRIGHT_AUTOMATION_MITIGATIONS = (() => {
  const v = process.env.PLAYWRIGHT_AUTOMATION_MITIGATIONS;
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return true;
})();

/**
 * Desktop-style Chrome launch + stealth bundle for **`chrome`** only (see header: CHROME_SIMULATE_REAL_USER).
 * Default **off**; set **`1`/`true`** or use **`collect.env`** for Kasm-style stealth.
 */
const CHROME_SIMULATE_REAL_USER = (() => {
  const v = process.env.CHROME_SIMULATE_REAL_USER;
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return false;
})();

/** When true, non-stealth Chrome masks `navigator.plugins` / `mimeTypes` (see header: DISABLE_PLUGINS). */
const DISABLE_PLUGINS = (() => {
  const v = process.env.DISABLE_PLUGINS;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return false;
})();

/**
 * @param {string} kind chrome|chromium|brave|opera
 */
function chromiumEffectiveMitigations(kind) {
  if (!PLAYWRIGHT_AUTOMATION_MITIGATIONS) return false;
  if (kind === 'chrome' && !CHROME_SIMULATE_REAL_USER) return false;
  return true;
}

/** Off by default — patching `navigator.webdriver` trips “override / own properties” on some risk engines. */
const PLAYWRIGHT_MASK_NAVIGATOR_WEBDRIVER = (() => {
  const v = process.env.PLAYWRIGHT_MASK_NAVIGATOR_WEBDRIVER;
  if (v === '1' || v === 'true') return true;
  return false;
})();

function trimEnv(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === '') return undefined;
  return String(v).trim();
}

/** Map `LANG` like `en_US.UTF-8` → Playwright `en-US` when PLAYWRIGHT_LOCALE is unset. */
function inferredLocaleFromLang() {
  const lang = process.env.LANG || '';
  const m = /^([a-z]{2})(?:_([A-Z]{2}))?/i.exec(lang);
  if (!m) return undefined;
  if (!m[2]) return undefined;
  return `${m[1].toLowerCase()}-${m[2].toUpperCase()}`;
}

/**
 * Locale / timezone for Playwright contexts — fixes Accept-Language vs `navigator.languages` and IP vs browser TZ drift.
 * @returns {import('playwright').BrowserContextOptions}
 */
function playwrightContextLocaleOpts() {
  const out = /** @type {import('playwright').BrowserContextOptions} */ ({});
  const locale = trimEnv('PLAYWRIGHT_LOCALE') || inferredLocaleFromLang();
  const tz = trimEnv('PLAYWRIGHT_TIMEZONE_ID');
  if (locale) out.locale = locale;
  if (tz) out.timezoneId = tz;
  const acceptOverride = trimEnv('PLAYWRIGHT_ACCEPT_LANGUAGE');
  if (acceptOverride) {
    out.extraHTTPHeaders = {
      'Accept-Language': acceptOverride,
    };
  }
  return out;
}

/**
 * Extra Chromium launch options to lower automation/devtools-style fingerprint noise.
 * @param {string} kind chrome|chromium|brave|opera
 * @returns {import('playwright').LaunchOptions}
 */
function chromiumAutomationLaunchOpts(kind) {
  /** @type {import('playwright').LaunchOptions} */
  const out = {};
  if (chromiumEffectiveMitigations(kind)) {
    const args = ['--disable-blink-features=AutomationControlled'];
    if (!HEADLESS) args.push('--start-maximized');
    out.ignoreDefaultArgs = ['--enable-automation'];
    // Stealth Chrome only: do not use Playwright’s default --disable-extensions (keeps extension/plugin surface closer to normal Chrome).
    if (kind === 'chrome') {
      out.ignoreDefaultArgs = [...out.ignoreDefaultArgs, '--disable-extensions'];
    }
    out.args = args;
  }
  // Default (non-stealth) Google Chrome: --disable-extensions unless a real profile is used (extensions must load).
  if (
    kind === 'chrome' &&
    !chromiumEffectiveMitigations(kind) &&
    !trimEnv('CHROME_USER_DATA_DIR')
  ) {
    const extra = ['--disable-extensions'];
    out.args = out.args ? [...out.args, ...extra] : extra;
  }
  // Playwright’s default Chromium args always include --disable-infobars (see playwright-core chromiumSwitches),
  // which suppresses the “controlled by automated test software” infobar even when --enable-automation is present.
  const chromeShowAutomationInfobar =
    kind === 'chrome' &&
    (!CHROME_SIMULATE_REAL_USER || !PLAYWRIGHT_AUTOMATION_MITIGATIONS);
  if (chromeShowAutomationInfobar) {
    const strip = ['--disable-infobars'];
    if (Array.isArray(out.ignoreDefaultArgs)) {
      out.ignoreDefaultArgs = [...out.ignoreDefaultArgs, ...strip];
    } else {
      out.ignoreDefaultArgs = strip;
    }
  }
  return out;
}

/**
 * Persistent profile dir for Chromium when user opts in (see header).
 * @param {string} kind
 * @returns {string | null}
 */
function resolvedChromiumUserDataDir(kind) {
  if (kind === 'chrome') {
    const chromeOnly = trimEnv('CHROME_USER_DATA_DIR');
    if (chromeOnly) {
      return path.resolve(
        chromeOnly.startsWith('~') ? chromeOnly.replace(/^~(?=$|[/\\])/, os.homedir()) : chromeOnly,
      );
    }
  }
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_USER_DATA_DIR;
  if (explicit != null && String(explicit).trim() !== '') {
    return path.resolve(String(explicit).trim());
  }
  const flag = process.env.PLAYWRIGHT_PERSISTENT_CHROMIUM_PROFILE;
  if (flag === '1' || flag === 'true') {
    return path.join(
      os.homedir(),
      '.config',
      'udi-payload-harvest',
      `chromium-profile-${kind}`,
    );
  }
  return null;
}

/**
 * Headed ephemeral `chromium.launch()` often does not show Chrome’s native automation infobar; persistent context does
 * (see Playwright issue #9615 / chromiumSwitches `--disable-infobars` targeting that case).
 * @param {string} kind
 * @returns {string | null}
 */
function chromePersistentProfileForVisibleAutomation(kind) {
  if (kind !== 'chrome' || CHROME_SIMULATE_REAL_USER || HEADLESS) return null;
  return path.join(
    os.homedir(),
    '.config',
    'udi-payload-harvest',
    'chromium-profile-chrome-show-automation',
  );
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} kind chrome|chromium|brave|opera
 */
async function addChromiumMitigationInitScript(context, kind) {
  if (
    !chromiumEffectiveMitigations(kind) ||
    !PLAYWRIGHT_MASK_NAVIGATOR_WEBDRIVER
  ) {
    return;
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });
}

/**
 * Non-stealth Google Chrome only: `--disable-extensions` does not remove built-in PDF (etc.) from `navigator.plugins`.
 * Exposes empty PluginArray / MimeTypeArray-like objects before collector scripts run.
 * @param {import('playwright').BrowserContext} context
 * @param {string} kind
 */
async function addChromeNonStealthEmptyPluginsInitScript(context, kind) {
  if (
    !DISABLE_PLUGINS ||
    kind !== 'chrome' ||
    chromiumEffectiveMitigations(kind)
  ) {
    return;
  }
  await context.addInitScript(() => {
    function buildEmptyPluginArray() {
      const PA = typeof PluginArray !== 'undefined' ? PluginArray : null;
      const p = PA ? Object.create(PA.prototype) : [];
      Object.defineProperty(p, 'length', {
        value: 0,
        enumerable: true,
        configurable: true,
      });
      p.item = () => null;
      p.namedItem = () => null;
      p.refresh = () => {};
      p[Symbol.iterator] = function* () {};
      return p;
    }
    function buildEmptyMimeTypeArray() {
      const MTA = typeof MimeTypeArray !== 'undefined' ? MimeTypeArray : null;
      const m = MTA ? Object.create(MTA.prototype) : [];
      Object.defineProperty(m, 'length', {
        value: 0,
        enumerable: true,
        configurable: true,
      });
      m.item = () => null;
      m.namedItem = () => null;
      m[Symbol.iterator] = function* () {};
      return m;
    }
    const pluginsSingleton = buildEmptyPluginArray();
    const mimeSingleton = buildEmptyMimeTypeArray();
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => pluginsSingleton,
        configurable: true,
      });
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => mimeSingleton,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
    try {
      Object.defineProperty(navigator, 'pdfViewerEnabled', {
        get: () => false,
        configurable: true,
      });
    } catch {
      /* not always configurable */
    }
  });
}

/**
 * @param {string} kind chrome|chromium|brave|opera
 */
async function launchChromiumBrowser(kind) {
  const base = { headless: HEADLESS, ...chromiumAutomationLaunchOpts(kind) };
  switch (kind) {
    case 'chrome': {
      const desktopFile =
        CHROME_SIMULATE_REAL_USER ? process.env.CHROME_DESKTOP_FILE : '';
      if (desktopFile && String(desktopFile).trim()) {
        const exe = parseDesktopEntryChromeExec(String(desktopFile));
        process.stderr.write(
          `[chrome] CHROME_DESKTOP_FILE → executablePath ${exe}\n`,
        );
        return chromium.launch({ ...base, executablePath: exe });
      }
      try {
        return await chromium.launch({ ...base, channel: 'chrome' });
      } catch {
        const exe = resolveExecutable('chrome', [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/opt/google/chrome/chrome',
        ]);
        return chromium.launch({ ...base, executablePath: exe });
      }
    }
    case 'chromium':
      return chromium.launch(base);
    case 'brave': {
      const exe = resolveExecutable('brave', [
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/opt/brave.com/brave/brave-browser',
      ]);
      return chromium.launch({ ...base, executablePath: exe });
    }
    case 'opera': {
      const exe = resolveExecutable('opera', [
        '/usr/bin/opera',
        '/usr/bin/opera-stable',
      ]);
      return chromium.launch({ ...base, executablePath: exe });
    }
    default:
      throw new Error(`launchChromiumBrowser: unsupported kind ${kind}`);
  }
}

/**
 * @param {string} kind
 * @param {string} userDataDir
 */
async function launchPersistentChromiumContext(kind, userDataDir) {
  const base = { headless: HEADLESS, ...chromiumAutomationLaunchOpts(kind) };
  const contextOpts = {
    ignoreHTTPSErrors: PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
    ...playwrightContextLocaleOpts(),
  };
  if (chromiumEffectiveMitigations(kind) && !HEADLESS) {
    contextOpts.viewport = null;
  }
  let context;
  switch (kind) {
    case 'chrome': {
      const desktopFile =
        CHROME_SIMULATE_REAL_USER ? process.env.CHROME_DESKTOP_FILE : '';
      if (desktopFile && String(desktopFile).trim()) {
        const exe = parseDesktopEntryChromeExec(String(desktopFile));
        process.stderr.write(
          `[chrome] CHROME_DESKTOP_FILE → executablePath ${exe}\n`,
        );
        context = await chromium.launchPersistentContext(userDataDir, {
          ...base,
          executablePath: exe,
          ...contextOpts,
        });
        break;
      }
      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          ...base,
          channel: 'chrome',
          ...contextOpts,
        });
      } catch {
        const exe = resolveExecutable('chrome', [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/opt/google/chrome/chrome',
        ]);
        context = await chromium.launchPersistentContext(userDataDir, {
          ...base,
          executablePath: exe,
          ...contextOpts,
        });
      }
      break;
    }
    case 'chromium':
      context = await chromium.launchPersistentContext(userDataDir, {
        ...base,
        ...contextOpts,
      });
      break;
    case 'brave': {
      const exe = resolveExecutable('brave', [
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/opt/brave.com/brave/brave-browser',
      ]);
      context = await chromium.launchPersistentContext(userDataDir, {
        ...base,
        executablePath: exe,
        ...contextOpts,
      });
      break;
    }
    case 'opera': {
      const exe = resolveExecutable('opera', [
        '/usr/bin/opera',
        '/usr/bin/opera-stable',
      ]);
      context = await chromium.launchPersistentContext(userDataDir, {
        ...base,
        executablePath: exe,
        ...contextOpts,
      });
      break;
    }
    default:
      throw new Error(`launchPersistentChromiumContext: unsupported kind ${kind}`);
  }
  await addChromiumMitigationInitScript(context, kind);
  await addChromeNonStealthEmptyPluginsInitScript(context, kind);
  return context;
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} displayName
 */
async function runChromiumCollectorWithPersistentContext(context, displayName) {
  const browser = context.browser();
  // Always open a fresh tab. Restored sessions (real user profiles) often leave `pages()[0]` on
  // chrome:// URLs, NTP, or a restored tab — navigation / waitUntil then misbehaves or appears “stuck”.
  const page = await context.newPage();
  process.stderr.write(
    '[playwright] persistent context: using a new tab for the collector (other restored tabs are left alone).\n',
  );
  await runCollectorInPage(page, browser, displayName);
}

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

function readExecutablePrefix(filePath, byteLen) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(byteLen);
    const n = fs.readSync(fd, buf, 0, byteLen, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n);
  } catch {
    return null;
  }
}

function pathLooksLikeShellScript(filePath) {
  const buf = readExecutablePrefix(filePath, 2);
  if (!buf || buf.length < 2) return false;
  return buf[0] === 0x23 && buf[1] === 0x21; // #!
}

/** On Linux GeckoDriver must be given a real ELF (e.g. **`firefox-bin`**), not shell wrappers. */
function pathLooksLikeLinuxElf(filePath) {
  if (process.platform !== 'linux') return true;
  const buf = readExecutablePrefix(filePath, 4);
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
}

/**
 * Mozilla-style **`firefox`** script often ends with **`exec …/firefox-bin`** (or another path).
 * @param {string} wrapperPath
 * @returns {string|null}
 */
function geckoBinaryFromFirefoxWrapperScript(wrapperPath) {
  const browserDir = path.dirname(wrapperPath);
  let text;
  try {
    text = fs.readFileSync(wrapperPath, 'utf8');
  } catch {
    return null;
  }

  function tryCandidate(rawPath) {
    if (!rawPath || rawPath.includes('$')) return null;
    const p = rawPath.trim().replace(/^["']|["']$/g, '');
    if (!p) return null;
    const candidate = path.isAbsolute(p) ? p : path.join(browserDir, p);
    let st;
    try {
      st = fs.statSync(candidate);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    if (pathLooksLikeShellScript(candidate)) return null;
    if (process.platform === 'linux' && !pathLooksLikeLinuxElf(candidate)) return null;
    return candidate;
  }

  const mozEx = text.match(/^\s*(?:export\s+)?MOZ_EXECUTABLE=(.+)$/m);
  if (mozEx) {
    const fromMoz = tryCandidate(mozEx[1]);
    if (fromMoz) return fromMoz;
  }

  for (const line of text.split(/\r?\n/)) {
    let t = line.trim();
    if (!t || t.startsWith('#') || !/^exec\s+/.test(t)) continue;
    t = t.replace(/^exec\s+/, '').replace(/\s*\\\s*$/g, '').trim();
    const tokens = t.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === 'env') {
        while (i + 1 < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[i + 1])) {
          i++;
        }
        continue;
      }
      if (/^[A-Z_][A-Z0-9_]*=/.test(tok)) continue;
      if (tok.includes('$') || tok.includes('`')) continue;
      const stripped = tok.replace(/^["']|["']$/g, '');
      if (!stripped || stripped.startsWith('-')) continue;
      const got = tryCandidate(stripped);
      if (got) return got;
    }
  }
  return null;
}

/**
 * Linux tarballs may extract to **`~/tor-browser`**, **`~/tor-browser_en-US`**, etc.
 * @returns {string[]} absolute **`…/Browser`** paths
 */
function discoverTorBrowserBrowserDirs() {
  const home = os.homedir();
  /** @type {string[]} */
  const out = [];
  const push = (browserDir) => {
    if (!browserDir || !fs.existsSync(browserDir)) return;
    const abs = path.resolve(browserDir);
    if (!out.includes(abs)) out.push(abs);
  };

  push(path.join(home, 'tor-browser', 'Browser'));

  let dirents;
  try {
    dirents = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    if (!/^tor-browser/i.test(d.name)) continue;
    push(path.join(home, d.name, 'Browser'));
  }
  return out;
}

/**
 * Picks the Gecko ELF under **`Browser/`**: **`firefox-bin`**, non-script **`firefox`**, **`exec` target** from the
 * **`firefox`** wrapper, or any **`firefox*`** ELF in that directory (bundle layout varies by version).
 * @param {string} browserDir e.g. …/tor-browser/Browser
 * @returns {string|null}
 */
function pickGeckoExecutableInBrowserDir(browserDir) {
  if (!browserDir || !fs.existsSync(browserDir)) return null;
  const names = ['firefox-bin', 'firefox'];
  for (const name of names) {
    const p = path.join(browserDir, name);
    if (!fs.existsSync(p)) continue;
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (pathLooksLikeShellScript(p)) continue;
    if (process.platform === 'linux' && !pathLooksLikeLinuxElf(p)) continue;
    return p;
  }

  const wrapper = path.join(browserDir, 'firefox');
  if (fs.existsSync(wrapper) && pathLooksLikeShellScript(wrapper)) {
    const fromExec = geckoBinaryFromFirefoxWrapperScript(wrapper);
    if (fromExec) return fromExec;
  }

  try {
    const entries = fs.readdirSync(browserDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!/^firefox/i.test(ent.name)) continue;
      if (/\.so$/i.test(ent.name)) continue;
      const p = path.join(browserDir, ent.name);
      if (pathLooksLikeShellScript(p)) continue;
      if (process.platform === 'linux' && !pathLooksLikeLinuxElf(p)) continue;
      return p;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * `torbrowser-launcher` stores bundles under ~/.local/share/torbrowser/tbb/<arch>/<dir>/Browser/.
 * @returns {string|null} path to **Browser** directory
 */
function findTbbBrowserDir() {
  const tbb = path.join(os.homedir(), '.local', 'share', 'torbrowser', 'tbb');
  if (!fs.existsSync(tbb)) return null;
  let archDirents;
  try {
    archDirents = fs.readdirSync(tbb, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const archDir of archDirents) {
    if (!archDir.isDirectory()) continue;
    const archPath = path.join(tbb, archDir.name);
    let inner;
    try {
      inner = fs.readdirSync(archPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const bundleDir of inner) {
      if (!bundleDir.isDirectory()) continue;
      const browserDir = path.join(archPath, bundleDir.name, 'Browser');
      if (fs.existsSync(browserDir)) return browserDir;
    }
  }
  return null;
}

/**
 * @param {string} resolvedPath file or directory from TOR_BROWSER_PATH
 * @returns {string[]}
 */
function expandEnvTorBrowserPath(resolvedPath) {
  let st;
  try {
    st = fs.statSync(resolvedPath);
  } catch {
    return [resolvedPath];
  }
  if (st.isDirectory()) {
    const p = pickGeckoExecutableInBrowserDir(resolvedPath);
    return p ? [p] : [];
  }
  if (!st.isFile()) return [];

  if (pathLooksLikeShellScript(resolvedPath)) {
    const dir = path.dirname(resolvedPath);
    const bin = path.join(dir, 'firefox-bin');
    if (fs.existsSync(bin) && !pathLooksLikeShellScript(bin)) {
      if (process.platform !== 'linux' || pathLooksLikeLinuxElf(bin)) {
        return [bin];
      }
    }
    throw new Error(
      `TOR_BROWSER_PATH points to a shell script (${resolvedPath}). Selenium needs the Gecko ELF, usually …/Browser/firefox-bin — unset TOR_BROWSER_PATH to auto-detect, or set it to firefox-bin.`,
    );
  }
  if (process.platform === 'linux' && !pathLooksLikeLinuxElf(resolvedPath)) {
    return [resolvedPath];
  }
  return [resolvedPath];
}

/**
 * GeckoDriver needs the **ELF** inside the bundle (**`firefox-bin`**, or a non-script **`firefox`**).
 * **`Browser/firefox`** is often a **`#!` wrapper**; **`/usr/bin/tor-browser`** is usually a distro script.
 */
function resolveTorBrowserFirefoxBinary() {
  const envRaw = (process.env.TOR_BROWSER_PATH || '').trim();
  const orderedPaths = [];

  if (envRaw) {
    orderedPaths.push(...expandEnvTorBrowserPath(path.resolve(envRaw)));
  }

  const pushFromBrowserDir = (browserDir) => {
    const p = pickGeckoExecutableInBrowserDir(browserDir);
    if (p) orderedPaths.push(p);
  };

  for (const browserDir of discoverTorBrowserBrowserDirs()) {
    pushFromBrowserDir(browserDir);
  }

  const tbbBrowser = findTbbBrowserDir();
  if (tbbBrowser) pushFromBrowserDir(tbbBrowser);
  pushFromBrowserDir('/usr/local/tor-browser/Browser');
  pushFromBrowserDir('/opt/tor-browser/Browser');

  orderedPaths.push('/usr/bin/tor-browser', '/usr/local/bin/tor-browser');

  const seen = new Set();
  for (const p of orderedPaths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    if (pathLooksLikeShellScript(p)) {
      process.stderr.write(
        `Tor: skipping launcher script (not a Gecko binary): ${p}\n`,
      );
      continue;
    }
    if (process.platform === 'linux' && !pathLooksLikeLinuxElf(p)) {
      continue;
    }
    return p;
  }

  const homeTorDirs = (() => {
    try {
      return fs
        .readdirSync(os.homedir(), { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^tor-browser/i.test(d.name))
        .map((d) => path.join(os.homedir(), d.name));
    } catch {
      return [];
    }
  })();

  let hint;
  if (homeTorDirs.length) {
    hint = ` Under home: ${homeTorDirs.join(', ')} — look for **Browser/firefox-bin** or an ELF **firefox**; the Linux tarball often extracts as **tor-browser_en-US** (collector now scans **tor-browser***).`;
  } else {
    hint =
      ' No **~/tor-browser*** folder — Tor is missing (install failed, 403, or non-persistent Kasm home). Re-run **setup-kasm-ubuntu.sh**; set **TOR_BROWSER_PATH** to the real Gecko binary if Tor lives elsewhere.';
  }

  throw new Error(`No usable Tor Browser Gecko binary.${hint}`);
}

/**
 * Real Tor Browser is stock Mozilla Gecko without Playwright’s **Juggler** protocol — `firefox.launch`
 * hangs waiting for the pipe. Use **Marionette** via Selenium + GeckoDriver instead.
 */
async function buildTorWebDriver() {
  const exe = resolveTorBrowserFirefoxBinary();
  process.stderr.write(`Tor: binary ${exe}\n`);

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

const DEFAULT_BROWSERS = [
  'chrome',
  'chromium',
  'firefox',
  'tor',
  'brave',
];

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
 * Load ~/.config/udi-payload-harvest/git-push.env (written by setup-kasm-ubuntu.sh) so AUTO_PUSH works from
 * non-login shells and IDEs that never source ~/.bashrc.
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
function mergeUdiGitPushEnv(base) {
  const f = path.join(
    os.homedir(),
    '.config',
    'udi-payload-harvest',
    'git-push.env',
  );
  if (!fs.existsSync(f)) return base;
  const r = spawnSync(
    'bash',
    [
      '-c',
      'set -a && source "$1" && set +a && printf "%s\\0%s\\0" "${GITHUB_USERNAME-}" "${GITHUB_TOKEN-}"',
      '_',
      f,
    ],
    { encoding: 'buffer' },
  );
  if (r.status !== 0 || !r.stdout) return base;
  const s = r.stdout.toString('utf8');
  const parts = s.split('\0');
  const username = parts[0] || '';
  const token = parts[1] || '';
  const out = { ...base };
  if (username && !out.GITHUB_USERNAME) out.GITHUB_USERNAME = username;
  if (token && !out.GITHUB_TOKEN) out.GITHUB_TOKEN = token;
  return out;
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
    env: mergeUdiGitPushEnv(process.env),
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

/**
 * First argument of an Exec= line (quoted segments supported).
 * @param {string} s
 */
function firstExecArgv0(s) {
  const trimmed = s.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"')) {
    let out = '';
    for (let i = 1; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === '\\') {
        i += 1;
        out += trimmed[i] ?? '';
        continue;
      }
      if (c === '"') break;
      out += c;
    }
    return out;
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/)[0] || '';
}

/**
 * Strip `VAR=value` prefixes sometimes used before the real binary in Exec=.
 * @param {string} s
 */
function stripExecEnvAssignments(s) {
  let rest = s.trim();
  for (;;) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=\S+\s+/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  return rest;
}

/**
 * Resolve a Chrome binary token to an existing path (absolute or via `which`).
 * @param {string} token
 */
function resolveChromeBinaryToken(token) {
  if (!token) {
    throw new Error('CHROME_DESKTOP_FILE: empty binary in Exec=');
  }
  if (path.isAbsolute(token)) {
    if (fs.existsSync(token)) return token;
    throw new Error(`CHROME_DESKTOP_FILE: Exec binary not found: ${token}`);
  }
  const w = spawnSync('which', [token], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout) {
    const p = w.stdout.trim().split('\n')[0];
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    `CHROME_DESKTOP_FILE: Exec binary not in PATH or missing: ${token}`,
  );
}

/**
 * Read [Desktop Entry] Exec= from a .desktop file; return resolved Chrome executable path.
 * @param {string} desktopPath
 */
function parseDesktopEntryChromeExec(desktopPath) {
  const resolved = path.resolve(desktopPath.trim());
  if (!fs.existsSync(resolved)) {
    throw new Error(`CHROME_DESKTOP_FILE not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  let inDesktopEntry = false;
  let execLine = '';
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inDesktopEntry = trimmed === '[Desktop Entry]';
      continue;
    }
    if (!inDesktopEntry || !trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('Exec=')) {
      const eq = line.indexOf('=');
      execLine = eq >= 0 ? line.slice(eq + 1) : '';
      break;
    }
  }
  if (!execLine) {
    throw new Error(`No Exec= in [Desktop Entry] for ${resolved}`);
  }
  let s = execLine
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
    .replace(/\\s/g, ' ');
  s = s.replace(/%%/g, '\u0000PCT\u0000');
  s = s.replace(/%[a-zA-Z]/g, '');
  s = s.replace(/\u0000PCT\u0000/g, '%');
  s = stripExecEnvAssignments(s);
  const bin = firstExecArgv0(s);
  return resolveChromeBinaryToken(bin);
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
 * @param {import('playwright').Browser | null} browser
 * @param {string} displayName
 */
async function runCollectorInPage(page, browser, displayName) {
  let version = '';
  try {
    version = browser ? await browser.version() : 'unknown';
  } catch {
    version = 'unknown';
  }

  process.stderr.write(`[collect] Navigating to ${COLLECTOR_URL} …\n`);
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
 * @param {string} kind
 */
async function runOneBrowser(browser, displayName, kind) {
  const isChromium = browser.browserType().name() === 'chromium';
  const contextOpts = {
    ignoreHTTPSErrors: PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
    ...playwrightContextLocaleOpts(),
  };
  if (chromiumEffectiveMitigations(kind) && isChromium && !HEADLESS) {
    contextOpts.viewport = null;
  }
  const context = await browser.newContext(contextOpts);
  if (isChromium) await addChromiumMitigationInitScript(context, kind);
  if (isChromium) await addChromeNonStealthEmptyPluginsInitScript(context, kind);
  const page = await context.newPage();
  try {
    await runCollectorInPage(page, browser, displayName);
  } finally {
    await context.close();
  }
}

async function launchBrowser(kind) {
  const nonChromiumOpts = { headless: HEADLESS };
  switch (kind) {
    case 'chrome':
    case 'chromium':
    case 'brave':
    case 'opera':
      return launchChromiumBrowser(kind);
    case 'firefox': {
      const exe = process.env.FIREFOX_PATH || undefined;
      return firefox.launch(
        firefoxLaunchOptions(
          exe
            ? { ...nonChromiumOpts, executablePath: exe }
            : nonChromiumOpts,
        ),
      );
    }
    case 'tor':
      throw new Error('Tor uses runTorSelenium() — not launchBrowser(tor)');
    case 'webkit':
      return webkit.launch(nonChromiumOpts);
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
  process.stderr.write(`[collect] UDIBROWSERS effective: ${kinds.join(', ')}\n`);
  const failures = [];

  for (const kind of kinds) {
    const label = displayLabel(kind);
    process.stderr.write(`\n>>> ${label} (${kind})\n`);

    if (kind === 'chrome') {
      const chromeProfile = trimEnv('CHROME_USER_DATA_DIR');
      if (chromeProfile) {
        process.stderr.write(
          `[chrome] CHROME_USER_DATA_DIR: extensions and settings load from this profile; quit other Chrome sessions using it if you see a profile lock error.\n`,
        );
      } else if (
        trimEnv('CHROME_DESKTOP_FILE') &&
        !(process.env.PLAYWRIGHT_CHROMIUM_USER_DATA_DIR || '').trim()
      ) {
        process.stderr.write(
          '[chrome] CHROME_DESKTOP_FILE sets the Chrome binary only. To use your real profile (e.g. Canvas Blocker), set CHROME_USER_DATA_DIR (Linux: ~/.config/google-chrome).\n',
        );
      }
    }

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

    const chromiumKinds = new Set(['chrome', 'chromium', 'brave', 'opera']);
    const userDataDir = chromiumKinds.has(kind)
      ? resolvedChromiumUserDataDir(kind) ??
        chromePersistentProfileForVisibleAutomation(kind)
      : null;

    if (userDataDir) {
      try {
        fs.mkdirSync(userDataDir, { recursive: true });
        process.stderr.write(
          `[playwright] persistent Chromium userDataDir ${userDataDir}\n`,
        );
        if (
          kind === 'chrome' &&
          !CHROME_SIMULATE_REAL_USER &&
          resolvedChromiumUserDataDir(kind) == null
        ) {
          process.stderr.write(
            '[chrome] CHROME_SIMULATE_REAL_USER=0: using this profile so the native automation infobar can appear (ephemeral launch usually does not show it).\n',
          );
        }
        const context = await launchPersistentChromiumContext(kind, userDataDir);
        try {
          await runChromiumCollectorWithPersistentContext(context, label);
          process.stderr.write(`OK: ${label}\n`);
        } catch (e) {
          failures.push({ kind, phase: 'run', error: e });
          process.stderr.write(`Run failed: ${e?.message || e}\n`);
        } finally {
          await context.close().catch(() => {});
        }
      } catch (e) {
        failures.push({ kind, phase: 'launch', error: e });
        process.stderr.write(`Launch failed: ${e?.message || e}\n`);
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
      await runOneBrowser(browser, label, kind);
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
