/** Digest helpers. Identity strings the compiler produces use the same form. */

import { createHash } from "node:crypto";

/** @param {string} text @returns {string} */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** @param {Uint8Array} bytes @returns {string} */
export function sha256BytesHex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** @param {unknown} value @returns {unknown} */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const source = /** @type {Record<string, unknown>} */ (value);
    const sorted = /** @type {Record<string, unknown>} */ ({});
    for (const key of Object.keys(source).sort()) sorted[key] = sortValue(source[key]);
    return sorted;
  }
  return value;
}
