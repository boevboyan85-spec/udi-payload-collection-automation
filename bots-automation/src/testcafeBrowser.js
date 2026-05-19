import { resolveEdgeBinaryPath } from "./browserBinaries.js";
import { chromiumNoSandboxArgs } from "./browserLaunchArgs.js";

/**
 * TestCafe on Linux looks for `microsoft-edge`, but Ubuntu installs `microsoft-edge-stable`.
 * Pass an explicit path (and container flags) when we know the binary.
 *
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
    const segments = [`edge:${edgeBin}`];
    if (headless) segments.push("headless");
    const sandbox = chromiumNoSandboxArgs();
    if (sandbox.length) {
      return `${segments.join(":")} ${sandbox.join(" ")}`;
    }
    return segments.join(":");
  }
  return headless ? `${browserArg}:headless` : browserArg;
}
