/**
 * Poll until getValue() returns a non-empty string, or timeout.
 * @param {() => Promise<string>} getValue
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
export async function waitForNonEmptyValue(getValue, timeoutMs) {
  const start = Date.now();
  const delay = 500;
  while (Date.now() - start < timeoutMs) {
    const value = await getValue();
    if (value != null && String(value).trim() !== "") {
      return String(value);
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Timeout: no non-empty value after ${timeoutMs}ms`);
}
