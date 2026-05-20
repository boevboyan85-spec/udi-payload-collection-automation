#!/usr/bin/env node
/**
 * Installs browsers for the detected (or configured) platform.
 * - Playwright: chromium + firefox (+ webkit on macOS); OS deps on Linux
 * - Ubuntu/Kasm: optional system Chrome, Chromium, Firefox, Edge via apt
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const { resolveBotsPlatform, getPlatformProfile, formatPlatformSummary } =
  await import("../src/platform.js");

const platform = resolveBotsPlatform();
const profile = getPlatformProfile(platform);

console.log(formatPlatformSummary(profile));
console.log(`BOTS_PLATFORM=${process.env.BOTS_PLATFORM || "auto"} → ${platform}\n`);

const skipOs =
  process.env.BOTS_SKIP_OS_BROWSER_INSTALL === "1" ||
  process.env.BOTS_SKIP_OS_BROWSER_INSTALL === "true";

if (profile.installOsBrowsersScript && !skipOs) {
  const script = path.join(__dirname, "install-os-browsers-ubuntu.sh");
  console.log("Installing system browsers (Ubuntu/Kasm) …\n");
  const sh = spawnSync("bash", [script], { stdio: "inherit", cwd: projectRoot });
  if (sh.status !== 0) {
    console.warn(
      "\n[warn] System browser install had errors (continuing with Playwright). " +
        "Set BOTS_SKIP_OS_BROWSER_INSTALL=1 to skip this step.\n"
    );
  }
} else if (profile.installOsBrowsersScript && skipOs) {
  console.log("Skipping system browser install (BOTS_SKIP_OS_BROWSER_INSTALL=1).\n");
}

if (profile.installWindowsBrowsersScript && !skipOs) {
  const script = path.join(__dirname, "install-os-browsers-windows.ps1");
  console.log("Installing system browsers (Windows / winget) …\n");
  const ps = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", script],
    { stdio: "inherit", cwd: projectRoot }
  );
  if (ps.status !== 0) {
    console.warn(
      "\n[warn] Windows browser install had errors (continuing with Playwright). " +
        "Install Chrome/Edge/Firefox manually or set BOTS_SKIP_OS_BROWSER_INSTALL=1.\n"
    );
  }
} else if (profile.installWindowsBrowsersScript && skipOs) {
  console.log("Skipping Windows browser install (BOTS_SKIP_OS_BROWSER_INSTALL=1).\n");
}

const playwrightArgs = ["playwright", "install", ...profile.playwrightBrowsers];
console.log(`Playwright: npx ${playwrightArgs.join(" ")}\n`);

const pwEnv = {
  ...process.env,
  NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "0",
};

let pw = spawnSync("npx", playwrightArgs, {
  stdio: "inherit",
  cwd: projectRoot,
  env: pwEnv,
});

if (pw.status !== 0) {
  process.exit(pw.status ?? 1);
}

if (platform === "ubuntu" || platform === "linux") {
  console.log("\nPlaywright: installing Linux system dependencies …\n");
  pw = spawnSync("npx", ["playwright", "install-deps", "chromium", "firefox"], {
    stdio: "inherit",
    cwd: projectRoot,
    env: pwEnv,
  });
  if (pw.status !== 0) {
    console.warn(
      "[warn] playwright install-deps failed (may need sudo). Collection may still work headless.\n"
    );
  }
}

console.log("\nDone. Run `npm run collect` to verify browser matrix.");
