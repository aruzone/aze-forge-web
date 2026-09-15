/**
 * The service against the pinned compiler, with no stubs.
 *
 * This is the loop the alpha ships: a curated example compiles to a real
 * Artifact through an isolated worker, and every format the deployment
 * advertises produces bytes whose advertised hash matches.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { call, compileRequest, runJob, startTestService } from "./helpers/harness.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const examples = JSON.parse(await readFile(new URL("../src/web/examples.json", import.meta.url), "utf8"));

/** @type {Awaited<ReturnType<typeof startTestService>>} */
let service;
/** @type {ReturnType<typeof setTimeout>} */
let engineAvailable;

before(async () => {
  // The real worker entry: no stubbing, real compiler, real (isolated) browser.
  service = await startTestService({ realWorker: true, env: { AZEWEB_DEADLINE_COMPILE_MS: "300000" } });
  const capabilities = await call(service.base, "GET", "/v1/capabilities");
  engineAvailable = capabilities.json.compiler.engines.browser.availability === "available";
});

after(async () => {
  await service.close();
});

describe("pinned compiler", () => {
  test("capabilities reports the exact installed release and the pinned browser", async () => {
    const { json } = await call(service.base, "GET", "/v1/capabilities");
    assert.equal(json.compatibility.compilerRelease, packageJson.dependencies["@aruzone/aze-forge"]);
    assert.equal(json.compiler.tool.name, "azeforge");
    assert.equal(json.compiler.runtime.node.canonical, 24);
    assert.match(json.compiler.engines.browser.pinnedVersion, /^\d+\.\d+\.\d+\.\d+$/);
    assert.deepEqual(json.compiler.source.azemarkVersions, [2]);
    assert.equal(json.service.policy.rawMath, "unavailable");
  });

  test("the readiness self-check compiled a trivial Source through a real worker", async () => {
    const started = await startTestService({ realWorker: true });
    try {
      const readiness = started.application.runReadiness();
      assert.equal(readiness.ok, true, JSON.stringify(readiness.checks));
      assert.deepEqual(
        readiness.checks.map((check) => check.name),
        ["compiler-registry", "browser-engine", "scratch-storage", "self-check-compile"],
      );
    } finally {
      await started.close();
    }
  });
});

