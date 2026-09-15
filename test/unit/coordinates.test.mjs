import assert from "node:assert/strict";
import test from "node:test";
import { indexForByteOffset, indexForPosition } from "../../src/web/coordinates.js";

const encoder = new TextEncoder();

/** The contract the frontend adapter must honour: byte offset → code-unit index. */
function expectedIndex(source, byteOffset) {
  // Built as an explicit boundary table (byte start, code-unit start) and then
  // scanned backwards, which is a different construction from the streaming
  // implementation under test.
  const boundaries = [];
  let bytes = 0;
  let index = 0;
  for (const character of Array.from(source)) {
    boundaries.push([bytes, index]);
    bytes += encoder.encode(character).length;
    index += character.length;
  }
  boundaries.push([bytes, index]);

  let chosen = boundaries[0];
  for (const boundary of boundaries) {
    if (boundary[0] <= byteOffset) chosen = boundary;
  }
  return chosen[1];
}

test("maps ASCII byte offsets to the same code-unit index", () => {
  const source = "azemark: 2\n# Title\n";
  for (let offset = 0; offset <= source.length; offset += 1) {
    assert.equal(indexForByteOffset(source, offset), offset);
  }
});

test("maps multi-byte characters by bytes, not by code units", () => {
  const source = "π ≈ 3.14159";
  assert.equal(encoder.encode("π").length, 2);
  assert.equal(encoder.encode("≈").length, 3);
  assert.equal(indexForByteOffset(source, 0), 0);
  assert.equal(indexForByteOffset(source, 2), 1, "byte 2 starts the space after π");
  assert.equal(indexForByteOffset(source, 4), 2, "byte 4 is inside ≈");
  assert.equal(indexForByteOffset(source, 6), 3, "byte 6 starts '3'");
  assert.equal(indexForByteOffset(source, 999), source.length, "past the end clamps");
});

test("resolves an offset inside a surrogate pair to that character's start", () => {
  const source = "a😀b";
  assert.equal(encoder.encode("😀").length, 4);
  assert.equal(indexForByteOffset(source, 1), 1);
  assert.equal(indexForByteOffset(source, 3), 1, "inside the emoji");
  assert.equal(indexForByteOffset(source, 5), 3, "after the emoji");
});

test("treats byte offsets as bytes and never as UTF-16 indexes", () => {
  const source = "é".repeat(4);
  assert.equal(indexForByteOffset(source, 3), 1, "byte 3 is still inside the first é");
  assert.equal(indexForByteOffset(source, 4), 2, "byte 4 starts the second é");
  assert.equal(indexForByteOffset(source, 8), 4);
});

test("falls back to 1-based line and code-point column when no offset is present", () => {
  const source = "first\nsecond line\nthird";
  assert.equal(indexForPosition(source, { line: 1, column: 1 }), 0);
  assert.equal(indexForPosition(source, { line: 2, column: 1 }), 6);
  assert.equal(indexForPosition(source, { line: 2, column: 7 }), 12);
  assert.equal(indexForPosition(source, { line: 3, column: 1 }), 18);
});

test("counts columns in code points, not code units or bytes", () => {
  const source = "πx\n😀y";
  assert.equal(indexForPosition(source, { line: 1, column: 3 }), 2, "π is one column");
  assert.equal(indexForPosition(source, { line: 2, column: 2 }), 5, "😀 is one column");
});

test("prefers an explicit byte offset over line and column", () => {
  const source = "πx";
  assert.equal(indexForPosition(source, { line: 1, column: 1, offset: 2 }), 1);
});

test("clamps positions outside the document", () => {
  const source = "one\ntwo";
  assert.equal(indexForPosition(source, { line: 99, column: 1 }), 4, "a line past the end clamps to the last line");
  assert.equal(indexForPosition(source, { line: 2, column: 99 }), 7);
  assert.equal(indexForPosition(source, undefined), 0);
});

test("stays consistent with a brute-force reference mapping", () => {
  const source = "Mixed π, 😀, and é — plus ASCII.";
  for (let offset = 0; offset <= encoder.encode(source).length; offset += 1) {
    assert.equal(indexForByteOffset(source, offset), expectedIndex(source, offset));
  }
});
