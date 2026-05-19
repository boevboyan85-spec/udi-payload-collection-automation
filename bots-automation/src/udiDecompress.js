/**
 * UDI JSC payload decompression — same algorithm as sc-tools `Decompressor` / sc-sdk `PDecompressor`:
 * base64 (URL-safe tolerant) → pako inflate → JSON.parse.
 *
 * Uncompressed shape matches the collector: an array of `{ name, data, error? }` task results.
 */
import pako from "pako";

/**
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function base64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * @param {string} encodedPayload - Compressed UDI string from the collector textarea
 * @returns {unknown} Parsed JSON (typically task-result array)
 */
export function decompressUdiPayload(encodedPayload) {
  const trimmed = String(encodedPayload ?? "").trim();
  if (!trimmed) {
    throw new Error("empty payload");
  }
  const bytes = base64ToUint8Array(trimmed);
  const json = pako.inflate(bytes, { to: "string" });
  return JSON.parse(json);
}

/**
 * @param {unknown} taskResults
 * @returns {{ documentHasFocus: string, documentVisibility: string }}
 */
export function extractDocumentFocusFromTaskResults(taskResults) {
  let documentHasFocus = "";
  let documentVisibility = "";
  if (!Array.isArray(taskResults)) {
    return { documentHasFocus, documentVisibility };
  }
  for (const item of taskResults) {
    if (!item || typeof item.name !== "string") continue;
    if (item.name === "documentHasFocus" && item.data != null) {
      documentHasFocus = String(item.data);
    }
    if (item.name === "documentVisibility" && item.data != null) {
      documentVisibility = String(item.data);
    }
  }
  return { documentHasFocus, documentVisibility };
}

/**
 * The collector textarea stores JSON `{ "headers": {...}, "payload": "<UDI base64>" }`.
 * This returns the inner UDI string, or the whole string if it is already raw UDI / legacy.
 *
 * @param {string} textareaContent - full `#textareaPayload` value
 * @returns {string}
 */
export function extractEncodedUdiFromCollectorPayload(textareaContent) {
  const trimmed = String(textareaContent ?? "").trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("{")) {
    return trimmed;
  }
  try {
    const obj = JSON.parse(trimmed);
    if (
      obj &&
      typeof obj === "object" &&
      !Array.isArray(obj) &&
      typeof obj.payload === "string"
    ) {
      return obj.payload.trim();
    }
  } catch {
    // not JSON envelope — treat as raw UDI
  }
  return trimmed;
}

/**
 * Values for CSV `documentHasFocus` / `documentVisibility` from the embedded JSC (decompressed),
 * not from the browser automation context.
 *
 * Accepts either the **full collector textarea JSON** (`headers` + `payload`) or a **raw base64 UDI** string.
 *
 * @param {string} textareaOrEncodedUdi
 * @returns {{ documentHasFocus: string, documentVisibility: string }}
 */
export function getDocumentFocusCsvColumnsFromEncodedUdi(textareaOrEncodedUdi) {
  const encodedPayload = extractEncodedUdiFromCollectorPayload(textareaOrEncodedUdi);
  try {
    const taskResults = decompressUdiPayload(encodedPayload);
    return extractDocumentFocusFromTaskResults(taskResults);
  } catch {
    return { documentHasFocus: "", documentVisibility: "" };
  }
}
