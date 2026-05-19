import fs from "fs";

/** @typedef {"macos" | "ubuntu" | "linux" | "win32" | "unknown"} BotsPlatform */

/**
 * Target environment for browser matrix and install scripts.
 * - `auto` (default): darwin → macos; Linux + Ubuntu/Kasm in os-release → ubuntu; other Linux → linux
 * - `macos` | `ubuntu` | `linux` | `win32`: force profile (useful in CI/Kasm images)
 * @returns {BotsPlatform}
 */
export function resolveBotsPlatform() {
  const raw = (process.env.BOTS_PLATFORM || "auto").trim().toLowerCase();
  if (raw === "macos" || raw === "darwin") return "macos";
  if (raw === "ubuntu" || raw === "kasm") return "ubuntu";
  if (raw === "linux") return "linux";
  if (raw === "win32" || raw === "windows") return "win32";

  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") {
    try {
      const release = fs.readFileSync("/etc/os-release", "utf8");
      if (/^ID=ubuntu/m.test(release) || /^ID_LIKE=.*ubuntu/m.test(release)) {
        return "ubuntu";
      }
      if (/kasm/i.test(release) || /kasm/i.test(process.env.KASM_SESSION_ID || "")) {
        return "ubuntu";
      }
    } catch {
      // not Linux with os-release
    }
    return "linux";
  }
  return "unknown";
}

/**
 * @param {BotsPlatform} platform
 */
export function getPlatformProfile(platform = resolveBotsPlatform()) {
  const isMac = platform === "macos";
  const isUbuntuLike = platform === "ubuntu" || platform === "linux";

  return {
    platform,
    label:
      platform === "macos"
        ? "macOS"
        : platform === "ubuntu"
          ? "Ubuntu / Kasm"
          : platform === "linux"
            ? "Linux"
            : platform,

    /** Google Chrome / `chrome` alias (system or Puppeteer default). */
    chrome: true,
    /** Distinct Chromium binary (Playwright bundle + optional system `/usr/bin/chromium`). */
    chromium: true,
    firefox: true,
    /** Playwright WebKit bundle + macOS native Safari stacks. */
    webkit: isMac,
    /** TestCafe / Selenium Safari (macOS only). */
    safari: isMac,
    /** Microsoft Edge — common on Ubuntu (.deb); optional on macOS if installed. */
    edge: isUbuntuLike || platform === "win32",

    /** Playwright browsers to download in `npm run install:browsers`. */
    playwrightBrowsers: isMac ? ["chromium", "firefox", "webkit"] : ["chromium", "firefox"],

    /** Run `scripts/install-os-browsers-ubuntu.sh` when installing browsers. */
    installOsBrowsersScript: platform === "ubuntu",

    /** Recommend container flags (--no-sandbox) for Chromium-based launches. */
    preferNoSandbox: isUbuntuLike || isContainer(),
  };
}

/** @returns {boolean} */
export function isContainer() {
  if (process.env.BOTS_IN_CONTAINER === "1" || process.env.BOTS_IN_CONTAINER === "true") {
    return true;
  }
  if (process.env.CI === "true" || process.env.CI === "1") {
    return true;
  }
  try {
    if (fs.existsSync("/.dockerenv")) return true;
  } catch {
    // ignore
  }
  return false;
}

/** @returns {string} one-line summary for logs */
export function formatPlatformSummary(profile = getPlatformProfile()) {
  const browsers = ["Chrome", "Chromium", "Firefox"];
  if (profile.edge) browsers.push("Edge");
  if (profile.webkit) browsers.push("WebKit (Playwright)");
  if (profile.safari) browsers.push("Safari");
  return `${profile.label} [${profile.platform}] — browsers: ${browsers.join(", ")}`;
}
