/**
 * The atomic terminal decision and the accounting rules, without a worker.
 *
 * The executor is injected, so these tests decide exactly when a job settles
 * relative to a cancellation or a deadline — the race the HTTP tests can only
 * approximate.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetStore } from "../../src/service/assets.mjs";
import { ArtifactCache } from "../../src/service/cache.mjs";
import { loadConfig } from "../../src/service/config.mjs";
import { JobManager } from "../../src/service/jobs.mjs";
import { createLogger } from "../../src/service/log.mjs";
import { fakeCompilerFacts } from "../helpers/harness.mjs";

const CONTEXT = "context-a";
const TOKEN = "t".repeat(40);

/** An executor that hands the test the settle callback instead of spawning. */
class FakeExecutor {
  /** @type {{ specPath: string, resultPath: string, cwd: string,
   *           onSettled: (outcome: { code: number | null, signal: NodeJS.Signals | null }) => void }[]} */
  runs = [];
  kills = 0;

  start(input) {
    this.runs.push(input);
    return {
      pid: 4242,
      kill: () => {
        this.kills += 1;
      },
    };
  }

  get last() {
    const run = this.runs.at(-1);
    if (run === undefined) throw new Error("no job was started");
    return run;
  }
}

async function harness(env = {}) {
  const scratchDir = await mkdtemp(join(tmpdir(), "azeweb-lifecycle-"));
  const config = loadConfig({
    AZEWEB_ACCESS_TOKEN: TOKEN,
    AZEWEB_SCRATCH_DIR: scratchDir,
    ...env,
  });
  const assets = new AssetStore({
    scratchDir,
    maxAssetBytes: config.maxAssetBytes,
    maxTotalAssetBytes: config.maxTotalAssetBytes,
    assetTtlMs: config.assetTtlMs,
  });
  await assets.init();
  const cache = new ArtifactCache({
    scratchDir,
    maxBytes: config.cacheMaxBytes,
    maxAgeMs: config.cacheMaxAgeMs,
  });
  await cache.init();
  const executor = new FakeExecutor();
  const jobs = new JobManager({
    config,
    assets,
    cache,
    executor,
    compilerFacts: fakeCompilerFacts(),
    log: createLogger({ stream: { write: () => true } }),
  });
  await jobs.init();
  return {
    jobs,
    executor,
    assets,
    config,
    scratchDir,
    cleanup: async () => {
      await jobs.close();
      await rm(scratchDir, { recursive: true, force: true });
    },
  };
}

function submitAnalyze(jobs, revision = "rev-1", text = "STUB\n") {
  return jobs.submit({
    contextId: CONTEXT,
    spec: {
      protocolVersion: 1,
      operation: "analyze",
      requestId: `request-${revision}`,
      revision,
      source: { text, name: "document.aze.md" },
      includeDocument: false,
    },
  });
}

/** Wait for a job to reach a terminal state, tolerating the settle path's I/O. */
async function settled(job) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") return job.state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${job.jobId} never settled (state ${job.state})`);
}

async function writeWorkerResult(executor, value, artifactBytes) {
  const { resultPath } = executor.last;
  if (artifactBytes !== undefined) {
    await writeFile(join(resultPath, "..", "artifact.bin"), artifactBytes);
  }
  await writeFile(resultPath, JSON.stringify(value));
}

function compileArtifact(bytes) {
  return {
    ok: true,
    semantic: { valid: true, contentHash: `sha256:${"a".repeat(64)}` },
    diagnostics: [],
    proposal: null,
    artifact: {
      format: "html",
      mimeType: "text/html",
      metadata: {
        format: "html",
        mimeType: "text/html",
        byteLength: bytes.byteLength,
        contentHash: `sha256:${"a".repeat(64)}`,
        assetManifestHash: `sha256:${"b".repeat(64)}`,
        rendererFingerprint: `sha256:${"c".repeat(64)}`,
        artifactHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        theme: { id: "default", version: "1.0.0" },
        cssDimensions: { canvasWidthPx: 10, contentWidthPx: 8, paddingPx: 1 },
      },
    },
  };
}

test("a cancellation decided before the worker settles wins, and publishes nothing", async () => {
  const { jobs, executor, cleanup } = await harness();
  try {
    const job = await submitAnalyze(jobs);
    await writeWorkerResult(executor, compileArtifact(Buffer.from("bytes")), Buffer.from("bytes"));

    await jobs.cancel(job.jobId, CONTEXT);
    assert.equal(job.state, "cancelling");
    assert.equal(executor.kills, 1, "the process group is terminated");

    executor.last.onSettled({ code: 0, signal: null });
    assert.equal(await settled(job), "cancelled");
    await jobs.cancel(job.jobId, CONTEXT);

    assert.equal(job.state, "cancelled");
    assert.equal(job.result, null);
    assert.equal(await jobs.readArtifact(job.jobId, CONTEXT), null);
  } finally {
    await cleanup();
  }
});

test("a completion decided first is terminal and repeated cancellation cannot change it", async () => {
  const { jobs, executor, cleanup } = await harness();
  try {
    const job = await submitAnalyze(jobs);
    await writeWorkerResult(executor, {
      ok: true,
      semantic: { valid: true, contentHash: null },
      diagnostics: [],
      proposal: null,
      artifact: null,
    });
    executor.last.onSettled({ code: 0, signal: null });
    assert.equal(await settled(job), "completed");

    const again = await jobs.cancel(job.jobId, CONTEXT);
    assert.equal(again?.state, "completed");
    assert.equal(executor.kills, 0, "a finished job is never killed");
  } finally {
    await cleanup();
  }
});

