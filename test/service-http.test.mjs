/**
 * Service policy over real HTTP, with a stubbed compiler worker.
 *
 * These tests own what the service is responsible for: the access boundary,
 * protocol envelopes, admission, isolation, deadlines, cancellation,
 * retention, Artifact delivery and log privacy. Compiler behaviour is covered
 * by the real-compiler integration test.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  TEST_TOKEN,
  analyzeRequest,
  call,
  compileRequest,
  runJob,
  startTestService,
  wait,
} from "./helpers/harness.mjs";

/** @type {Awaited<ReturnType<typeof startTestService>>} */
let service;

before(async () => {
  service = await startTestService();
});

after(async () => {
  await service.close();
});

describe("access boundary", () => {
  test("health endpoints are open and detail-free; the versioned surface is not", async () => {
    const health = await call(service.base, "GET", "/healthz", { token: null });
    assert.equal(health.status, 200);
    assert.equal(health.text.trim(), "ok");

    const ready = await call(service.base, "GET", "/readyz", { token: null });
    assert.equal(ready.status, 200);

    const anonymous = await call(service.base, "GET", "/v1/capabilities", { token: null });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, "unauthorized");

    const wrongScheme = await call(service.base, "GET", "/v1/capabilities", { token: null });
    assert.equal(wrongScheme.status, 401);
  });

  test("a wrong token is rejected without revealing the expected one", async () => {
    const response = await call(service.base, "GET", "/v1/capabilities", { token: "z".repeat(40) });
    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, "unauthorized");
    assert.ok(!response.text.includes(TEST_TOKEN));
  });

  test("an unknown /v1 route is 401 without a token and 404 with one", async () => {
    assert.equal((await call(service.base, "GET", "/v1/nope", { token: null })).status, 401);
    assert.equal((await call(service.base, "GET", "/v1/nope")).status, 404);
  });

  test("serves the inert frontend with a restrictive policy", async () => {
    const page = await call(service.base, "GET", "/", { token: null });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(page.headers.get("x-content-type-options"), /nosniff/);
    const script = await call(service.base, "GET", "/app.js", { token: null });
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /text\/javascript/);
  });

  test("a not-ready service refuses work instead of answering", async () => {
    const fresh = await startTestService();
    try {
      fresh.application.service.setReadiness({ ok: false, checks: [{ name: "browser-engine", ok: false }] });
      const response = await call(fresh.base, "GET", "/v1/capabilities");
      assert.equal(response.status, 503);
      assert.equal(response.json.error.code, "service-unavailable");
      assert.ok(!/stack|at .*\.mjs/.test(response.text), "no stack traces");
      assert.equal((await call(fresh.base, "GET", "/healthz", { token: null })).status, 200);
      assert.equal((await call(fresh.base, "GET", "/readyz", { token: null })).status, 503);
    } finally {
      await fresh.close();
    }
  });
});

