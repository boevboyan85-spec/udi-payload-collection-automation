import {
  resolveBraveBinaryPath,
  resolveChromeBinaryPath,
  resolveChromiumBinaryPath,
  resolveEdgeBinaryPath,
} from "./browserBinaries.js";
import { chromiumNoSandboxArgs } from "./browserLaunchArgs.js";
import { stealthChromiumArgs } from "./stealth.js";

/**
 * Chromium/Edge on Linux: pass explicit binary path + container flags.
 * Ubuntu `chromium-browser` is often a snap stub; TestCafe alias alone fails (ECONNREFUSED).
 *
 * @param {string} alias
 * @param {string} binaryPath
 * @param {boolean} headless
 * @param {boolean} stealth
 * @returns {string}
 */
function formatChromiumAliasWithPath(alias, binaryPath, headless, stealth) {
  const segments = [`${alias}:${binaryPath}`];
  if (headless) segments.push("headless");
  const flags = [...chromiumNoSandboxArgs(), ...(stealth ? stealthChromiumArgs() : [])];
  if (flags.length) {
    return `${segments.join(":")} ${flags.join(" ")}`;
  }
  return segments.join(":");
}

/**
 * @param {string} browserArg
 * @param {boolean} headless
 * @param {boolean} [stealth]
 * @returns {string}
 */
export function formatTestcafeBrowserString(browserArg, headless, stealth = false) {
  if (browserArg === "chrome" && process.platform === "win32") {
    const chromeBin = resolveChromeBinaryPath();
    if (chromeBin) {
      return formatChromiumAliasWithPath("chrome", chromeBin, headless, stealth);
    }
  }
  if (browserArg === "edge") {
    const edgeBin = resolveEdgeBinaryPath();
    if (!edgeBin) {
      throw new Error("Microsoft Edge binary not found (set EDGE_BIN).");
    }
    return formatChromiumAliasWithPath("edge", edgeBin, headless, stealth);
  }
  if (browserArg === "chromium") {
    const chromiumBin = resolveChromiumBinaryPath();
    if (!chromiumBin) {
      throw new Error(
        "Chromium binary not found. Run: npm run install:browsers (Playwright Chromium) or set CHROMIUM_BIN."
      );
    }
    return formatChromiumAliasWithPath("chromium", chromiumBin, headless, stealth);
  }
  if (browserArg === "brave") {
    const braveBin = resolveBraveBinaryPath();
    if (!braveBin) {
      throw new Error("Brave binary not found (set BRAVE_BIN).");
    }
    return formatChromiumAliasWithPath("chrome", braveBin, headless, stealth);
  }
  // Chrome/Chromium-family alias without an explicit path (e.g. macOS/Linux `chrome`):
  // append the stealth flag after the alias so Blink does not expose navigator.webdriver.
  const chromiumFamily =
    browserArg === "chrome" || browserArg === "chromium" || browserArg === "brave";
  const base = headless ? `${browserArg}:headless` : browserArg;
  if (stealth && chromiumFamily) {
    return `${base} ${stealthChromiumArgs().join(" ")}`;
  }
  return base;
}
