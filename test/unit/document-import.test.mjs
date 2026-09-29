/** Imported `.aze.md` parsing: heading-split Cells plus file guards. */

import assert from "node:assert/strict";
import test from "node:test";
import { importSourceLimit, parseImportSource } from "../../src/web/document-import.js";

test("splits an imported body on top-level headings", () => {
  const parsed = parseImportSource("---\nazemark: 2\ntitle: Bench note\n---\n\n# First\n\nProse.\n\n# Second\n\nMore.\n", {
    fileName: "bench.aze.md",
  });
  assert.equal(parsed.document.title, "Bench note");
  assert.equal(parsed.sources.length, 2);
  assert.ok(parsed.sources[0].startsWith("# First"));
  assert.ok(parsed.sources[1].startsWith("# Second"));
});

test("keeps a heading-free body as one Cell and reads front matter", () => {
  const parsed = parseImportSource("---\nazemark: 2\ntitle: Note\nauthor:\n  - Ada\n---\n\nJust prose.\n", {
    fileName: "note.aze.md",
  });
  assert.deepEqual(parsed.document.authors, ["Ada"]);
  assert.deepEqual(parsed.sources, ["Just prose."]);
});

test("accepts a file with no front matter as one Cell", () => {
  const parsed = parseImportSource("# Lone heading\n", { fileName: "lone.aze.md" });
  assert.equal(parsed.sources.length, 1);
});
test("trims inter-Cell separators so export-import is stable", () => {
  const once = parseImportSource("# First\n\nProse.\n\n# Second\n\nMore.\n", { fileName: "doc.aze.md" });
  assert.deepEqual(once.sources, ["# First\n\nProse.", "# Second\n\nMore."]);
  const again = parseImportSource(`---\nazemark: 2\n---\n\n${once.sources.join("\n\n")}\n`, { fileName: "doc.aze.md" });
  assert.deepEqual(again.sources, once.sources);
});

test("rejects a non-Markdown extension", () => {
  assert.throws(() => parseImportSource("# A\n", { fileName: "notes.txt" }), /\.aze\.md/);
});

test("rejects an empty file instead of wiping the Current document", () => {
  assert.throws(() => parseImportSource("---\nazemark: 2\ntitle: Empty\n---\n", { fileName: "empty.aze.md" }), /no content/);
});

test("rejects binary content", () => {
  assert.throws(() => parseImportSource("# A\0binary", { fileName: "blob.aze.md" }), /not a text file/);
});

test("rejects a file above the byte limit", () => {
  assert.throws(
    () => parseImportSource("# A\n", { fileName: "big.aze.md", maxBytes: 3 }),
    /above the import limit/,
  );
});

test("reads the import limit from capabilities with a 1 MiB fallback", () => {
  assert.equal(importSourceLimit(null), 1_048_576);
  assert.equal(
    importSourceLimit({ service: { limits: [{ id: "source-bytes-per-job", value: 512 }] } }),
    512,
  );
});