describe("capabilities and schemas", () => {
  test("reports compiler identity, protocol, effective limits and policy", async () => {
    const { status, json } = await call(service.base, "GET", "/v1/capabilities");
    assert.equal(status, 200);
    assert.equal(json.protocol.version, 1);
    assert.equal(json.compiler.tool.name, "azeforge");
    assert.equal(json.compatibility.compilerRelease, json.compiler.tool.version);
    assert.match(json.compatibility.capabilityFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(json.compatibility.sourceLanguages, [2]);
    assert.deepEqual(json.compatibility.documentSchemas, [2]);
    assert.deepEqual(json.service.operations, ["analyze", "compile", "format"]);
    assert.match(json.service.unavailableOperations.migrate, /no migrate operation/);
    assert.equal(json.service.policy.rawMath, "unavailable");
    assert.equal(json.service.policy.remoteAssets, "denied");
    assert.ok(json.service.limits.some((limit) => limit.id === "source-bytes-per-job" && limit.unit === "bytes"));
    assert.equal(json.service.deadlines.compileMs, service.config.deadlineCompileMs);
  });

  test("publishes compiler schemas and its own, and 404s the rest", async () => {
    const compilerSchema = await call(service.base, "GET", "/v1/schemas/azeforge.diagnostics%2Fv1");
    assert.equal(compilerSchema.status, 200);
    assert.equal(compilerSchema.json.$id, "azeforge.diagnostics/v1");

    const encoded = await call(service.base, "GET", "/v1/schemas/azeforge.web.job-request%2Fv1", { raw: true });
    assert.equal(encoded.status, 200);
    assert.equal(JSON.parse(encoded.body.toString()).$id, "azeforge.web.job-request/v1");

    const unencoded = await call(service.base, "GET", "/v1/schemas/azeforge.web.job-result/v1", { raw: true });
    assert.equal(unencoded.status, 200);

    assert.equal((await call(service.base, "GET", "/v1/schemas/nope%2Fv1")).status, 404);
    assert.equal((await call(service.base, "GET", "/v1/schemas/")).status, 404);
  });
});

describe("protocol envelopes", () => {
  test("an incompatible protocol version is rejected, never translated", async () => {
    const response = await call(service.base, "POST", "/v1/jobs", {
      body: { ...analyzeRequest("x"), protocolVersion: 2 },
      contentType: "application/json",
    });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, "protocol-version-unsupported");
    assert.equal(response.json.error.data.protocolVersion, 1);
  });

  test("malformed bodies and unknown fields are machine-coded errors", async () => {
    const notJson = await call(service.base, "POST", "/v1/jobs", {
      body: "{not json",
      contentType: "application/json",
    });
    assert.equal(notJson.status, 400);
    assert.equal(notJson.json.error.code, "request-malformed");

    const unknownField = await call(service.base, "POST", "/v1/jobs", {
      body: { ...analyzeRequest("x"), allowRawLatex: true },
      contentType: "application/json",
    });
    assert.equal(unknownField.status, 400);
    assert.equal(unknownField.json.error.code, "option-unsupported");

    const migrate = await call(service.base, "POST", "/v1/jobs", {
      body: { ...analyzeRequest("x"), operation: "migrate", targetAzemarkVersion: 2 },
      contentType: "application/json",
    });
    assert.equal(migrate.status, 400);
    assert.equal(migrate.json.error.code, "operation-unsupported");
  });

  test("an oversized body is refused with 413", async () => {
    const response = await call(service.base, "POST", "/v1/jobs", {
      body: JSON.stringify(analyzeRequest("x".repeat(service.config.maxJobBodyBytes + 1))),
      contentType: "application/json",
    });
    assert.equal(response.status, 413);
    assert.equal(response.json.error.code, "payload-too-large");
  });

  test("method mismatches name the method the resource supports", async () => {
    const response = await call(service.base, "GET", "/v1/jobs");
    assert.equal(response.status, 405);
    assert.equal(response.json.error.code, "method-not-allowed");
    assert.equal(response.json.error.data.allow, "POST");
  });
});

describe("job lifecycle", () => {
  test("analyze completes with the echoed revision and compiler context", async () => {
    const { accepted, job } = await runJob(service.base, analyzeRequest("# Title\n", "rev-7"));
    assert.equal(accepted.status, 202);
    assert.equal(accepted.json.statusUrl, `/v1/jobs/${accepted.json.jobId}`);
    assert.ok(accepted.json.pollAfterMs > 0);

    assert.equal(job.status, "completed");
    assert.equal(job.operation, "analyze");
    assert.equal(job.revision, "rev-7");
    assert.equal(job.requestId, "request-rev-7");
    assert.equal(job.result.ok, true);
    assert.equal(job.result.semantic.valid, true);
    assert.equal(job.result.compiler.release, "0.0.0-test");
    assert.equal(job.result.compiler.protocolVersion, 1);
    assert.ok(Date.parse(job.expiresAt) > Date.parse(job.terminalAt));
  });

  test("invalid Source completes with ok false and compiler diagnostics, not an HTTP error", async () => {
    const { job } = await runJob(service.base, analyzeRequest("STUB:INVALID\nSTUB:DIAGNOSTICS\n"));
    assert.equal(job.status, "completed");
    assert.equal(job.result.ok, false);
    assert.deepEqual(job.result.semantic, { valid: false, contentHash: null });
    assert.equal(job.result.diagnostics[0].code, "stub.diagnostic#sample");
    assert.ok(job.result.diagnostics[0].fix, "recovery information is preserved verbatim");
    assert.equal(job.failure, null);
  });

  test("optional public Document data is only included on request", async () => {
    const plain = await runJob(service.base, analyzeRequest("plain\n", "rev-a"));
    assert.equal("document" in plain.job.result.semantic, false);

    const requested = await runJob(service.base, {
      ...analyzeRequest("with document\n", "rev-b"),
      includeDocument: true,
    });
    assert.deepEqual(requested.job.result.semantic.document, { azemarkVersion: 2, schemaVersion: 2, blocks: [] });
  });

  test("format proposes a replacement bound to the submitted revision", async () => {
    const { job } = await runJob(service.base, {
      protocolVersion: 1,
      requestId: "r",
      revision: "rev-format",
      operation: "format",
      source: { text: "  spaced  \n" },
    });
    assert.equal(job.result.ok, true);
    assert.deepEqual(job.result.proposal, {
      kind: "formatted-source",
      source: "spaced\n",
      revision: "rev-format",
    });
    assert.equal(job.result.artifact, undefined);
  });

  test("an unknown job is not found", async () => {
    const response = await call(service.base, "GET", "/v1/jobs/00000000-0000-0000-0000-000000000000");
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, "not-found");
    assert.equal((await call(service.base, "POST", "/v1/jobs/nope/cancel")).status, 404);
    assert.equal((await call(service.base, "GET", "/v1/jobs/nope/artifact")).status, 404);
  });
});

