/**
 * The owner walkthrough against a real service over real HTTP.
 *
 * The deployment is the test harness's stubbed worker, so the walkthrough's own
 * obligations are what is under test: it must open the representative Source at
 * the exact advertised build, refuse a Source that does not span the ten
 * families, toggle every advertised Theme, verify each published Artifact hash
 * and identity, re-render a golden for determinism, and write the exports where
 * the owner can look at them.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { downloadArtifact, readJob } from "../scripts/jobs.mjs";
import { runWalkthrough } from "../scripts/walkthrough/checks.mjs";
import { goldenIdentityFrom } from "../scripts/walkthrough/golden.mjs";
import { GOLDEN_REPORT, WALKTHROUGH_SOURCE, readSource } from "../scripts/walkthrough/sources.mjs";
import { TEST_TOKEN, fakeCompilerFacts, startTestService } from "./helpers/harness.mjs";

const GOLDEN_IDENTITY_PATH = join(tmpdir(), `azeweb-golden-identity-${process.pid}.json`);
/** The fake compiler facts advertise this fingerprint; the walkthrough compares
 * the deployment's against the pinned release's. */
const PINS = { compiler: "0.0.0-test", browser: "0.0.0", capabilityFingerprint: `sha256:${"0".repeat(64)}` };
const THEMES = [
  { id: "academic", version: "1.0.0", title: "Academic", colorScheme: "light" },
  { id: "dark-presentation", version: "1.0.0", title: "Dark Presentation", colorScheme: "dark" },
  { id: "default", version: "1.0.0", title: "Default", colorScheme: "light" },
];

/** @type {Awaited<ReturnType<typeof startTestService>>} */
let service;
/** @type {string} */
let scratch;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "azeweb-walkthrough-"));
  // `fakeCompilerFacts` replaces the whole capabilities document when one is
  // supplied, so the three advertised Themes are merged into the default
  // document rather than replacing it.
  const defaults = fakeCompilerFacts();
  service = await startTestService({
    // The suite walks through the deployment several times in a row; a one
    // second rate-limit window keeps it under the deployment's own limiter
    // without waiting out retry guidance between runs.
    env: { AZEWEB_RATE_LIMIT_WINDOW_MS: "1000" },
    compilerFacts: fakeCompilerFacts({
      capabilities: { ...defaults.capabilities, themes: THEMES },
    }),
  });
});

after(async () => {
  await service.close();
  await rm(scratch, { recursive: true, force: true });
});

/** @param {{ source?: { text: string, name: string }, outDir?: string, goldenIdentity?: any }} [overrides] */
async function walkthrough(overrides = {}) {
  const outDir = overrides.outDir ?? join(scratch, `artifacts-${Math.random().toString(36).slice(2, 8)}`);
  const context = {
    base: service.base,
    token: TEST_TOKEN,
    pins: PINS,
    timeoutMs: 30_000,
    outDir,
    source: overrides.source ?? (await readSource(WALKTHROUGH_SOURCE)),
    goldens: [await readSource(GOLDEN_REPORT)],
    goldenIdentity: "goldenIdentity" in overrides ? overrides.goldenIdentity : recordedGolden,
    goldenIdentityPath: GOLDEN_IDENTITY_PATH,
  };
  return { run: await runWalkthrough(context), outDir };
}

/** The identity a reviewed run would have recorded: produced the same way the
 * CLI records one, from a run of this deployment, rather than hand-written. */
let recordedGolden = null;
async function recordGolden() {
  const { run } = await walkthrough({ goldenIdentity: null });
  recordedGolden = goldenIdentityFrom({ recordedAt: new Date().toISOString(), image: null, findings: run.findings });
  return run;
}

