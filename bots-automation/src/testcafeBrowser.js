import {
  resolveChromiumBinaryPath,
  resolveEdgeBinaryPath,
} from "./browserBinaries.js";
import { chromiumNoSandboxArgs } from "./browserLaunchArgs.js";

/**
 * Chromium/Edge on Linux: pass explicit binary path + container flags.
 * Ubuntu `chromium-browser` is often a snap stub; TestCafe alias alone fails (ECONNREFUSED).
 *
 * @param {string} alias
 * @param {string} binaryPath
 * @param {boolean} headless
 * @returns {string}
 */
function formatChromiumAliasWithPath(alias, binaryPath, headless) {
  const segments = [`${alias}:${binaryPath}`];
  if (headless) segments.push("headless");
  const sandbox = chromiumNoSandboxArgs();
  if (sandbox.length) {
    return `${segments.join(":")} ${sandbox.join(" ")}`;
  }
  return segments.join(":");
}

/**
 * @param {string} browserArg
 * @param {boolean} headless
 * @returns {string}
 */
export function formatTestcafeBrowserString(browserArg, headless) {
  if (browserArg === "edge") {
    const edgeBin = resolveEdgeBinaryPath();
    if (!edgeBin) {
      throw new Error("Microsoft Edge binary not found (set EDGE_BIN).");
    }
    return formatChromiumAliasWithPath("edge", edgeBin, headless);
  }
  if (browserArg === "chromium") {
    const chromiumBin = resolveChromiumBinaryPath();
    if (!chromiumBin) {
      throw new Error(
        "Chromium binary not found. Run: npm run install:browsers (Playwright Chromium) or set CHROMIUM_BIN."
      );
    }
    return formatChromiumAliasWithPath("chromium", chromiumBin, headless);
  }
  return headless ? `${browserArg}:headless` : browserArg;
}
