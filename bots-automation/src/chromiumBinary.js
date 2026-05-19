import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Ubuntu's `chromium-browser` is often a tiny script that tells you to `snap install chromium`.
 * @param {string} binPath
 */
export function isSnapChromiumStub(binPath) {
  if (!binPath || !fs.existsSync(binPath)) return false;
  try {
    const stat = fs.statSync(binPath);
    if (!stat.isFile()) return false;
    if (stat.size > 50_000_000) return false;
    const sample = fs.readFileSync(binPath, { encoding: "utf8" });
    return (
      /requires the chromium snap/i.test(sample) ||
      /snap install chromium/i.test(sample) ||
      (/^#!/.test(sample) && /snap/i.test(sample) && /chromium/i.test(sample))
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} binPath
 * @returns {boolean}
 */
export function isRunnableChromiumBinary(binPath) {
  if (!binPath || !fs.existsSync(binPath) || isSnapChromiumStub(binPath)) {
    return false;
  }
  try {
    execSync(`"${binPath}" --version`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    return true;
  } catch (err) {
    const msg = `${err?.stderr || ""}${err?.stdout || ""}${err?.message || ""}`;
    return !/requires the chromium snap/i.test(msg);
  }
}

/**
 * Playwright-downloaded Chromium (used when Ubuntu only has the snap stub).
 * @returns {string}
 */
export function resolvePlaywrightChromiumBinaryPath() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    const dirs = entries
      .filter((name) => /^chromium-\d+/.test(name))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidates =
        process.platform === "darwin"
          ? [
              path.join(
                root,
                dir,
                "chrome-mac",
                "Chromium.app",
                "Contents",
                "MacOS",
                "Chromium"
              ),
            ]
          : [
              path.join(root, dir, "chrome-linux", "chrome"),
              path.join(root, dir, "chrome-linux64", "chrome"),
            ];
      for (const candidate of candidates) {
        if (isRunnableChromiumBinary(candidate)) return candidate;
      }
    }
  }
  return "";
}
