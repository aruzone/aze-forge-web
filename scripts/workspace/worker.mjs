#!/usr/bin/env node
/**
 * The workspace audit's fixture worker: the same file-based contract as
 * `src/service/worker-entry.mjs`, with deterministic results so the audit can
 * drive minimum, typical, and stress fixtures without a compiler, a browser
 * engine, or a language model.
 *
 * The worker is the fixture, not the product: it places the specification's
 * diagnostic set in the assembled Source and answers analyze, compile, and
 * format from it. Everything the audit then observes is the real frontend and
 * the real service over real HTTP.
 *
 * Usage: `node scripts/workspace/worker.mjs <spec.json> <result.json>`
 */

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  fixtureCells,
  fixtureForSource,
  positionAt,
  stressDiagnostics,
  STRESS_TITLE,
} from "./fixtures.mjs";

const [specPath, resultPath] = /** @type {[string, string]} */ (process.argv.slice(2));
if (specPath === undefined || resultPath === undefined) {
  process.stderr.write("workspace worker requires <spec.json> <result.json>\n");
  process.exit(2);
}

/** @param {unknown} value */
const writeResult = async (value) => {
  const temporary = `${resultPath}.partial`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`);
  await rename(temporary, resultPath);
};

/** 1×1 PNG, so a downloaded artifact is a real image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/** @param {string} source @param {string} needle @param {number} [from] */
function positionOf(source, needle, from = 0) {
  const index = source.indexOf(needle, from);
  return index < 0 ? positionAt(source, 0) : positionAt(source, index);
}

/**
 * The fixture's diagnostics, positioned in the assembled Source: the stress
 * set lands on each Cell's own start, and the typical set lands on the Date
 * field so exact activation has a metadata target.
 * @param {string} source @param {import("./fixtures.mjs").FixtureId | null} fixture
 */
function diagnosticsFor(source, fixture) {
  if (fixture === "stress") {
    const cells = fixtureCells("stress");
    /** @type {number[]} */
    const starts = [];
    let cursor = 0;
    for (const cell of cells) {
      const index = cell.source.trim() === "" ? cursor : source.indexOf(cell.source, cursor);
      starts.push(index < 0 ? cursor : index);
      if (index >= 0) cursor = index + cell.source.length;
    }
    return stressDiagnostics().map((diagnostic) => {
      const start = positionAt(source, starts[diagnostic.cellIndex - 1] ?? 0);
      return {
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        data: {},
        relatedLocations: [],
        location: {
          source: "document.aze.md",
          range: { start, end: { ...start, column: start.column + 1 } },
        },
      };
    });
  }
  if (fixture === "typical") {
    const start = positionOf(source, "x-date:");
    return [{
      code: "fixture.metadata.01",
      severity: "warning",
      message: "Deterministic date diagnostic 01",
      data: {},
      relatedLocations: [],
      location: {
        source: "document.aze.md",
        range: { start, end: { ...start, column: start.column + 7 } },
      },
    }];
  }
  return [];
}

/** @param {string} format @param {string} theme @param {string} source */
function artifactBytes(format, theme, source) {
  const body = `Fixture artifact for theme ${theme}; Source ${source.length} characters.`;
  if (format === "html") {
    return Buffer.from(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture preview</title></head><body><h1>Fixture preview</h1><p>${body}</p></body></html>`,
      "utf8",
    );
  }
  if (format === "svg") {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="60"><text x="8" y="36">${body}</text></svg>`,
      "utf8",
    );
  }
  if (format === "png") return PNG;
  return Buffer.from(`%PDF-1.4\n% ${body}\n%%EOF\n`, "utf8");
}

const MIME = /** @type {Record<string, string>} */ ({
  html: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
  pdf: "application/pdf",
});

const spec = JSON.parse(await readFile(specPath, "utf8"));
const source = /** @type {string} */ (spec.source.text);
const fixture = fixtureForSource(source);
const diagnostics = diagnosticsFor(source, fixture);
const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
const ok = errors.length === 0;

if (spec.operation === "analyze") {
  await writeResult({
    operation: "analyze",
    ok,
    semantic: { valid: ok, contentHash: ok ? `sha256:${"a".repeat(64)}` : null },
    diagnostics,
    proposal: null,
    artifact: null,
  });
  process.exit(0);
}

if (spec.operation === "format") {
  await writeResult({
    operation: "format",
    ok,
    semantic: null,
    diagnostics,
    proposal: ok ? { kind: "formatted-source", source: `${source.trim()}\n` } : null,
    artifact: null,
  });
  process.exit(0);
}

if (spec.operation !== "compile" || typeof spec.format !== "string") {
  process.stderr.write(`unsupported fixture operation ${String(spec.operation)}\n`);
  process.exit(1);
}

if (!ok) {
  // The specification's stress fixture is an error document, so its compile is
  // the blocked path rather than a fabricated Artifact.
  await writeResult({
    operation: "compile",
    ok: false,
    semantic: { valid: false, contentHash: null },
    diagnostics,
    proposal: null,
    artifact: null,
  });
  process.exit(0);
}

const format = /** @type {string} */ (spec.format);
const theme = typeof spec.theme === "string" ? spec.theme : "default";
const bytes = artifactBytes(format, theme, source);
await writeFile(join(dirname(resultPath), "artifact.bin"), bytes);
await writeResult({
  operation: "compile",
  ok: true,
  semantic: { valid: true, contentHash: `sha256:${"a".repeat(64)}` },
  diagnostics,
  proposal: null,
  artifact: {
    format,
    mimeType: MIME[format] ?? "application/octet-stream",
    metadata: {
      format,
      mimeType: MIME[format] ?? "application/octet-stream",
      byteLength: bytes.byteLength,
      contentHash: `sha256:${"a".repeat(64)}`,
      assetManifestHash: `sha256:${"b".repeat(64)}`,
      rendererFingerprint: `sha256:${"c".repeat(64)}`,
      artifactHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      theme: { id: theme, version: "1.0.0" },
      cssDimensions: { canvasWidthPx: 320, contentWidthPx: 280, paddingPx: 16 },
    },
  },
});
process.exit(0);