test("a deadline that fires before publication fails the job with the timeout code", async () => {
  const { jobs, executor, cleanup } = await harness({ AZEWEB_DEADLINE_ANALYZE_MS: "1000" });
  try {
    const job = await submitAnalyze(jobs);
    await writeWorkerResult(executor, {
      ok: true,
      semantic: { valid: true, contentHash: null },
      diagnostics: [],
      proposal: null,
      artifact: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(job.timedOut, true);
    assert.equal(executor.kills, 1);

    executor.last.onSettled({ code: null, signal: "SIGKILL" });
    assert.equal(await settled(job), "failed");

    assert.equal(job.state, "failed");
    assert.equal(job.failure?.code, "job-timeout");
    assert.equal(job.result, null);
  } finally {
    await cleanup();
  }
});

test("an Artifact that fails its integrity check is never published, and a refused job is not cached", async () => {
  const { jobs, executor, cleanup } = await harness();
  try {
    const job = await submitAnalyze(jobs);
    const bytes = Buffer.from("artifact");
    const result = compileArtifact(bytes);
    // Claim a different length than the bytes the worker delivered.
    result.artifact.metadata.byteLength = bytes.byteLength + 1;
    await writeWorkerResult(executor, result, bytes);

    executor.last.onSettled({ code: 0, signal: null });
    assert.equal(await settled(job), "failed");

    assert.equal(job.state, "failed");
    assert.equal(job.failure?.code, "job-failed");
    assert.equal(await jobs.readArtifact(job.jobId, CONTEXT), null);
  } finally {
    await cleanup();
  }
});

test("a worker that dies without a result fails the job without a fabricated diagnostic", async () => {
  const { jobs, executor, cleanup } = await harness();
  try {
    const job = await submitAnalyze(jobs);
    await writeWorkerResult(executor, { workerError: { name: "StubFailure", message: "boom" } });

    executor.last.onSettled({ code: 1, signal: null });
    assert.equal(await settled(job), "failed");

    assert.equal(job.state, "failed");
    assert.equal(job.failure?.code, "job-failed");
    assert.equal(job.result, null);
    assert.ok(!JSON.stringify(job.failure).includes("boom"), "the worker message is not echoed");
  } finally {
    await cleanup();
  }
});

test("the retained-result bound refuses admission instead of evicting an advertised result", async () => {
  const { jobs, executor, cleanup } = await harness({ AZEWEB_MAX_RETAINED_JOBS: "16" });
  try {
    const completed = [];
    for (let index = 0; index < 16; index += 1) {
      const job = await submitAnalyze(jobs, `rev-${index}`);
      await writeWorkerResult(executor, {
        ok: true,
        semantic: { valid: true, contentHash: null },
        diagnostics: [],
        proposal: null,
        artifact: null,
      });
      executor.last.onSettled({ code: 0, signal: null });
      await settled(job);
      completed.push(job);
    }

    await assert.rejects(
      () => submitAnalyze(jobs, "rev-overflow"),
      (error) => error.code === "service-unavailable" && error.data.scope === "retained-jobs",
    );

    const stillThere = await jobs.get(completed[0].jobId, CONTEXT);
    assert.equal(stillThere?.state, "completed", "an unexpired result keeps its advertised lifetime");
  } finally {
    await cleanup();
  }
});

test("a cache hit cannot answer a job that submitted a different Source name", async () => {
  const { jobs, executor, cleanup } = await harness();
  try {
    const spec = {
      protocolVersion: 1,
      operation: "compile",
      requestId: "r",
      revision: "rev-1",
      source: { text: "# Cache identity\n", name: "first.aze.md" },
      includeDocument: false,
      format: "html",
      theme: null,
      assets: [],
    };

    const first = await jobs.submit({ contextId: CONTEXT, spec });
    await writeWorkerResult(executor, compileArtifact(Buffer.from("bytes")), Buffer.from("bytes"));
    executor.last.onSettled({ code: 0, signal: null });
    assert.equal(await settled(first), "completed");

    const renamed = await jobs.submit({
      contextId: CONTEXT,
      spec: { ...spec, source: { ...spec.source, name: "second.aze.md" }, requestId: "r2" },
    });
    assert.equal(renamed.cacheHit, false, "diagnostic locations carry the Source name");

    const identical = await jobs.submit({ contextId: CONTEXT, spec: { ...spec, requestId: "r3" } });
    assert.equal(identical.cacheHit, true);
  } finally {
    await cleanup();
  }
});

test("staged asset bytes count towards the deployment's scratch ceiling", async () => {
  const { jobs, assets, executor, cleanup } = await harness();
  try {
    const asset = await assets.put(Buffer.alloc(1_000, 7), { mediaType: "image/png", contextId: CONTEXT });
    const job = await jobs.submit({
      contextId: CONTEXT,
      spec: {
        protocolVersion: 1,
        operation: "compile",
        requestId: "r",
        revision: "rev-1",
        source: { text: "# Assets\n" },
        includeDocument: false,
        format: "html",
        theme: null,
        assets: [{ path: "images/a.png", handle: asset.assetId }],
      },
    });
    assert.equal(job.state, "running");
    assert.ok(jobs.scratchBytesInUse >= 1_000, `scratch accounting is ${jobs.scratchBytesInUse}`);

    executor.last.onSettled({ code: 0, signal: null });
    await settled(job);
  } finally {
    await cleanup();
  }
});
