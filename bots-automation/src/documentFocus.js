/**
 * CSV formatting for `documentHasFocus` (values originate from decompressed JSC via `udiDecompress.js`).
 */

/** CSV cell for boolean hasFocus */
export function formatDocumentHasFocusForCsv(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === "true" || value === "false") return value;
  return value == null ? "" : String(value);
}
