import assert from "node:assert/strict";
import test from "node:test";
import { splitFrontMatter, stripFrontMatter } from "../../src/web/front-matter.js";
import { buildSourceDraft } from "../../src/service/authoring.mjs";

test("splits a block-sequence document like the shipped examples", () => {
  const source = "---\nazemark: 2\ntitle: Document basics\nauthor:\n  - AzeForge examples\ntheme: default\noutputs:\n  - html\n---\n\n# Document basics\n\nProse.\n";
  const { document, body, frontMatter } = splitFrontMatter(source);
  assert.equal(document.version, "2");
  assert.equal(document.title, "Document basics");
  assert.deepEqual(document.authors, ["AzeForge examples"]);
  assert.equal(document.metadata, "theme: default\noutputs:\n  - html");
  assert.equal(body, "# Document basics\n\nProse.\n");
  assert.equal(frontMatter, "azemark: 2\ntitle: Document basics\nauthor:\n  - AzeForge examples\ntheme: default\noutputs:\n  - html");
});

test("reads inline JSON and quoted front matter values", () => {
  const json = splitFrontMatter('---\ntitle: "Bench note"\nauthor: ["A", "B"]\nx-date: 2026-09-28\n---\nBody\n');
  assert.equal(json.document.title, "Bench note");
  assert.deepEqual(json.document.authors, ["A", "B"]);
  assert.equal(json.document.date, "2026-09-28");
  assert.equal(json.body, "Body\n");

  const quoted = splitFrontMatter("---\nazemark: 2\ntitle: 'Quoted'\n---\nBody\n");
  assert.equal(quoted.document.title, "Quoted");
});

test("an empty author key contributes no author", () => {
  const empty = splitFrontMatter("---\ntitle: T\nauthor:\n---\nBody\n");
  assert.deepEqual(empty.document.authors, []);
  const listed = splitFrontMatter("---\nauthor:\n  - One\n  - Two\n---\nBody\n");
  assert.deepEqual(listed.document.authors, ["One", "Two"]);
});

test("a thematic break and prose between dashes is Cell content", () => {
  const source = "---\nJust prose, no mapping.\n---\n\n# Heading\n";
  const { frontMatter, body, document } = splitFrontMatter(source);
  assert.equal(frontMatter, null);
  assert.equal(body, source);
  assert.equal(document.title, "");
});

test("a directive fence inside the body does not close the front matter", () => {
  const source = "---\nazemark: 2\ntitle: T\n---\n\n:::: equation\n----\nx = 1\n::::\n";
  const { body, frontMatter } = splitFrontMatter(source);
  assert.notEqual(frontMatter, null);
  assert.equal(body, ":::: equation\n----\nx = 1\n::::\n");
});

test("stripping a Cell removes a whole document's front matter", () => {
  const draft = buildSourceDraft({ kind: "source", title: "Pythagorean Theorem", blockType: "equation", text: "a^2 + b^2 = c^2" });
  assert.match(draft, /^---\nazemark: 2\ntitle: Pythagorean Theorem\nauthor:\n  - AzeForge Web\n---\n\n/);
  const stripped = stripFrontMatter(draft);
  assert.equal(stripped.removed, true);
  assert.match(stripped.source, /^:::: equation\nid: generated-draft\n----\na\^2 \+ b\^2 = c\^2\n::::\n$/);
  assert.doesNotMatch(stripped.source, /azemark|AzeForge Web/);
});

test("stripping a Cell without front matter is a no-op and is idempotent", () => {
  const cell = "# Heading\n\nProse only.\n";
  assert.deepEqual(stripFrontMatter(cell), { source: cell, removed: false });
  const once = stripFrontMatter("---\ntitle: T\n---\n\n# Heading\n");
  assert.equal(once.removed, true);
  assert.deepEqual(stripFrontMatter(once.source), { source: once.source, removed: false });
});

test("an indented continuation under a key is front matter, not Cell content", () => {
  const { frontMatter, body, document } = splitFrontMatter("---\ntitle: T\nabstract: |\n  Prose.\n---\nBody\n");
  assert.equal(frontMatter, "title: T\nabstract: |\n  Prose.");
  assert.equal(document.title, "T");
  assert.equal(document.metadata, "abstract: |\n  Prose.");
  assert.equal(body, "Body\n");
});

test("bodyStart is the offset just past the closing delimiter", () => {
  const source = "---\ntitle: T\n---\n\n# H\n";
  const { bodyStart } = splitFrontMatter(source);
  assert.equal(source.slice(bodyStart), "\n# H\n");
  assert.equal(splitFrontMatter("# H\n").bodyStart, 0);
});

test("recognises comments and unindented author sequences as front matter", () => {
  const source = "---\n# authoring note\nazemark: 2\ntitle: T\nauthor:\n- AzeForge Web\noutputs:\n- html\n---\n\n# Heading\n";
  const { frontMatter, document, body, bodyStart } = splitFrontMatter(source);
  assert.notEqual(frontMatter, null);
  assert.deepEqual(document.authors, ["AzeForge Web"]);
  assert.equal(document.metadata, "# authoring note\noutputs:\n- html");
  assert.equal(body, "# Heading\n");
  assert.equal(source.slice(bodyStart), "\n# Heading\n");
});

test("an unindented list with no pair between dashes is Cell content", () => {
  const source = "---\n- one\n- two\n---\n";
  assert.equal(splitFrontMatter(source).frontMatter, null);
});

test("a front-matter-only Source leaves an empty body", () => {
  const { body, frontMatter } = splitFrontMatter("---\nazemark: 2\ntitle: Only\n---\n");
  assert.notEqual(frontMatter, null);
  assert.equal(body, "");
});
