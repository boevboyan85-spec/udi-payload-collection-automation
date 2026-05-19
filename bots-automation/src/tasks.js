/**
 * Platform-aware automation matrix (macOS vs Ubuntu/Kasm).
 */
import {
  isDualCollectionEnabled,
  runWithGlobalHeadless,
} from "./config.js";
import {
  isChromeAvailable,
  isChromiumAvailable,
  isEdgeAvailable,
  isFirefoxAvailable,
} from "./browserBinaries.js";
import { getPlatformProfile } from "./platform.js";
import { runPuppeteerChrome, runPuppeteerChromium, runPuppeteerFirefox } from "./puppeteerRunner.js";
import {
  runPlaywrightChromium,
  runPlaywrightFirefox,
  runPlaywrightWebkit,
} from "./playwrightRunner.js";
import {
  runSeleniumChrome,
  runSeleniumChromium,
  runSeleniumEdge,
  runSeleniumFirefox,
  runSeleniumSafari,
} from "./seleniumRunner.js";
import {
  runTestcafeChrome,
  runTestcafeChromium,
  runTestcafeEdge,
  runTestcafeFirefox,
  runTestcafeSafari,
} from "./testcafeRunner.js";

/**
 * @param {boolean} dual
 * @param {string} label
 * @param {() => Promise<unknown>} run
 */
function expandDual(dual, label, run) {
  if (!dual) {
    return [{ name: label, run }];
  }
  return [
    {
      name: `${label} (headless)`,
      run: () => runWithGlobalHeadless(true, run),
    },
    {
      name: `${label} (headed)`,
      run: () => runWithGlobalHeadless(false, run),
    },
  ];
}

/** Native Safari: headed only in dual mode. */
function expandSafariDual(dual, label, run) {
  if (!dual) {
    return [{ name: label, run }];
  }
  return [
    {
      name: `${label} (headed)`,
      run: () => runWithGlobalHeadless(false, run),
    },
  ];
}

/**
 * @param {boolean} dual
 * @param {string} toolLabel
 * @param {string} browserLabel
 * @param {() => Promise<unknown>} run
 * @param {{ safari?: boolean }} [opts]
 */
function addBrowserTasks(tasks, dual, toolLabel, browserLabel, run, opts = {}) {
  const label = `${toolLabel} + ${browserLabel}`;
  if (opts.safari) {
    tasks.push(...expandSafariDual(dual, label, run));
  } else {
    tasks.push(...expandDual(dual, label, run));
  }
}

export function buildTaskList() {
  const dual = isDualCollectionEnabled();
  const profile = getPlatformProfile();
  const tasks = [];

  const skipSafari =
    process.env.BOTS_SKIP_SELENIUM_SAFARI === "true" ||
    process.env.BOTS_SKIP_SELENIUM_SAFARI === "1";

  const hasChrome = isChromeAvailable();
  const hasChromium = isChromiumAvailable();
  const hasFirefox = isFirefoxAvailable();
  const hasEdge = isEdgeAvailable();

  // —— Chrome ——
  addBrowserTasks(tasks, dual, "Puppeteer", "Chrome", runPuppeteerChrome);
  if (hasChrome) {
    addBrowserTasks(tasks, dual, "TestCafe", "Chrome", runTestcafeChrome);
    addBrowserTasks(tasks, dual, "Selenium", "Chrome", runSeleniumChrome);
  } else {
    console.warn(
      "[skip] TestCafe/Selenium + Chrome: install Google Chrome or set CHROME_BIN (Puppeteer uses its bundled Chrome if needed)."
    );
  }

  // —— Chromium (Playwright bundle + optional system binary) ——
  addBrowserTasks(tasks, dual, "Playwright", "Chromium", runPlaywrightChromium);
  if (hasChromium) {
    addBrowserTasks(tasks, dual, "Puppeteer", "Chromium", runPuppeteerChromium);
    addBrowserTasks(tasks, dual, "TestCafe", "Chromium", runTestcafeChromium);
    addBrowserTasks(tasks, dual, "Selenium", "Chromium", runSeleniumChromium);
  } else if (profile.platform === "ubuntu" || profile.platform === "linux") {
    console.warn(
      "[skip] Puppeteer/TestCafe/Selenium + Chromium: run `npm run install:browsers` or set CHROMIUM_BIN."
    );
  }

  // —— Firefox ——
  addBrowserTasks(tasks, dual, "Puppeteer", "Firefox", runPuppeteerFirefox);
  addBrowserTasks(tasks, dual, "Playwright", "Firefox", runPlaywrightFirefox);
  if (hasFirefox) {
    addBrowserTasks(tasks, dual, "TestCafe", "Firefox", runTestcafeFirefox);
    addBrowserTasks(tasks, dual, "Selenium", "Firefox", runSeleniumFirefox);
  } else {
    console.warn(
      "[skip] TestCafe/Selenium + Firefox: install Firefox or set FIREFOX_BIN (Puppeteer/Playwright still run)."
    );
  }

  // —— Edge (Ubuntu / Linux / Windows) ——
  if (profile.edge) {
    if (hasEdge) {
      addBrowserTasks(tasks, dual, "TestCafe", "Edge", runTestcafeEdge);
      addBrowserTasks(tasks, dual, "Selenium", "Edge", runSeleniumEdge);
    } else {
      console.warn(
        "[skip] TestCafe/Selenium + Edge: install Microsoft Edge or set EDGE_BIN (see install:browsers on Ubuntu)."
      );
    }
    console.warn(
      "[skip] Puppeteer + Edge: not supported (use Selenium or TestCafe for Edge)."
    );
  }

  // —— WebKit (Playwright, macOS) ——
  if (profile.webkit) {
    addBrowserTasks(tasks, dual, "Playwright", "WebKit", runPlaywrightWebkit);
  }

  console.warn(
    "[skip] Puppeteer + WebKit: Puppeteer supports Chrome and Firefox only."
  );

  // —— Safari (macOS native) ——
  if (profile.safari) {
    if (skipSafari) {
      console.warn(
        "[skip] TestCafe/Selenium + Safari (BOTS_SKIP_SELENIUM_SAFARI=1)."
      );
    } else {
      addBrowserTasks(tasks, dual, "TestCafe", "Safari", runTestcafeSafari, {
        safari: true,
      });
      addBrowserTasks(tasks, dual, "Selenium", "Safari", runSeleniumSafari, {
        safari: true,
      });
    }
  }

  return tasks;
}