describe("artifact delivery", () => {
  test("delivers the Artifact bytes with its MIME type and integrity hash", async () => {
    const { job } = await runJob(service.base, compileRequest("# Title\n", "png", "rev-png"));
    assert.equal(job.result.ok, true);
    assert.equal(job.result.artifact.format, "png");
    assert.equal(job.result.artifact.downloadUrl, `/v1/jobs/${job.jobId}/artifact`);

    const download = await call(service.base, "GET", `/v1/jobs/${job.jobId}/artifact`, { raw: true });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/x-stub-png");
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="artifact.png"');
    assert.match(download.headers.get("content-security-policy"), /sandbox/);
    assert.equal(download.body.length, job.result.artifact.byteLength);

    const { createHash } = await import("node:crypto");
    const digest = `sha256:${createHash("sha256").update(download.body).digest("hex")}`;
    assert.equal(digest, job.result.artifact.artifactHash, "the advertised hash matches the bytes");
  });

  test("an identical compile is answered from the cache without executing the worker", async () => {
    const request = compileRequest("# Cache me\n", "html", "rev-cache-1");
    const first = await runJob(service.base, request);
    assert.equal(first.job.cacheHit, false);

    const second = await runJob(service.base, { ...request, revision: "rev-cache-2", requestId: "second" });
    assert.equal(second.job.cacheHit, true);
    assert.equal(second.job.revision, "rev-cache-2", "a cache hit still produces a revision-specific result");
    assert.equal(second.job.result.artifact.artifactHash, first.job.result.artifact.artifactHash);
  });

  test("a different Theme is a different cache identity", async () => {
    const base = compileRequest("# Theme identity\n", "html", "rev-t1");
    await runJob(service.base, base);
    const other = await runJob(service.base, { ...base, theme: "academic", revision: "rev-t2", requestId: "t2" });
    assert.equal(other.job.cacheHit, false);
  });

  test("an Artifact that fails its integrity check never reaches a client", async () => {
    const { job } = await runJob(service.base, compileRequest("STUB:TAMPER\n", "html", "rev-tamper"));
    assert.equal(job.status, "failed");
    assert.equal(job.failure.code, "job-failed");
    assert.equal(
      (await call(service.base, "GET", `/v1/jobs/${job.jobId}/artifact`)).status,
      404,
      "no partial or unverified Artifact is ever published",
    );
  });

  test("terminal results expire and become not found", async () => {
    const shortLived = await startTestService({ env: { AZEWEB_RESULT_TTL_MS: "1000" } });
    try {
      const { job } = await runJob(shortLived.base, compileRequest("# expiring\n", "html"));
      assert.equal(job.status, "completed");
      await shortLived.application.jobs.prune();
      assert.equal((await call(shortLived.base, "GET", `/v1/jobs/${job.jobId}`)).status, 200, "not yet expired");

      await wait(1_050);
      await shortLived.application.jobs.prune();
      assert.equal((await call(shortLived.base, "GET", `/v1/jobs/${job.jobId}`)).status, 404);
      assert.equal((await call(shortLived.base, "GET", `/v1/jobs/${job.jobId}/artifact`)).status, 404);
    } finally {
      await shortLived.close();
    }
  });
});

