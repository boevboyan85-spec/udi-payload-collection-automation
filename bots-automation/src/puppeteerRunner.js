import puppeteer from "puppeteer";

import {
  resolveChromeBinaryPath,
  resolveChromiumBinaryPath,
  resolveEdgeBinaryPath,
  resolveFirefoxBinaryPath,
} from "./browserBinaries.js";
import { chromiumNoSandboxArgs, isChromiumNoSandbox } from "./browserLaunchArgs.js";
import {
  TARGET_URL,
  PAYLOAD_ELEMENT_ID,
  PAYLOAD_TIMEOUT_MS,
  resolveHeadless,
} from "./config.js";
import { numberEnv } from "./env.js";
import { getDocumentFocusCsvColumnsFromEncodedUdi } from "./udiDecompress.js";
import { waitForNonEmptyValue } from "./waitForPayload.js";

const SELECTOR = `#${PAYLOAD_ELEMENT_ID}`;

function navigationTimeoutMs() {
  return numberEnv("PUPPETEER_NAVIGATION_TIMEOUT_MS", PAYLOAD_TIMEOUT_MS);
}

/**
 * Firefox via WebDriver BiDi rarely reaches networkidle; the collector page may keep connections open.
 * @param {import("puppeteer").Page} page
 */
async function gotoCollector(page, browserKind) {
  const timeout = navigationTimeoutMs();
  const waitUntil = browserKind === "firefox" ? "load" : "networkidle2";
  await page.goto(TARGET_URL, { waitUntil, timeout });
}

/**
 * Headed Firefox on macOS uses --foreground and can hang on browser.close(); force shutdown.
 * @param {import("puppeteer").Browser} browser
 */
async function closeBrowser(browser) {
  const closeMs = numberEnv("PUPPETEER_BROWSER_CLOSE_TIMEOUT_MS", 20_000);
  try {
    const pages = await browser.pages();
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
  } catch {
    // ignore
  }
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("browser.close() timed out")), closeMs);
      }),
    ]);
  } catch {
    try {
      const proc = browser.process();
      if (proc) proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

/**
 * @param {"chrome"|"firefox"} browserKind
 * @param {boolean} headless
 * @returns {import("puppeteer").LaunchOptions}
 */
function buildLaunchOptions(browserKind, headless) {
  /** @type {import("puppeteer").LaunchOptions} */
  const launchOptions = {
    browser: browserKind,
    headless,
    protocolTimeout: numberEnv("PUPPETEER_PROTOCOL_TIMEOUT_MS", 300_000),
  };

  if (browserKind === "firefox") {
    // Do not use PUPPETEER_EXECUTABLE_PATH here — that is for Chrome on Kasm.
    if (process.platform === "darwin" && !headless) {
      launchOptions.ignoreDefaultArgs = ["--foreground"];
    }
    const firefoxBin =
      process.env.PUPPETEER_FIREFOX_EXECUTABLE_PATH ||
      process.env.FIREFOX_BIN ||
      resolveFirefoxBinaryPath();
    if (firefoxBin) {
      launchOptions.executablePath = String(firefoxBin).trim();
    }
    if (isChromiumNoSandbox()) {
      launchOptions.extraPrefsFirefox = {
        "security.sandbox.content.level": 0,
      };
      process.env.MOZ_DISABLE_CONTENT_SANDBOX = "1";
    }
  } else {
    launchOptions.args = ["--window-size=1280,900", ...chromiumNoSandboxArgs()];
    const chromeBin =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_BIN ||
      resolveChromeBinaryPath();
    if (chromeBin) launchOptions.executablePath = String(chromeBin).trim();
  }

  return launchOptions;
}

/**
 * @param {"chrome"|"firefox"} browserKind
 * @param {string} browserLabel
 * @param {string} [executablePath] - Chromium-only override
 */
async function runPuppeteer(browserKind, browserLabel, executablePath = "") {
  const headless = resolveHeadless("PUPPETEER_HEADLESS");
  const launchOptions = buildLaunchOptions(browserKind, headless);
  if (executablePath && browserKind === "chrome") {
    launchOptions.executablePath = executablePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await gotoCollector(page, browserKind);

    const payload = await waitForNonEmptyValue(async () => {
      try {
        return await page.$eval(SELECTOR, (el) =>
          el && "value" in el ? el.value : ""
        );
      } catch {
        return "";
      }
    }, PAYLOAD_TIMEOUT_MS);

    const { documentHasFocus, documentVisibility } =
      getDocumentFocusCsvColumnsFromEncodedUdi(payload);

    return {
      type: "puppeteer",
      browser: browserLabel,
      headless,
      payload,
      documentHasFocus,
      documentVisibility,
    };
  } finally {
    await closeBrowser(browser);
  }
}

export function runPuppeteerChrome() {
  return runPuppeteer("chrome", "chrome");
}

export function runPuppeteerFirefox() {
  return runPuppeteer("firefox", "firefox");
}

export function runPuppeteerChromium() {
  const chromiumBin = resolveChromiumBinaryPath();
  if (!chromiumBin) {
    return Promise.reject(
      new Error(
        "Chromium binary not found. On Ubuntu run: npm run install:browsers (Playwright Chromium) or set CHROMIUM_BIN."
      )
    );
  }
  return runPuppeteer("chrome", "chromium", chromiumBin);
}

/** Edge is Chromium-based; Puppeteer launches it via the Chrome protocol. */
export function runPuppeteerEdge() {
  const edgeBin = resolveEdgeBinaryPath();
  if (!edgeBin) {
    return Promise.reject(
      new Error(
        "Microsoft Edge binary not found. On Ubuntu run: npm run install:browsers or set EDGE_BIN."
      )
    );
  }
  return runPuppeteer("chrome", "edge", edgeBin);
}
