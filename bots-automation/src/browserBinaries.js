import { execSync } from "child_process";
import fs from "fs";

import {
  isRunnableChromiumBinary,
  isSnapChromiumStub,
  resolvePlaywrightChromiumBinaryPath,
} from "./chromiumBinary.js";

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
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const fromPaths = firstExisting([
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
    ]);
    if (fromPaths) return fromPaths;
    try {
      const out = execSync("where chrome", {
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

  return firstExisting([
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
  ]);
}

/**
 * System or Playwright Chromium (skips Ubuntu snap stub at chromium-browser).
 * @returns {string}
 */
export function resolveChromiumBinaryPath() {
  const fromEnv =
    process.env.CHROMIUM_BIN ||
    process.env.SELENIUM_CHROMIUM_BINARY ||
    process.env.PUPPETEER_CHROMIUM_EXECUTABLE_PATH;
  if (fromEnv && String(fromEnv).trim()) {
    const p = String(fromEnv).trim();
    if (isRunnableChromiumBinary(p)) return p;
  }

  /** @type {string[]} */
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else if (process.platform === "win32") {
    candidates.push(
      `${process.env.LOCALAPPDATA || ""}\\Chromium\\Application\\chrome.exe`
    );
  } else {
    candidates.push(
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium"
    );
    for (const cmd of ["chromium", "chromium-browser"]) {
      try {
        const out = execSync(`command -v ${cmd}`, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        }).trim();
        const line = out.split(/\r?\n/)[0];
        if (line) candidates.push(line);
      } catch {
        // not on PATH
      }
    }
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isSnapChromiumStub(candidate)) continue;
    if (isRunnableChromiumBinary(candidate)) return candidate;
  }

  return resolvePlaywrightChromiumBinaryPath();
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
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const fromPaths = firstExisting([
      `${pf}\\Mozilla Firefox\\firefox.exe`,
      `${pf86}\\Mozilla Firefox\\firefox.exe`,
    ]);
    if (fromPaths) return fromPaths;
    try {
      const out = execSync("where firefox", {
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
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const fromPaths = firstExisting([
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]);
    if (fromPaths) return fromPaths;
    try {
      const out = execSync("where msedge", {
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
