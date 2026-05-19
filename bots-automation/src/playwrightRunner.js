import { chromium, firefox, webkit } from "playwright";

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
 * @param {boolean} [chromiumBased]
 */
async function runPlaywright(browserType, browserLabel, chromiumBased = false) {
  const headless = resolveHeadless("PLAYWRIGHT_HEADLESS");
  const extraArgs = chromiumBased ? chromiumNoSandboxArgs() : [];
  const browser = await browserType.launch({
    headless,
    args: extraArgs.length ? extraArgs : undefined,
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

export const runPlaywrightChromium = () => runPlaywright(chromium, "chromium", true);
export const runPlaywrightFirefox = () => runPlaywright(firefox, "firefox");
export const runPlaywrightWebkit = () => runPlaywright(webkit, "webkit");
