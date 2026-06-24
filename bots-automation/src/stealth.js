/**
 * Stealth mode (DEVP-2649): make automated browsers report `navigator.webdriver === false`,
 * the way a real fraudster running an automation tool would hide that tell. The collector
 * surfaces this as `webDriverEnabled` / the navigator object's `webdriver` field.
 *
 * Two layers, applied together when stealth is on:
 *   1. Launch-level suppression — a Chromium flag / Firefox pref so the engine never
 *      exposes the WebDriver flag in the first place.
 *   2. An init script injected before any page script runs, as a belt-and-suspenders
 *      override of the `navigator.webdriver` getter. This covers tools/engines where the
 *      launch-level hook is unavailable (TestCafe, Playwright WebKit).
 *
 * Scope is intentionally limited to `navigator.webdriver`. The helpers are kept small and
 * separate so additional spoofs can be layered in later.
 */

/**
 * Resolve whether stealth is on for a tool. Global default `BOTS_STEALTH` with a per-tool
 * override (`PUPPETEER_STEALTH` / `PLAYWRIGHT_STEALTH` / `SELENIUM_STEALTH` / `TESTCAFE_STEALTH`).
 * Off by default. Mirrors `resolveHeadless()` in config.js.
 * @param {string} toolEnvKey
 * @returns {boolean}
 */
export function resolveStealth(toolEnvKey) {
  const t = process.env[toolEnvKey];
  if (t === "false" || t === "0") return false;
  if (t === "true" || t === "1") return true;
  return process.env.BOTS_STEALTH === "true" || process.env.BOTS_STEALTH === "1";
}

/** Chromium launch flag that stops Blink from exposing `navigator.webdriver === true`. */
export function stealthChromiumArgs() {
  return ["--disable-blink-features=AutomationControlled"];
}

/** Firefox preference that disables the WebDriver navigator flag. */
export function stealthFirefoxPrefs() {
  return { "dom.webdriver.enabled": false };
}

/**
 * JS injected before any page script. Overrides the `navigator.webdriver` getter to return
 * `false` (the value a normal, non-automated browser reports). Wrapped in try/catch so a
 * non-configurable property on any one engine never breaks the others.
 */
export const STEALTH_INIT_SCRIPT = `(() => {
  const spoof = (target) => {
    try {
      Object.defineProperty(target, 'webdriver', { get: () => false, configurable: true });
    } catch (e) {}
  };
  try { spoof(Object.getPrototypeOf(navigator)); } catch (e) {}
  spoof(navigator);
})();`;
