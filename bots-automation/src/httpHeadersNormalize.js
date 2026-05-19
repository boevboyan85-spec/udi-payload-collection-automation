/**
 * Normalize HTTP request header values for JSON storage and risk `httpHeaders`.
 * Client hints often include literal quote characters on the wire (e.g. platform `"macOS"`).
 */

/**
 * Unwrap one layer of surrounding quotes for simple tokens; keep sec-ch-ua brand lists intact.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHttpHeaderValue(value) {
  if (value == null) return "";
  const s = Array.isArray(value) ? value.join(", ") : String(value);
  const trimmed = s.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    !/";v=/.test(trimmed)
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

/**
 * @param {Record<string, unknown>} headers
 * @returns {Record<string, string>}
 */
export function normalizeRequestHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined) continue;
    out[key] = normalizeHttpHeaderValue(value);
  }
  return out;
}

/**
 * Normalize `headers` inside a collector textarea JSON envelope; returns compact JSON.
 * @param {string} payloadCell
 * @returns {string}
 */
export function normalizeCollectorPayloadEnvelope(payloadCell) {
  const raw = String(payloadCell ?? "").trim();
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.headers != null &&
      typeof parsed.headers === "object" &&
      !Array.isArray(parsed.headers)
    ) {
      parsed.headers = normalizeRequestHeaders(
        /** @type {Record<string, unknown>} */ (parsed.headers)
      );
      return JSON.stringify(parsed);
    }
  } catch {
    // raw UDI or non-JSON — leave unchanged
  }
  return raw;
}