describe("the edit-preview-export loop", () => {
  for (const example of examples.filter((entry) => entry.id !== "diagnostics")) {
    test(`example "${example.id}" validates and previews`, async () => {
      const analyzed = await runJob(service.base, {
        protocolVersion: 1,
        requestId: `analyze-${example.id}`,
        revision: "rev-1",
        operation: "analyze",
        source: { text: example.source, name: `${example.id}.aze.md` },
      });
      assert.equal(analyzed.job.status, "completed");
      assert.equal(
        analyzed.job.result.ok,
        true,
        `${example.id}: ${analyzed.job.result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`,
      );
      assert.equal(analyzed.job.result.semantic.valid, true);
      // Analysis establishes validity; the pinned compiler only computes a
      // content hash while rendering, so a compile is where identity appears.
      assert.equal(analyzed.job.result.semantic.contentHash, null);

      const compiled = await runJob(service.base, {
        ...compileRequest(example.source, "html", "rev-1"),
        source: { text: example.source, name: `${example.id}.aze.md` },
      });
      assert.equal(compiled.job.result.ok, true);
      assert.match(compiled.job.result.semantic.contentHash, /^sha256:[0-9a-f]{64}$/);
      const download = await call(service.base, "GET", `/v1/jobs/${compiled.job.jobId}/artifact`, { raw: true });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-type"), "text/html; charset=utf-8");
      const body = download.body.toString("utf8");
      assert.match(body, /<!DOCTYPE html|<html/i, "the preview is the normal self-contained HTML Artifact");
      assert.ok(!/<script/i.test(body), "Artifacts never carry scripts");
      assert.ok(body.includes("data:font/woff2;base64"), "fonts are embedded");
      assert.equal(
        `sha256:${createHash("sha256").update(download.body).digest("hex")}`,
        compiled.job.result.artifact.artifactHash,
      );
    });
  }

  test("the acceptance golden report analyzes cleanly", async () => {
    // The deployment acceptance smoke suite compiles this document to every
    // Artifact format, so a document that no longer validates must fail here,
    // where the compiler is being changed, rather than at a cutover.
    const text = await readFile(new URL("../acceptance/golden-report.aze.md", import.meta.url), "utf8");
    const { job } = await runJob(service.base, {
      protocolVersion: 1,
      requestId: "analyze-acceptance-golden",
      revision: "rev-1",
      operation: "analyze",
      source: { text, name: "golden-report.aze.md" },
    });
    assert.equal(job.status, "completed");
    assert.equal(
      job.result.ok,
      true,
      `acceptance golden report: ${job.result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`,
    );
    assert.equal(job.result.semantic.valid, true);
  });

  test("the diagnostics example completes with real compiler diagnostics, not a server error", async () => {
    const example = examples.find((entry) => entry.id === "diagnostics");
    const { job } = await runJob(service.base, {
      protocolVersion: 1,
      requestId: "analyze-diagnostics",
      revision: "rev-1",
      operation: "analyze",
      source: { text: example.source, name: "diagnostics.aze.md" },
    });
    assert.equal(job.status, "completed");
    assert.equal(job.result.ok, false);
    assert.equal(job.result.semantic.contentHash, null);

    const codes = job.result.diagnostics.map((diagnostic) => diagnostic.code);
    assert.ok(codes.includes("azeforge.source#unknown-directive"), codes.join(", "));
    assert.ok(codes.includes("azeforge.reference#duplicate-id"), codes.join(", "));
    const ranged = job.result.diagnostics.find((diagnostic) => diagnostic.location?.range);
    assert.ok(ranged, "diagnostics carry Source ranges for the editor adapter");
    assert.equal(ranged.location.range.start.line, 10);
    assert.equal(ranged.location.range.start.offset >= 0, true, "byte offsets are present");
  });

  test("every advertised format produces a verifiable Artifact, or tells the truth about why not", async () => {
    const source = { text: examples[0].source, name: "formats.aze.md" };
    for (const format of ["html", "svg", "png", "pdf"]) {
      const { job } = await runJob(
        service.base,
        { ...compileRequest(source.text, format, "rev-formats"), source },
        { timeoutMs: 120_000 },
      );
      assert.equal(job.status, "completed", `${format}: the job itself must not fail`);

      if (!engineAvailable && format !== "html") {
        const codes = job.result.diagnostics.map((diagnostic) => diagnostic.code);
        assert.ok(
          codes.includes("azeforge.renderer#browser-unavailable"),
          `${format}: an unavailable required engine fails with a truthful diagnostic`,
        );
        assert.equal(job.result.artifact, undefined, `${format}: no silent fallback Artifact`);
        continue;
      }

      assert.equal(
        job.result.ok,
        true,
        `${format}: ${job.result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`,
      );
      const download = await call(service.base, "GET", `/v1/jobs/${job.jobId}/artifact`, { raw: true });
      assert.equal(download.status, 200);
      assert.equal(download.body.length, job.result.artifact.byteLength);
      assert.equal(download.headers.get("content-type"), job.result.artifact.mimeType);
      assert.equal(
        `sha256:${createHash("sha256").update(download.body).digest("hex")}`,
        job.result.artifact.artifactHash,
      );
      assert.equal(job.result.artifact.metadata.contentHash, job.result.semantic.contentHash);
    }
  });

  test("rendering never changes the semantic Document identity across formats", async () => {
    const source = { text: examples[1].source, name: "identity.aze.md" };
    const hashes = [];
    for (const format of ["html", "svg"]) {
      const { job } = await runJob(
        service.base,
        { ...compileRequest(source.text, format, "rev-identity"), source },
        { timeoutMs: 120_000 },
      );
      if (job.result.ok !== true) continue;
      hashes.push(job.result.semantic.contentHash);
    }
    assert.ok(hashes.length >= 1);
    assert.equal(new Set(hashes).size, 1, "one Document, one contentHash");
  });

  test("the same Theme choice changes layout metadata but not semantic identity", async () => {
    const text = examples[0].source;
    const first = await runJob(service.base, {
      ...compileRequest(text, "html", "rev-theme-1"),
      source: { text, name: "theme.aze.md" },
      theme: "default",
    });
    const second = await runJob(service.base, {
      ...compileRequest(text, "html", "rev-theme-2"),
      source: { text, name: "theme.aze.md" },
      theme: "academic",
    });
    assert.equal(first.job.result.semantic.contentHash, second.job.result.semantic.contentHash);
    assert.equal(first.job.result.artifact.metadata.theme.id, "default");
    assert.equal(second.job.result.artifact.metadata.theme.id, "academic");
    assert.notEqual(first.job.result.artifact.artifactHash, second.job.result.artifact.artifactHash);
  });

  test("raw LaTeX cannot be enabled through the request boundary", async () => {
    const raw = examples[1].source.replace(
      "integral x=-infinity..infinity of exp(-x^2) dx = sqrt(pi)",
      "\\frac{\\partial u}{\\partial t} = \\alpha \\nabla^2 u",
    );
    const { job } = await runJob(service.base, {
      protocolVersion: 1,
      requestId: "raw",
      revision: "rev-raw",
      operation: "analyze",
      source: { text: raw, name: "raw.aze.md" },
    });
    const codes = job.result.diagnostics.map((diagnostic) => diagnostic.code);
    assert.ok(
      codes.some((code) => code.includes("raw-latex") || code.includes("unsupported-notation")),
      `expected a refusal diagnostic, got ${codes.join(", ")}`,
    );
    assert.equal(job.result.semantic.valid, false);
  });

  test("a compile that fails preflight keeps its semantic result", async () => {
    if (engineAvailable) return;
    const { job } = await runJob(
      service.base,
      { ...compileRequest(examples[0].source, "png", "rev-pfl"), source: { text: examples[0].source } },
      { timeoutMs: 120_000 },
    );
    assert.equal(job.status, "completed");
    assert.equal(job.result.semantic.valid, true);
    assert.equal(job.result.artifact, undefined);
  });
});
