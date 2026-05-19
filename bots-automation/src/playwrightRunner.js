import { chromium, firefox, webkit } from "playwright";

import { resolveEdgeBinaryPath } from "./browserBinaries.js";
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

export const runPlaywrightFirefox = () => runPlaywright(firefox, "firefox");

export function runPlaywrightEdge() {
  const edgeBin = resolveEdgeBinaryPath();
  const launchOptions = chromiumLaunchOptions();
  if (process.platform === "linux" || process.platform === "win32") {
    if (!edgeBin) {
      return Promise.reject(
        new Error(
          "Microsoft Edge binary not found. On Ubuntu run: npm run install:browsers or set EDGE_BIN."
        )
      );
    }
    launchOptions.executablePath = edgeBin;
  } else if (edgeBin) {
    launchOptions.executablePath = edgeBin;
  } else {
    launchOptions.channel = "msedge";
  }
  return runPlaywright(chromium, "edge", launchOptions);
}

export const runPlaywrightWebkit = () => runPlaywright(webkit, "webkit");