describe("the owner walkthrough", () => {
  test("opens the ten-family Source at the advertised build and exports every format", async () => {
    await recordGolden();
    const { run } = await walkthrough();
    assert.equal(
      run.failed,
      0,
      JSON.stringify(run.results.filter((result) => !result.ok), null, 1),
    );
    assert.equal(run.passed, 5);

    const units = run.findings.source?.coverage ?? [];
    assert.equal(units.length, 11);
    assert.ok(units.every((unit) => unit.covered), JSON.stringify(units));

    assert.deepEqual(
      run.findings.capabilities?.themes.map((theme) => theme.id),
      THEMES.map((theme) => theme.id),
    );
    assert.equal(run.findings.formats.length, 4);
    assert.match(run.findings.fixture?.contentHash ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(
      Object.keys(run.findings.fixture ? run.findings.formats.reduce((all, entry) => ({ ...all, [entry.format]: entry.artifactHash }), {}) : {}),
      ["html", "svg", "png", "pdf"],
    );
    assert.equal(new Set(run.findings.themes.map((theme) => theme.contentHash)).size, 1);
    assert.equal(new Set(run.findings.themes.map((theme) => theme.artifactHash)).size, THEMES.length);
    assert.equal(run.findings.determinism.length, 2, "the golden is rendered twice");
    assert.equal(run.findings.determinism[0].artifactHash, run.findings.determinism[1].artifactHash);
  });

  test("fails the golden step when the deployment drifts from the recorded golden", async () => {
    await recordGolden();
    const drifted = {
      ...recordedGolden,
      entries: {
        ...recordedGolden.entries,
        "golden-report.aze.md": { ...recordedGolden.entries["golden-report.aze.md"], artifactHash: `sha256:${"b".repeat(64)}` },
      },
    };
    const { run } = await walkthrough({ goldenIdentity: drifted });
    const golden = run.results.find((result) => result.id === "golden");
    assert.equal(golden?.ok, false);
    assert.match(golden?.detail ?? "", /drifted from the recorded golden/);
  });

  test("fails the golden step when nothing has been recorded", async () => {
    const { run } = await walkthrough({ goldenIdentity: null });
    const golden = run.results.find((result) => result.id === "golden");
    assert.equal(golden?.ok, false);
    assert.match(golden?.detail ?? "", /no golden identity has been recorded/);
  });

  test("writes the exported Artifacts where the owner can open them", async () => {
    await recordGolden();
    const { run, outDir } = await walkthrough();
    for (const format of ["html", "svg", "png", "pdf"]) {
      const written = join(outDir, `walkthrough.${format}`);
      const stats = await stat(written);
      assert.ok(stats.size > 0, `${format} export is empty`);
      const entry = run.findings.formats.find((candidate) => candidate.format === format);
      assert.equal(stats.size, entry?.byteLength);
      assert.ok((await readFile(written)).byteLength > 0);
    }
  });

  test("refuses a Source that does not span the ten families", async () => {
    await recordGolden();
    const { run } = await walkthrough({
      source: {
        name: "equation-only.aze.md",
        text: "---\nazemark: 2\ntitle: Narrow\n---\n\n# Narrow\n\n:::: equation\n----\nx = 1\n::::\n",
      },
    });
    const source = run.results.find((result) => result.id === "source");
    assert.equal(source?.ok, false);
    assert.match(source?.detail ?? "", /does not span the required capability families/);
    assert.match(source?.detail ?? "", /plotting/);
    assert.ok(run.failed > 0);
  });

  test("fails the export when the worker lies about its Artifact", async () => {
    // The service verifies an Artifact against its advertised hash before
    // publishing it, so a lying worker never produces a downloadable Artifact:
    // the job fails, and the walkthrough reports that rather than a byte count.
    await recordGolden();
    const { run } = await walkthrough({
      source: {
        name: "tampered.aze.md",
        text: "---\nazemark: 2\ntitle: Tampered\n---\n\n# Tampered\n\nSTUB:TAMPER\n",
      },
    });
    const exports = run.results.find((result) => result.id === "exports");
    assert.equal(exports?.ok, false);
    assert.match(exports?.detail ?? "", /settled as failed/);
  });

  test("the walkthrough verifies the hash the deployment advertises", async () => {
    // The client check is the last line of defence and is not reachable through
    // a deployment that polices its own Artifacts, so it is exercised against a
    // response that advertises a hash its bytes do not have.
    const advertised = `sha256:${"0".repeat(64)}`;
    const server = createServer((request, response) => {
      if (request.url === "/v1/jobs/job-1") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jobId: "job-1",
            status: "completed",
            result: {
              ok: true,
              semantic: { valid: true, contentHash: `sha256:${"a".repeat(64)}` },
              artifact: {
                downloadUrl: "/v1/jobs/job-1/artifact",
                mimeType: "text/plain",
                byteLength: 5,
                artifactHash: advertised,
              },
            },
          }),
        );
        return;
      }
      if (request.url === "/v1/jobs/job-1/artifact") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(Buffer.from("hello"));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const job = await readJob(base, TEST_TOKEN, "job-1");
      await assert.rejects(
        () => downloadArtifact(base, TEST_TOKEN, job, { label: "export html" }),
        (error) => {
          assert.equal(error.name, "CheckFailure");
          assert.match(error.message, /do not match the advertised/);
          return true;
        },
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
