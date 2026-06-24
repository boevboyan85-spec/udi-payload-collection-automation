import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import edge from "selenium-webdriver/edge.js";
import firefox from "selenium-webdriver/firefox.js";
import safari from "selenium-webdriver/safari.js";

import {
  resolveBraveBinaryPath,
  resolveChromeBinaryPath,
  resolveChromiumBinaryPath,
  resolveFirefoxBinaryPath,
  resolveEdgeBinaryPath,
} from "./browserBinaries.js";
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
} from "./stealth.js";
import { getDocumentFocusCsvColumnsFromEncodedUdi } from "./udiDecompress.js";

async function waitForPayloadValue(driver, timeoutMs) {
  const start = Date.now();
  const delay = 500;
  while (Date.now() - start < timeoutMs) {
    try {
      const el = await driver.findElement(By.id(PAYLOAD_ELEMENT_ID));
      const v = await el.getAttribute("value");
      if (v != null && String(v).trim() !== "") {
        return String(v);
      }
    } catch {
      // element not ready yet
    }
    await driver.sleep(delay);
  }
  throw new Error(
    `Timeout: no non-empty value in #${PAYLOAD_ELEMENT_ID} after ${timeoutMs}ms`
  );
}

async function runWithDriver(buildDriver, browserLabel, headless, stealth = false) {
  const driver = await buildDriver();
  try {
    await driver.manage().setTimeouts({ pageLoad: 120_000, implicit: 0 });
    await driver.get(TARGET_URL);
    await driver.wait(until.elementLocated(By.id(PAYLOAD_ELEMENT_ID)), 60_000);
    const payload = await waitForPayloadValue(driver, PAYLOAD_TIMEOUT_MS);
    const { documentHasFocus, documentVisibility } =
      getDocumentFocusCsvColumnsFromEncodedUdi(payload);
    return {
      type: "selenium",
      browser: browserLabel,
      headless,
      stealth,
      payload,
      documentHasFocus,
      documentVisibility,
    };
  } finally {
    await driver.quit();
  }
}

/**
 * Chromium-family options. In stealth mode, drop the WebDriver flag via the Blink switch
 * and stop Selenium advertising automation (`enable-automation`).
 * @param {boolean} headless
 * @param {boolean} [stealth]
 */
function buildChromiumOptions(headless, stealth = false) {
  const opts = new chrome.Options().addArguments("--window-size=1280,900");
  for (const arg of chromiumNoSandboxArgs()) {
    opts.addArguments(arg);
  }
  if (stealth) {
    for (const arg of stealthChromiumArgs()) {
      opts.addArguments(arg);
    }
    opts.excludeSwitches("enable-automation");
  }
  if (headless) {
    opts.addArguments("--headless=new");
  }
  return opts;
}

export function runSeleniumChrome() {
  const headless = resolveHeadless("SELENIUM_HEADLESS");
  const stealth = resolveStealth("SELENIUM_STEALTH");
  return runWithDriver(
    () => {
      const opts = buildChromiumOptions(headless, stealth);
      const chromeBin = resolveChromeBinaryPath();
      if (chromeBin) opts.setChromeBinaryPath(chromeBin);
      return new Builder().forBrowser("chrome").setChromeOptions(opts).build();
    },
    "chrome",
    headless,
    stealth
  );
}

export function runSeleniumChromium() {
  const headless = resolveHeadless("SELENIUM_HEADLESS");
  const stealth = resolveStealth("SELENIUM_STEALTH");
  const chromiumBin = resolveChromiumBinaryPath();
  if (!chromiumBin) {
    return Promise.reject(
      new Error("Chromium binary not found for Selenium (set CHROMIUM_BIN).")
    );
  }
  return runWithDriver(
    () => {
      const opts = buildChromiumOptions(headless, stealth);
      opts.setChromeBinaryPath(chromiumBin);
      return new Builder().forBrowser("chrome").setChromeOptions(opts).build();
    },
    "chromium",
    headless,
    stealth
  );
}

export function runSeleniumFirefox() {
  const headless = resolveHeadless("SELENIUM_HEADLESS");
  const stealth = resolveStealth("SELENIUM_STEALTH");
  return runWithDriver(
    () => {
      const opts = new firefox.Options().windowSize({ width: 1280, height: 900 });
      if (headless) opts.addArguments("-headless");
      if (stealth) {
        for (const [key, value] of Object.entries(stealthFirefoxPrefs())) {
          opts.setPreference(key, value);
        }
      }
      const firefoxBin = resolveFirefoxBinaryPath();
      if (firefoxBin) opts.setBinary(firefoxBin);
      return new Builder().forBrowser("firefox").setFirefoxOptions(opts).build();
    },
    "firefox",
    headless,
    stealth
  );
}

export function runSeleniumEdge() {
  const headless = resolveHeadless("SELENIUM_HEADLESS");
  const stealth = resolveStealth("SELENIUM_STEALTH");
  const edgeBin = resolveEdgeBinaryPath();
  if (!edgeBin) {
    return Promise.reject(new Error("Microsoft Edge binary not found (set EDGE_BIN)."));
  }
  return runWithDriver(
    () => {
      const opts = new edge.Options().addArguments("--window-size=1280,900");
      for (const arg of chromiumNoSandboxArgs()) {
        opts.addArguments(arg);
      }
      if (stealth) {
        for (const arg of stealthChromiumArgs()) {
          opts.addArguments(arg);
        }
        opts.excludeSwitches("enable-automation");
      }
      if (headless) opts.addArguments("--headless=new");
      opts.setBinaryPath(edgeBin);
      return new Builder().forBrowser("MicrosoftEdge").setEdgeOptions(opts).build();
    },
    "edge",
    headless,
    stealth
  );
}

export function runSeleniumBrave() {
  const headless = resolveHeadless("SELENIUM_HEADLESS");
  const stealth = resolveStealth("SELENIUM_STEALTH");
  const braveBin = resolveBraveBinaryPath();
  if (!braveBin) {
    return Promise.reject(new Error("Brave binary not found (set BRAVE_BIN)."));
  }
  return runWithDriver(
    () => {
      const opts = buildChromiumOptions(headless, stealth);
      opts.setChromeBinaryPath(braveBin);
      return new Builder().forBrowser("chrome").setChromeOptions(opts).build();
    },
    "brave",
    headless,
    stealth
  );
}

export function runSeleniumSafari() {
  const server = (
    process.env.SELENIUM_SAFARI_SERVER || process.env.SAFARIDRIVER_URL || ""
  ).trim();
  const builder = new Builder()
    .forBrowser("safari")
    .setSafariOptions(new safari.Options());
  if (server) {
    return runWithDriver(() => builder.usingServer(server).build(), "safari", false);
  }
  return runWithDriver(() => builder.build(), "safari", false);
}
