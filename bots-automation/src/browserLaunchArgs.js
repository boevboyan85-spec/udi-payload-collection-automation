import { getPlatformProfile, isContainer } from "./platform.js";

/**
 * Extra flags for Chromium-based browsers in Docker/Kasm/CI.
 * Force with BOTS_NO_SANDBOX=1 or disable with BOTS_NO_SANDBOX=0.
 * @returns {string[]}
 */
export function isChromiumNoSandbox() {
  const forced = process.env.BOTS_NO_SANDBOX;
  if (forced === "0" || forced === "false") return false;
  if (forced === "1" || forced === "true") return true;
  const profile = getPlatformProfile();
  return profile.preferNoSandbox || isContainer();
}

export function chromiumNoSandboxArgs() {
  return isChromiumNoSandbox()
    ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    : [];
}
