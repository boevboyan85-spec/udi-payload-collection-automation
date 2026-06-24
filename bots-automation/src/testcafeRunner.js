import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import {
  PAYLOAD_ELEMENT_ID,
  TARGET_URL,
  resolveHeadless,
} from "./config.js";
import { resolveStealth, STEALTH_INIT_SCRIPT } from "./stealth.js";
import { formatTestcafeBrowserString } from "./testcafeBrowser.js";
import { getTestcafeRunTimeouts } from "./testcafeTimeouts.js";
import { getDocumentFocusCsvColumnsFromEncodedUdi } from "./udiDecompress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * TestCafe does not return values from tests; the test writes the payload to a temp file.
 * @param {string} browserArg - e.g. "chrome", "firefox" (TestCafe browser alias)
 */
async function runTestcafe(browserArg) {
  const { default: createTestCafe } = await import("testcafe");
  const testFile = path.join(__dirname, "testcafe", "collector-test.js");
  const outFile = path.join(
    os.tmpdir(),
    `bots-tc-payload-${Date.now()}-${browserArg}.txt`
  );
  const headless = resolveHeadless("TESTCAFE_HEADLESS");
  const stealth = resolveStealth("TESTCAFE_STEALTH");
  const tcBrowser = formatTestcafeBrowserString(browserArg, headless, stealth);
  const timeouts = getTestcafeRunTimeouts(browserArg, headless);

  const prev = {
    COLLECTOR_URL: process.env.COLLECTOR_URL,
    BOTS_TC_OUT: process.env.BOTS_TC_OUT,
    BOTS_PAYLOAD_TIMEOUT_MS: process.env.BOTS_PAYLOAD_TIMEOUT_MS,
    BOTS_PAYLOAD_ELEMENT_ID: process.env.BOTS_PAYLOAD_ELEMENT_ID,
  };

  process.env.COLLECTOR_URL = process.env.COLLECTOR_URL || TARGET_URL;
  process.env.BOTS_TC_OUT = outFile;
  process.env.BOTS_PAYLOAD_TIMEOUT_MS = String(timeouts.payloadTimeout);
  process.env.BOTS_PAYLOAD_ELEMENT_ID = PAYLOAD_ELEMENT_ID;

  let testcafe;
  try {
    testcafe = await createTestCafe();
    const runner = testcafe.createRunner().src(testFile).browsers(tcBrowser);
    if (stealth) {
      // TestCafe drives the page through a proxy (no WebDriver), so inject the override
      // before page scripts run rather than via launch flags.
      runner.clientScripts({ content: STEALTH_INIT_SCRIPT });
    }
    const failedCount = await runner.run({
        skipJsErrors: true,
        pageLoadTimeout: timeouts.pageLoadTimeout,
        selectorTimeout: timeouts.selectorTimeout,
        assertionTimeout: timeouts.assertionTimeout,
        testExecutionTimeout: timeouts.testExecutionTimeout,
        runExecutionTimeout: timeouts.runExecutionTimeout,
        browserInitTimeout: timeouts.browserInitTimeout,
      });

    if (failedCount !== 0) {
      throw new Error(`TestCafe reported ${failedCount} failed test(s)`);
    }
    if (!fs.existsSync(outFile)) {
      throw new Error("TestCafe did not write payload file");
    }
    const raw = fs.readFileSync(outFile, "utf8");
    let payload;
    try {
      const parsed = JSON.parse(raw);
      payload = parsed.payload ?? "";
    } catch {
      payload = raw;
    }
    if (!String(payload).trim()) {
      throw new Error(
        `TestCafe finished but payload is empty (waited ${timeouts.payloadTimeout}ms)`
      );
    }
    const { documentHasFocus, documentVisibility } =
      getDocumentFocusCsvColumnsFromEncodedUdi(payload);
    return {
      type: "testcafe",
      browser: browserArg,
      headless,
      stealth,
      payload,
      documentHasFocus,
      documentVisibility,
    };
  } finally {
    try {
      fs.unlinkSync(outFile);
    } catch {
      // ignore
    }
    if (testcafe) {
      await testcafe.close();
    }
    if (prev.COLLECTOR_URL === undefined) delete process.env.COLLECTOR_URL;
    else process.env.COLLECTOR_URL = prev.COLLECTOR_URL;
    if (prev.BOTS_TC_OUT === undefined) delete process.env.BOTS_TC_OUT;
    else process.env.BOTS_TC_OUT = prev.BOTS_TC_OUT;
    if (prev.BOTS_PAYLOAD_TIMEOUT_MS === undefined) {
      delete process.env.BOTS_PAYLOAD_TIMEOUT_MS;
    } else process.env.BOTS_PAYLOAD_TIMEOUT_MS = prev.BOTS_PAYLOAD_TIMEOUT_MS;
    if (prev.BOTS_PAYLOAD_ELEMENT_ID === undefined) {
      delete process.env.BOTS_PAYLOAD_ELEMENT_ID;
    } else process.env.BOTS_PAYLOAD_ELEMENT_ID = prev.BOTS_PAYLOAD_ELEMENT_ID;
  }
}

export const runTestcafeChrome = () => runTestcafe("chrome");
export const runTestcafeChromium = () => runTestcafe("chromium");
export const runTestcafeFirefox = () => runTestcafe("firefox");
export const runTestcafeEdge = () => runTestcafe("edge");
export const runTestcafeBrave = () => runTestcafe("brave");
export const runTestcafeSafari = () => runTestcafe("safari");
