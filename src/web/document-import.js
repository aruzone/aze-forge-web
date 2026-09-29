// @ts-check

/**
 * Imported `.aze.md` parsing, factored out of the import control so the
 * file guards and the heading-split Cell mapping are unit-testable without
 * a browser file picker.
 */

import { splitFrontMatter } from "./front-matter.js";

/** @typedef {import("./workspace-state.js").CurrentDocument} CurrentDocument */

/** Fallback when capabilities carry no `source-bytes-per-job` limit. */
export const IMPORT_SOURCE_FALLBACK_BYTES = 1_048_576;

/**
 * The import size limit: the compiler's own `source-bytes-per-job` envelope,
 * so an imported file can never exceed what a job would accept.
 * @param {any} capabilities
 */
export function importSourceLimit(capabilities) {
  const limits = capabilities?.service?.limits;
  const entry = Array.isArray(limits) ? limits.find((/** @type {any} */ item) => item?.id === "source-bytes-per-job") : undefined;
  const value = Number(entry?.value);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : IMPORT_SOURCE_FALLBACK_BYTES;
}

/**
 * Split a document body into Cell sources on top-level headings. Shared with
 * `parseDocument` in `app.js` so the two can never disagree on boundaries.
 * @param {string} body
 */
export function splitCellSources(body) {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/(?=^#{1,6}\s)/m).filter(Boolean).map((source) => source.trim()) : [""];
}

/**
 * Parse an imported file into its Current document and Cell sources. Front
 * matter is document-level; Cell boundaries come from `splitCellSources`.
 * @param {string} text the decoded file text
 * @param {{ fileName: string, maxBytes?: number }} options
 * @returns {{ document: CurrentDocument, sources: string[] }}
 */
export function parseImportSource(text, options) {
  if (!/\.aze\.md$/i.test(options.fileName.trim())) {
    throw new Error(`"${options.fileName}" is not an .aze.md file.`);
  }
  if (text.includes("\0")) throw new Error(`"${options.fileName}" is not a text file.`);
  const bytes = new TextEncoder().encode(text).length;
  const limit = options.maxBytes ?? IMPORT_SOURCE_FALLBACK_BYTES;
  if (bytes > limit) throw new Error(`"${options.fileName}" is above the import limit (${limit} bytes).`);
  const { document, body } = splitFrontMatter(text);
  if (!body.trim()) throw new Error(`"${options.fileName}" has no content to import.`);
  return { document, sources: splitCellSources(body) };
}
