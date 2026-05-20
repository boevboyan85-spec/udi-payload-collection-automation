import { chromium, firefox, webkit } from "playwright";

import {
  resolveChromeBinaryPath,
  resolveEdgeBinaryPath,
  resolveFirefoxBinaryPath,
} from "./browserBinaries.js";
import { chromiumNoSandboxArgs } from "./browserLaunchArgs.js";
import {
  TARGET_URL,
  PAYLOAD_ELEMENT_ID,
  PAYLOAD_TIMEOUT_MS,
  resolveHeadless,
} from "./config.js";
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
  const browser = await browserType.launch({
    headless,
    ...launchOverrides,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
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
      payload,
      documentHasFocus,
      documentVisibility,
    };
  } finally {
    await browser.close();
  }
}

function chromiumLaunchOptions() {
  const extraArgs = chromiumNoSandboxArgs();
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
  const launchOptions = {};
  if (process.platform === "win32") {
    const firefoxBin = resolveFirefoxBinaryPath();
    if (!firefoxBin) {
      return Promise.reject(
        new Error(
          "Firefox binary not found. Install Firefox or set FIREFOX_BIN (see install:browsers on Windows)."
        )
      );
    }
    launchOptions.executablePath = firefoxBin;
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

export const runPlaywrightWebkit = () => runPlaywright(webkit, "webkit");
