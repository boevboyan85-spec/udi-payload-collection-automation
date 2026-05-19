/**
 * Builds the `httpHeaders` map for the risk service (lowercase keys after the service
 * normalises them). Aligns with `UserAgentService` Client Hint names and optional
 * `accept-language` (used by non–IS_BOT strategies such as Language mismatch).
 */

/**
 * Runs in the browser (Playwright / Puppeteer `page.evaluate`).
 * Uses `navigator.userAgentData.getHighEntropyValues` when available (often limited on
 * non-HTTPS pages; failures are ignored).
 * @returns {Promise<Record<string, string>>}
 */
async function collectHeadersInBrowser() {
  /** @type {Record<string, string>} */
  const out = { "user-agent": navigator.userAgent || "" };
  const langs =
    navigator.languages && navigator.languages.length
      ? navigator.languages.join(",")
      : navigator.language || "";
  if (langs) {
    out["accept-language"] = langs;
  }

  const ud = navigator.userAgentData;
  if (!ud) {
    return out;
  }

  const brandList = (list) => {
    if (!list || !list.length) return "";
    return list
      .map((b) => `"${String(b.brand ?? "")}";v="${String(b.version ?? "")}"`)
      .join(", ");
  };

  if (ud.brands && ud.brands.length) {
    out["sec-ch-ua"] = brandList(ud.brands);
  }
  if (typeof ud.mobile === "boolean") {
    out["sec-ch-ua-mobile"] = ud.mobile ? "?1" : "?0";
  }

  try {
    if (typeof ud.getHighEntropyValues === "function") {
      const hints = await ud.getHighEntropyValues([
        "architecture",
        "bitness",
        "brands",
        "fullVersionList",
        "model",
        "platform",
        "platformVersion",
        "uaFullVersion",
        "wow64",
      ]);

      if (hints.brands && hints.brands.length) {
        out["sec-ch-ua"] = brandList(hints.brands);
      }
      if (hints.fullVersionList && hints.fullVersionList.length) {
        out["sec-ch-ua-full-version-list"] = brandList(hints.fullVersionList);
      }
      if (hints.platform != null && String(hints.platform).trim() !== "") {
        out["sec-ch-ua-platform"] = String(hints.platform).trim();
      }
      if (
        hints.platformVersion != null &&
        String(hints.platformVersion).trim() !== ""
      ) {
        out["sec-ch-ua-platform-version"] = String(hints.platformVersion).trim();
      }
      if (hints.architecture != null && String(hints.architecture).trim() !== "") {
        out["sec-ch-ua-arch"] = String(hints.architecture).trim();
      }
      if (hints.uaFullVersion != null && String(hints.uaFullVersion).trim() !== "") {
        out["sec-ch-ua-full-version"] = String(hints.uaFullVersion).trim();
      }
      if (hints.bitness != null && String(hints.bitness).trim() !== "") {
        out["sec-ch-ua-bitness"] = String(hints.bitness).trim();
      }
      if (typeof hints.wow64 === "boolean") {
        out["sec-ch-ua-wow64"] = hints.wow64 ? "?1" : "?0";
      }
    }
  } catch {
    // Non-secure context, policy, or browser: keep low-entropy hints only
  }

  return out;
}

/**
 * @param {{ evaluate: (fn: () => unknown) => Promise<unknown> }} page - Playwright or Puppeteer page
 * @returns {Promise<Record<string, string>>}
 */
export async function collectRiskHttpHeadersFromPage(page) {
  return /** @type {Promise<Record<string, string>>} */ (
    page.evaluate(collectHeadersInBrowser)
  );
}

/**
 * Selenium: `executeScript` cannot await Promises; use `executeAsyncScript`.
 * @param {import('selenium-webdriver').WebDriver} driver
 * @returns {Promise<Record<string, string>>}
 */
export async function collectRiskHttpHeadersFromDriver(driver) {
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    (${collectHeadersInBrowser.toString()})()
      .then(done)
      .catch(function () {
        done({ "user-agent": navigator.userAgent || "" });
      });
  `);
  return result && typeof result === "object" && !Array.isArray(result)
    ? /** @type {Record<string, string>} */ (result)
    : { "user-agent": "" };
}

/**
 * @param {Record<string, string>} headers
 * @returns {string}
 */
export function stringifyRiskHttpHeadersForCsv(headers) {
  try {
    return JSON.stringify(headers ?? {});
  } catch {
    return "{}";
  }
}
