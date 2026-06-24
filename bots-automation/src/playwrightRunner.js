import { chromium, firefox, webkit } from "playwright";

import {
  resolveBraveBinaryPath,
  resolveChromeBinaryPath,
  resolveEdgeBinaryPath,
} from "./browserBinaries.js";
import { resolvePlaywrightFirefoxBinaryPath } from "./firefoxBinary.js";
import { chromiumNoSandboxArgs } from "./browserLaunchArgs.js";
import {
  TARGET_URL,
  PAYLOAD_ELEMENT_ID,
  PAYLOAD_TIMEOUT_MS,
  resolveHeadless,
} from "./config.js";
import {
  resolveStealth,
  stealthChromiumArgs,
  stealthFirefoxPrefs,
  STEALTH_INIT_SCRIPT,
} from "./stealth.js";
import { getDocumentFocusCsvColumnsFromEncodedUdi } from "./udiDecompress.js";
import { waitForNonEmptyValue } from "./waitForPayload.js";

const SELECTOR = `#${PAYLOAD_ELEMENT_ID}`;

/**
 * @param {import('playwright').BrowserType} browserType
 * @param {string} browserLabel
 * @param {import('playwright').LaunchOptions} [launchOverrides]
 */
async function runPlaywright(browserType, browserLabel, launchOverrides = {}) {
  const headless = resolveHeadless("PLAYWRIGHT_HEADLESS");
  const stealth = resolveStealth("PLAYWRIGHT_STEALTH");
  const browser = await browserType.launch({
    headless,
    ...launchOverrides,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    if (stealth) {
      await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
    }
    const page = await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 120_000 });

    const payload = await waitForNonEmptyValue(async () => {
      try {
        return await page.locator(SELECTOR).inputValue();
      } catch {
        return "";
      }
    }, PAYLOAD_TIMEOUT_MS);

    const { documentHasFocus, documentVisibility } =
      getDocumentFocusCsvColumnsFromEncodedUdi(payload);

    return {
      type: "playwright",
      browser: browserLabel,
      headless,
      stealth,
      payload,
      documentHasFocus,
      documentVisibility,
    };
  } finally {
    await browser.close();
  }
}

function chromiumLaunchOptions() {
  const extraArgs = [
    ...chromiumNoSandboxArgs(),
    ...(resolveStealth("PLAYWRIGHT_STEALTH") ? stealthChromiumArgs() : []),
  ];
  return extraArgs.length ? { args: extraArgs } : {};
}

export const runPlaywrightChromium = () =>
  runPlaywright(chromium, "chromium", chromiumLaunchOptions());

export function runPlaywrightChrome() {
  const chromeBin = resolveChromeBinaryPath();
  const launchOptions = chromiumLaunchOptions();
  if (chromeBin) {
    launchOptions.executablePath = chromeBin;
  } else if (process.platform === "win32" || process.platform === "darwin") {
    launchOptions.channel = "chrome";
  } else {
    return Promise.reject(
      new Error(
        "Google Chrome binary not found. Install Chrome or set CHROME_BIN."
      )
    );
  }
  return runPlaywright(chromium, "chrome", launchOptions);
}

export function runPlaywrightFirefox() {
  // Playwright needs its bundled Firefox (juggler), not retail Mozilla Firefox.
  // System firefox.exe is used by Puppeteer / Selenium / TestCafe via FIREFOX_BIN.
  const launchOptions = {};
  const pwFirefox = resolvePlaywrightFirefoxBinaryPath();
  if (pwFirefox) {
    launchOptions.executablePath = pwFirefox;
  }
  if (resolveStealth("PLAYWRIGHT_STEALTH")) {
    launchOptions.firefoxUserPrefs = stealthFirefoxPrefs();
  }
  return runPlaywright(firefox, "firefox", launchOptions);
}

export function runPlaywrightEdge() {
  const edgeBin = resolveEdgeBinaryPath();
  const launchOptions = chromiumLaunchOptions();
  if (edgeBin) {
    launchOptions.executablePath = edgeBin;
  } else if (process.platform === "win32" || process.platform === "darwin") {
    launchOptions.channel = "msedge";
  } else {
    return Promise.reject(
      new Error(
        "Microsoft Edge binary not found. Install Edge or set EDGE_BIN."
      )
    );
  }
  return runPlaywright(chromium, "edge", launchOptions);
}

export function runPlaywrightBrave() {
  const braveBin = resolveBraveBinaryPath();
  const launchOptions = chromiumLaunchOptions();
  if (!braveBin) {
    return Promise.reject(
      new Error(
        "Brave binary not found. Install Brave or set BRAVE_BIN (see install:browsers)."
      )
    );
  }
  launchOptions.executablePath = braveBin;
  return runPlaywright(chromium, "brave", launchOptions);
}

export const runPlaywrightWebkit = () => runPlaywright(webkit, "webkit");
