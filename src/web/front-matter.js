// @ts-check

/**
 * Front matter belongs to the Current document, never to a Cell. This module is
 * the single place that recognises a front-matter block, so the split used at
 * load, the strip applied to a draft, and the strip applied to a pasted Cell
 * Source can never disagree.
 */

import { emptyDocument } from "./workspace-state.js";

/** @typedef {import("./workspace-state.js").CurrentDocument} CurrentDocument */

/** @param {string} raw */
function parseValue(raw) {
  if (raw.startsWith('"') || raw.startsWith("[")) {
    try { return JSON.parse(raw); } catch { /* fall through to quote stripping */ }
  }
  return raw.replace(/^['"]|['"]$/g, "");
}

/** `key: value` */
const PAIR = /^([\w-]+):[ \t]*(.*)$/;
/** A line indented under the pair before it, e.g. a block-scalar or nested-mapping line. */
const INDENTED = /^[ \t]/;
/** A block-sequence item, indented or at the top level. */
const ITEM = /^[ \t]*-[ \t]+/;
/** A YAML comment. */
const COMMENT = /^#[ \t]?/;

/**
 * Split a Source into its front matter and its body.
 *
 * A block only counts as front matter when the first line is `---`, a later
 * line is exactly `---`, at least one `key: value` pair is present, and every
 * line between them is a pair, a comment, a sequence item, an indented
 * continuation, or blank. A thematic break or a run of prose between dashes has
 * no pair and is Cell content, not front matter.
 *
 * @param {string} source
 * @returns {{ document: CurrentDocument, body: string, frontMatter: string | null, bodyStart: number }}
 */
export function splitFrontMatter(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const absent = { document: emptyDocument(), body: normalized, frontMatter: null, bodyStart: 0 };
  if (lines[0] !== "---") return absent;
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") { close = index; break; }
  }
  if (close < 1) return absent;
  const head = lines.slice(1, close);
  const mapping = head.some((line) => PAIR.test(line))
    && head.every((line) => line.trim() === "" || PAIR.test(line) || INDENTED.test(line) || ITEM.test(line) || COMMENT.test(line));
  if (!mapping) return absent;

  const document = emptyDocument();
  const extra = [];
  for (let index = 0; index < head.length; index += 1) {
    const line = head[index];
    const match = PAIR.exec(line);
    if (match === null) { extra.push(line); continue; }
    const key = match[1];
    const raw = match[2];
    // An author may be a block sequence (`author:` then `  - Name` lines).
    if (key === "author" && raw.trim() === "") {
      const named = [];
      while (index + 1 < head.length && ITEM.test(head[index + 1])) {
        named.push(head[index + 1].replace(ITEM, "").trim());
        index += 1;
      }
      if (named.length > 0) document.authors = named;
      continue;
    }
    if (raw.trim() === "") { extra.push(line); continue; }
    const value = parseValue(raw);
    if (key === "azemark") document.version = String(value);
    else if (key === "title") document.title = String(value);
    else if (key === "author") {
      document.authors = Array.isArray(value)
        ? value.map(String)
        : String(value).trim() === "" ? [] : [String(value)];
    } else if (key === "date" || key === "x-date") document.date = String(value);
    else extra.push(line);
  }
  document.metadata = extra.join("\n");
  return {
    document,
    body: lines.slice(close + 1).join("\n").replace(/^\n+/, ""),
    frontMatter: head.join("\n"),
    // Characters up to and including the closing delimiter's newline.
    bodyStart: lines.slice(0, close + 1).join("\n").length + 1,
  };
}

/**
 * Remove a front-matter block from a Cell Source. The Current document's
 * metadata is authored in Document details, so a Cell never carries one.
 *
 * @param {string} source
 * @returns {{ source: string, removed: boolean }}
 */
export function stripFrontMatter(source) {
  const { body, frontMatter } = splitFrontMatter(source);
  return frontMatter === null ? { source, removed: false } : { source: body, removed: true };
}
