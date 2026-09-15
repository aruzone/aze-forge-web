import assert from "node:assert/strict";
import test from "node:test";
import { runOperation } from "../../src/service/runner.mjs";

/** A stand-in for the compiler's public operations. */
function fakeCompiler({ document, compileResult, formatResult } = {}) {
  const calls = [];
  return {
    calls,
    parse: (source, options) => {
      calls.push(["parse", options]);
      return { document: document ?? { blocks: [] }, diagnostics: [] };
    },
    validate: (parsed) => {
      calls.push(["validate"]);
      return document === undefined
        ? { diagnostics: [{ code: "source#bad", severity: "error", message: "bad", data: {}, relatedLocations: [] }] }
        : { document, diagnostics: [] };
    },
    format: (source, options) => {
      calls.push(["format", options]);
      return formatResult ?? { source: `${source.trim()}\n`, diagnostics: [] };
    },
    compile: async (source, options) => {
      calls.push(["compile", options]);
      return compileResult ?? { diagnostics: [], document, contentHash: "sha256:hash", artifact: artifact() };
    },
  };
}

function artifact() {
  return { bytes: new Uint8Array([1, 2, 3]), metadata: { format: "html", mimeType: "text/html" } };
}

const source = { text: "# Title\n", name: "doc.aze.md" };

test("analyze reports semantic success without rendering", async () => {
  const compiler = fakeCompiler({ document: { azemarkVersion: 2 } });
  const result = await runOperation(compiler, { operation: "analyze", source });
  assert.equal(result.ok, true);
  assert.deepEqual(result.semantic, { valid: true, contentHash: null });
  assert.equal(result.artifact ?? null, null);
  assert.equal(compiler.calls.some(([name]) => name === "compile"), false, "analyze never renders");
});

test("analyze returns public Document data only when it was requested", async () => {
  const compiler = fakeCompiler({ document: { azemarkVersion: 2 } });
  const without = await runOperation(compiler, { operation: "analyze", source });
  assert.equal("document" in without.semantic, false);
  const withDocument = await runOperation(compiler, { operation: "analyze", source, includeDocument: true });
  assert.deepEqual(withDocument.semantic.document, { azemarkVersion: 2 });
});

test("invalid Source reports diagnostics and never a Document or content hash", async () => {
  const compiler = fakeCompiler({ document: undefined });
  const result = await runOperation(compiler, { operation: "analyze", source });
  assert.equal(result.ok, false);
  assert.deepEqual(result.semantic, { valid: false, contentHash: null });
  assert.equal(result.diagnostics.length, 1);
});

test("a compile that fails to render keeps its semantic result but publishes no Artifact", async () => {
  const compiler = fakeCompiler({
    document: { azemarkVersion: 2 },
    compileResult: { diagnostics: [{ code: "renderer#unavailable", severity: "error" }] },
  });
  const result = await runOperation(compiler, { operation: "compile", source, format: "png" });
  assert.equal(result.ok, false);
  assert.equal(result.semantic.valid, true, "semantic validity survives a render failure");
  assert.equal(result.semantic.contentHash, null, "the pinned compiler exposes no hash without rendering");
  assert.equal(result.artifact ?? null, null);
});

test("a successful compile carries the Artifact bytes and its metadata", async () => {
  const compiler = fakeCompiler({ document: { azemarkVersion: 2 } });
  const result = await runOperation(compiler, {
    operation: "compile",
    source,
    format: "html",
    theme: "academic",
  });
  assert.equal(result.ok, true);
  assert.equal(result.semantic.contentHash, "sha256:hash");
  assert.equal(result.artifact.mimeType, "text/html");
  assert.deepEqual([...result.artifact.bytes], [1, 2, 3]);
  const compileCall = compiler.calls.find(([name]) => name === "compile");
  assert.equal(compileCall[1].theme, "academic");
  assert.equal(compileCall[1].sourceName, "doc.aze.md");
});

test("an invalid Source short-circuits before rendering", async () => {
  const compiler = fakeCompiler({ document: undefined });
  const result = await runOperation(compiler, { operation: "compile", source, format: "html" });
  assert.equal(result.ok, false);
  assert.equal(compiler.calls.some(([name]) => name === "compile"), false);
});

test("compile passes a project root only when the job bound assets", async () => {
  const compiler = fakeCompiler({ document: {} });
  await runOperation(compiler, { operation: "compile", source, format: "html", projectRoot: "/scratch/job/assets" });
  const [, options] = compiler.calls.find(([name]) => name === "compile");
  assert.equal(options.projectRoot, "/scratch/job/assets");
});

test("format proposes a replacement and never renders", async () => {
  const compiler = fakeCompiler();
  const result = await runOperation(compiler, { operation: "format", source });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.kind, "formatted-source");
  assert.equal(result.proposal.source, "# Title\n");
  assert.equal(compiler.calls.some(([name]) => name === "compile"), false);
});

test("a refused format is not a proposal", async () => {
  const compiler = fakeCompiler({ formatResult: { diagnostics: [{ code: "format#refused", severity: "error" }] } });
  const result = await runOperation(compiler, { operation: "format", source });
  assert.equal(result.ok, false);
  assert.equal(result.proposal, null);
});
