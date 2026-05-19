import { execSync } from "child_process";
import fs from "fs";

/**
 * @param {string[]} paths
 * @returns {string}
 */
function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return "";
}

/**
 * @returns {string}
 */
export function resolveChromeBinaryPath() {
  const fromEnv =
    process.env.SELENIUM_CHROME_BINARY ||
    process.env.CHROME_BIN ||
    process.env.GOOGLE_CHROME_BIN;
  if (fromEnv && String(fromEnv).trim()) {
    const p = String(fromEnv).trim();
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
  }

  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    return firstExisting([
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"] || ""}\\Google\\Chrome\\Application\\chrome.exe`,
    ]);
  }

  return firstExisting([
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
  ]);
}

/**
 * System Chromium (not Playwright's bundled build).
 * @returns {string}
 */
export function resolveChromiumBinaryPath() {
  const fromEnv =
    process.env.CHROMIUM_BIN ||
    process.env.SELENIUM_CHROMIUM_BINARY ||
    process.env.PUPPETEER_CHROMIUM_EXECUTABLE_PATH;
  if (fromEnv && String(fromEnv).trim()) {
    const p = String(fromEnv).trim();
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  }

  if (process.platform === "win32") {
    return firstExisting([
      `${process.env.LOCALAPPDATA || ""}\\Chromium\\Application\\chrome.exe`,
    ]);
  }

  return firstExisting([
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ]);
}

/**
 * @returns {string}
 */
export function resolveFirefoxBinaryPath() {
  const fromEnv =
    process.env.FIREFOX_BIN ||
    process.env.SELENIUM_FIREFOX_BINARY ||
    process.env.MOZ_BROWSER_PATH;
  if (fromEnv && String(fromEnv).trim()) {
    const p = String(fromEnv).trim();
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Firefox.app/Contents/MacOS/firefox",
    ]);
  }

  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    return firstExisting([
      `${pf}\\Mozilla Firefox\\firefox.exe`,
    ]);
  }

  const fromPath = firstExisting([
    "/usr/bin/firefox",
    "/usr/bin/firefox-esr",
    "/snap/bin/firefox",
  ]);
  if (fromPath) return fromPath;

  try {
    const cmd =
      process.platform === "win32"
        ? "where firefox"
        : "command -v firefox";
    const out = execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    const line = out.split(/\r?\n/)[0];
    if (line && fs.existsSync(line)) return line;
  } catch {
    // not on PATH
  }

  return "";
}

/**
 * @returns {string}
 */
export function resolveEdgeBinaryPath() {
  const fromEnv =
    process.env.EDGE_BIN ||
    process.env.SELENIUM_EDGE_BINARY ||
    process.env.MSEDGE_BIN;
  if (fromEnv && String(fromEnv).trim()) {
    const p = String(fromEnv).trim();
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]);
  }

  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    return firstExisting([
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env["PROGRAMFILES(X86)"] || ""}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]);
  }

  const fromPath = firstExisting([
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge",
    "/usr/local/bin/microsoft-edge",
    "/opt/microsoft/msedge/msedge",
  ]);
  if (fromPath) return fromPath;

  for (const cmd of [
    "microsoft-edge-stable",
    "microsoft-edge",
    "msedge",
  ]) {
    try {
      const out = execSync(`command -v ${cmd}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      const line = out.split(/\r?\n/)[0];
      if (line && fs.existsSync(line)) return line;
    } catch {
      // not on PATH
    }
  }

  return "";
}

/** @returns {boolean} */
export function isChromeAvailable() {
  return resolveChromeBinaryPath() !== "";
}

/** @returns {boolean} */
export function isChromiumAvailable() {
  return resolveChromiumBinaryPath() !== "";
}

/** @returns {boolean} */
export function isFirefoxAvailable() {
  return resolveFirefoxBinaryPath() !== "";
}

/** @returns {boolean} */
export function isEdgeAvailable() {
  return resolveEdgeBinaryPath() !== "";
}

/** @deprecated use isFirefoxAvailable */
export function firefoxExecutableOnPath() {
  return isFirefoxAvailable();
}
