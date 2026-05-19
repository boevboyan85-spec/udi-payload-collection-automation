import { numberEnv, PAYLOAD_TIMEOUT_MS } from "./env.js";

/**
 * TestCafe timeouts: headed Firefox is slower to start and to fill the payload textarea.
 * @param {string} browserArg
 * @param {boolean} headless
 */
export function getTestcafeRunTimeouts(browserArg, headless) {
  const payloadWait =
    numberEnv("TESTCAFE_PAYLOAD_TIMEOUT_MS", 0) || PAYLOAD_TIMEOUT_MS;

  const headedFirefoxExtra =
    !headless && browserArg === "firefox"
      ? numberEnv("TESTCAFE_FIREFOX_HEADED_EXTRA_MS", 120_000)
      : 0;

  const payloadTimeout = payloadWait + headedFirefoxExtra;
  const margin = numberEnv("TESTCAFE_TIMEOUT_MARGIN_MS", 90_000);

  const pageLoadTimeout =
    numberEnv("TESTCAFE_PAGE_LOAD_TIMEOUT_MS", 180_000);
  const browserInitTimeout =
    numberEnv("TESTCAFE_BROWSER_INIT_TIMEOUT_MS", 180_000);

  const waitCap = payloadTimeout + margin;

  return {
    payloadTimeout,
    pageLoadTimeout,
    browserInitTimeout,
    selectorTimeout: waitCap,
    assertionTimeout: waitCap,
    /** Whole test fn (fixture hooks + payload wait); 0 = unlimited in TestCafe. */
    testExecutionTimeout: payloadTimeout + margin + 60_000,
    runExecutionTimeout: payloadTimeout + margin + 120_000,
  };
}
