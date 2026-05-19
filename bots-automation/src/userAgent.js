/**
 * Reads `navigator.userAgent` from an automated page (Puppeteer or Playwright).
 * @param {{ evaluate: (fn: () => string) => Promise<string> }} page
 */
export async function getNavigatorUserAgentFromPage(page) {
  return page.evaluate(() => navigator.userAgent);
}
