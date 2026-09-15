/**
 * Compiler Source coordinates → editor indexing.
 *
 * The compiler reports 1-based line and Unicode-code-point columns plus
 * 0-based UTF-8 byte offsets, with exclusive ends. A textarea indexes UTF-16
 * code units. Byte offsets are exact, so they are preferred; the line/column
 * path exists only for records that carry no range.
 *
 * Byte offsets are never relabelled as UTF-16 indexes. An offset that lands
 * inside a multi-byte character resolves to that character's start, so a
 * caret always lands on a real character boundary.
 */

/** @param {string} source @param {number} byteOffset */
export function indexForByteOffset(source, byteOffset) {
  if (!Number.isFinite(byteOffset) || byteOffset <= 0) return 0;
  let bytes = 0;
  let index = 0;
  for (const character of source) {
    const length = utf8Length(character.codePointAt(0) ?? 0);
    if (bytes + length > byteOffset) return index;
    bytes += length;
    index += character.length;
  }
  return source.length;
}

/** @param {string} source @param {{ line: number, column: number, offset?: number }} position */
export function indexForPosition(source, position) {
  if (position === null || position === undefined) return 0;
  if (typeof position.offset === "number") return indexForByteOffset(source, position.offset);

  const lines = source.split("\n");
  const lineIndex = Math.min(Math.max(position.line - 1, 0), lines.length - 1);
  let index = 0;
  for (let i = 0; i < lineIndex; i += 1) index += lines[i].length + 1;

  let codePoints = 0;
  for (const character of lines[lineIndex] ?? "") {
    if (codePoints >= position.column - 1) break;
    index += character.length;
    codePoints += 1;
  }
  return index;
}

/** @param {number} codePoint @returns {number} */
function utf8Length(codePoint) {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
