import fs from "fs";
import os from "os";
import path from "path";

/**
 * Playwright's patched Firefox (from `npx playwright install firefox`).
 * Retail Mozilla Firefox does not support Playwright's juggler protocol.
 * @returns {string}
 */
export function resolvePlaywrightFirefoxBinaryPath() {
  const fromEnv = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH;
  if (fromEnv && String(fromEnv).trim()) {
    const p = String(fromEnv).trim();
    if (fs.existsSync(p)) return p;
  }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
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
      .filter((name) => /^firefox-\d+/.test(name))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidates =
        process.platform === "win32"
          ? [path.join(root, dir, "firefox", "firefox.exe")]
          : process.platform === "darwin"
            ? [
                path.join(
                  root,
                  dir,
                  "firefox",
                  "Nightly.app",
                  "Contents",
                  "MacOS",
                  "firefox"
                ),
                path.join(root, dir, "firefox", "firefox"),
              ]
            : [path.join(root, dir, "firefox", "firefox")];
      for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return "";
}