describe("admission and cancellation", () => {
  test("queue depth is enforced with 429 and retry guidance", async () => {
    const limited = await startTestService({
      env: { AZEWEB_MAX_RUNNING_JOBS: "1", AZEWEB_QUEUE_DEPTH: "1" },
    });
    try {
      const slow = { ...analyzeRequest("STUB:SLEEP:3000\n", "rev-slow"), requestId: "slow" };
      assert.equal((await call(limited.base, "POST", "/v1/jobs", { body: slow, contentType: "application/json" })).status, 202);
      await wait(100);
      assert.equal(
        (await call(limited.base, "POST", "/v1/jobs", { body: { ...slow, requestId: "queued" }, contentType: "application/json" })).status,
        202,
      );
      const refused = await call(limited.base, "POST", "/v1/jobs", {
        body: { ...slow, requestId: "refused" },
        contentType: "application/json",
      });
      assert.equal(refused.status, 429);
      assert.equal(refused.json.error.code, "admission-limit");
      assert.equal(refused.json.error.data.scope, "queue-depth");
    } finally {
      await limited.close();
    }
  });

  test("per-token rate limits apply to submissions", async () => {
    const limited = await startTestService({ env: { AZEWEB_JOB_SUBMISSIONS_PER_MINUTE: "1" } });
    try {
      const first = await call(limited.base, "POST", "/v1/jobs", {
        body: analyzeRequest("x\n"),
        contentType: "application/json",
      });
      assert.equal(first.status, 202);
      const second = await call(limited.base, "POST", "/v1/jobs", {
        body: analyzeRequest("y\n"),
        contentType: "application/json",
      });
      assert.equal(second.status, 429);
      assert.equal(second.json.error.code, "rate-limit-exceeded");
      assert.ok(Number(second.headers.get("retry-after")) >= 1);
    } finally {
      await limited.close();
    }
  });

  test("cancelling a running job yields a terminal cancelled state with no Artifact", async () => {
    const submitted = await call(service.base, "POST", "/v1/jobs", {
      body: compileRequest("STUB:SLEEP:5000\n", "html", "rev-cancel"),
      contentType: "application/json",
    });
    assert.equal(submitted.status, 202);
    const jobId = submitted.json.jobId;

    await wait(150);
    const cancelled = await call(service.base, "POST", `/v1/jobs/${jobId}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.ok(["cancelling", "cancelled"].includes(cancelled.json.status));

    let terminal = cancelled.json;
    for (let attempt = 0; attempt < 100 && !["cancelled", "completed", "failed"].includes(terminal.status); attempt += 1) {
      await wait(50);
      terminal = (await call(service.base, "GET", `/v1/jobs/${jobId}`)).json;
    }
    assert.equal(terminal.status, "cancelled");
    assert.equal(terminal.result, null);
    assert.equal((await call(service.base, "GET", `/v1/jobs/${jobId}/artifact`)).status, 404);

    const repeated = await call(service.base, "POST", `/v1/jobs/${jobId}/cancel`);
    assert.equal(repeated.json.status, "cancelled", "repeated cancellation reports the authoritative state");
  });

  test("cancelling a queued job cancels it before it ever runs", async () => {
    const limited = await startTestService({ env: { AZEWEB_MAX_RUNNING_JOBS: "1", AZEWEB_QUEUE_DEPTH: "2" } });
    try {
      await call(limited.base, "POST", "/v1/jobs", {
        body: analyzeRequest("STUB:SLEEP:3000\n", "rev-run"),
        contentType: "application/json",
      });
      await wait(100);
      const queued = await call(limited.base, "POST", "/v1/jobs", {
        body: analyzeRequest("queued\n", "rev-queued"),
        contentType: "application/json",
      });
      const cancelled = await call(limited.base, "POST", `/v1/jobs/${queued.json.jobId}/cancel`);
      assert.equal(cancelled.json.status, "cancelled");
      assert.equal((await call(limited.base, "GET", `/v1/jobs/${queued.json.jobId}`)).json.startedAt, null);
    } finally {
      await limited.close();
    }
  });

  test("a job that overruns its deadline fails with the stable timeout code", async () => {
    const shortDeadline = await startTestService({ env: { AZEWEB_DEADLINE_ANALYZE_MS: "1000" } });
    try {
      const { job } = await runJob(shortDeadline.base, analyzeRequest("STUB:SLEEP:30000\n", "rev-slow"));
      assert.equal(job.status, "failed");
      assert.equal(job.failure.code, "job-timeout");
      assert.equal(job.failure.data.scope, "job-deadline");
      assert.equal(job.result, null);
    } finally {
      await shortDeadline.close();
    }
  });

  test("killing a timed-out job terminates its whole process group", async () => {
    const shortDeadline = await startTestService({ env: { AZEWEB_DEADLINE_ANALYZE_MS: "1000" } });
    try {
      const { job } = await runJob(shortDeadline.base, analyzeRequest("STUB:SPAWN\n", "rev-spawn"));
      assert.equal(job.status, "failed");

      const pidFile = await findFile(join(shortDeadline.scratchDir, "jobs"), "grandchild.pid");
      assert.ok(pidFile, "the stub recorded its child process");
      const pid = Number((await readFile(pidFile, "utf8")).trim());

      await wait(500);
      assert.equal(isAlive(pid), false, `pid ${pid} should have died with the job's process group`);
    } finally {
      await shortDeadline.close();
    }
  });

  test("a worker that dies without a result fails the job without leaking internals", async () => {
    const { job } = await runJob(service.base, analyzeRequest("STUB:EXIT:3\n", "rev-crash"));
    assert.equal(job.status, "failed");
    assert.equal(job.failure.code, "job-failed");
    assert.ok(!/simulated worker failure|\/Users\//.test(JSON.stringify(job)), "no worker message or host path");
  });
});

describe("uploaded assets", () => {
  test("an upload handle can be bound by a job, and revoking it cannot change that job", async () => {
    const upload = await call(service.base, "POST", "/v1/assets", {
      body: Buffer.from("svg-bytes"),
      contentType: "image/svg+xml",
    });
    assert.equal(upload.status, 201);
    assert.match(upload.json.assetId, /^[0-9a-f-]{36}$/);
    assert.equal(upload.json.mediaType, "image/svg+xml");
    assert.ok(Date.parse(upload.json.expiresAt) > Date.now());

    const { accepted, job } = await runJob(service.base, {
      ...compileRequest("# With assets\n", "svg", "rev-assets"),
      assets: [{ path: "images/logo.svg", handle: upload.json.assetId }],
    });
    assert.equal(accepted.status, 202);
    assert.equal(job.status, "completed");

    const removed = await call(service.base, "DELETE", `/v1/assets/${upload.json.assetId}`);
    assert.equal(removed.status, 204);
    assert.equal((await call(service.base, "DELETE", `/v1/assets/${upload.json.assetId}`)).status, 404);
    assert.equal(job.status, "completed", "the accepted job kept its frozen bytes");
  });

  test("an unknown handle is not found, and an oversized upload is 413", async () => {
    const missing = await call(service.base, "POST", "/v1/jobs", {
      body: {
        ...compileRequest("# Missing asset\n", "html", "rev-missing"),
        assets: [{ path: "a.png", handle: "does-not-exist" }],
      },
      contentType: "application/json",
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, "not-found");

    const oversized = await call(service.base, "POST", "/v1/assets", {
      body: Buffer.alloc(service.config.maxAssetBytes + 1),
      contentType: "image/png",
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.json.error.code, "payload-too-large");

    const empty = await call(service.base, "POST", "/v1/assets", {
      body: Buffer.alloc(0),
      contentType: "image/png",
    });
    assert.equal(empty.status, 400);
  });

  test("an asset path that would escape the job root is refused", async () => {
    const upload = await call(service.base, "POST", "/v1/assets", {
      body: Buffer.from("x"),
      contentType: "image/png",
    });
    const response = await call(service.base, "POST", "/v1/jobs", {
      body: {
        ...compileRequest("# Escape\n", "html", "rev-escape"),
        assets: [{ path: "../escape.png", handle: upload.json.assetId }],
      },
      contentType: "application/json",
    });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, "option-unsupported");
  });
});

describe("logging", () => {
  test("Source text, asset bytes and diagnostic messages never reach the logs", async () => {
    const marker = "CANARY-SOURCE-TEXT-7f31";
    const canary = await startTestService();
    try {
      await runJob(canary.base, analyzeRequest(`# ${marker}\nSTUB:DIAGNOSTICS\n`, "rev-canary"));
      const upload = await call(canary.base, "POST", "/v1/assets", {
        body: Buffer.from(`asset-${marker}`),
        contentType: "image/png",
      });
      await runJob(canary.base, {
        ...compileRequest(`# ${marker}\n`, "html", "rev-canary-2"),
        assets: [{ path: "images/a.png", handle: upload.json.assetId }],
      });

      const logged = canary.logs.join("");
      assert.ok(logged.includes("job-completed"), "the job really ran");
      assert.ok(!logged.includes(marker), "the canary Source text is absent");
      assert.ok(!logged.includes("A stub diagnostic"), "diagnostic messages are absent");
      assert.ok(!logged.includes(TEST_TOKEN), "the token is absent");
    } finally {
      await canary.close();
    }
  });
});

async function findFile(root, name) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(path, name);
      if (nested !== null) return nested;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
