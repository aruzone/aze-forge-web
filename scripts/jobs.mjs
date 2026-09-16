/**
 * The job protocol client shared by the evidence suites.
 *
 * One job is one immutable snapshot, so every helper here submits once and then
 * polls; a suite that hangs is evidence of a problem, not a reason to wait
 * forever.
 */

import { randomUUID } from "node:crypto";
import { CheckFailure } from "./cli.mjs";
import { describe, poll, request, sha256 } from "./http.mjs";

/** Job states that mean the job will not change again. */
export const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * An operation request. `requestId` and `revision` are the caller's, never the
 * service's: the frontend owns request scheduling, and so does a suite.
 *
 * @param {"analyze" | "compile" | "format"} operation
 * @param {{ text: string, name: string }} source
 * @param {Record<string, unknown>} [extra]
 * @param {string} [prefix]
 */
export function jobRequest(operation, source, extra = {}, prefix = "job") {
  return {
    protocolVersion: 1,
    requestId: `${prefix}-${operation}-${randomUUID().slice(0, 8)}`,
    revision: `${prefix}-revision-1`,
    operation,
    source,
    ...extra,
  };
}

/** @param {any} job @returns {string[]} */
export function diagnosticList(job) {
  return /** @type {string[]} */ (
    (job?.result?.diagnostics ?? []).map((/** @type {any} */ diagnostic) => diagnostic.code)
  );
}

/** @param {any} job @returns {string} */
export function diagnosticCodes(job) {
  return diagnosticList(job).join(", ") || "none";
}

/** @param {import("./http.mjs").HttpResponse} response */
export function requireJson(response) {
  if (response.json === null || typeof response.json !== "object") {
    throw new CheckFailure(`expected a JSON body, got: ${describe(response)}`);
  }
  return response.json;
}

/** @param {string} base @param {string} token */
export async function capabilitiesOf(base, token) {
  const response = await request(base, { path: "/v1/capabilities", token });
  if (response.status !== 200) {
    throw new CheckFailure(`GET /v1/capabilities returned ${response.status}: ${describe(response)}`);
  }
  return requireJson(response);
}

/** How many times an admission refusal is retried before it becomes a failure. */
const ADMISSION_ATTEMPTS = 5;

/**
 * A refusal that advertises retry guidance is transient by the service's own
 * account: a suite that submits a dozen jobs in a minute meets the deployment's
 * own rate limiter, and waiting is what the response asks for.
 *
 * @param {Headers} headers
 */
function retryAfterMs(headers) {
  const seconds = Number(headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return 1_000;
  return Math.min(Math.max(seconds * 1_000, 250), 30_000);
}

/**
 * Submit a job, and refuse to continue unless it was admitted. `429` with retry
 * guidance is waited out rather than treated as a verdict.
 *
 * @param {string} base @param {string} token @param {{ operation: string } & Record<string, unknown>} spec
 * @param {{ attempts?: number }} [options]
 */
export async function submit(base, token, spec, options = {}) {
  const attempts = options.attempts ?? ADMISSION_ATTEMPTS;
  for (let attempt = 1; ; attempt += 1) {
    const accepted = await request(base, {
      method: "POST",
      path: "/v1/jobs",
      token,
      body: spec,
      contentType: "application/json",
    });
    if (accepted.status === 202) return requireJson(accepted);
    if (accepted.status === 429 && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(accepted.headers)));
      continue;
    }
    throw new CheckFailure(
      `submitting ${spec.operation} was refused with ${accepted.status}: ${describe(accepted)}`,
    );
  }
}

/** @param {string} base @param {string} token @param {string} jobId */
export async function readJob(base, token, jobId) {
  const polled = await request(base, { path: `/v1/jobs/${jobId}`, token });
  if (polled.status !== 200) {
    throw new CheckFailure(`polling job ${jobId} returned ${polled.status}: ${describe(polled)}`);
  }
  return requireJson(polled);
}

/**
 * Submit and poll until the job reaches a terminal state.
 *
 * @param {string} base @param {string} token @param {{ operation: string } & Record<string, unknown>} spec
 * @param {{ timeoutMs?: number, intervalMs?: number, onPoll?: () => void }} [options]
 */
export async function runToTerminal(base, token, spec, options = {}) {
  const accepted = await submit(base, token, spec);
  return poll(() => readJob(base, token, accepted.jobId), (job) => TERMINAL.has(job.status), {
    timeoutMs: options.timeoutMs ?? 120_000,
    intervalMs: options.intervalMs ?? 250,
    onPoll: options.onPoll,
  });
}

/**
 * Download a completed job's Artifact and verify the service's own claim about
 * it: the advertised length, MIME type and byte-integrity hash.
 *
 * @param {string} base @param {string} token @param {any} job
 * @param {{ timeoutMs?: number, label?: string }} [options]
 * @returns {Promise<{ bytes: Buffer, artifact: any, contentHash: string | null }>}
 */
export async function downloadArtifact(base, token, job, options = {}) {
  const label = options.label ?? "artifact";
  const artifact = job?.result?.artifact;
  if (artifact === undefined || artifact === null) {
    throw new CheckFailure(`${label}: no Artifact was published`);
  }

  const download = await request(base, {
    path: artifact.downloadUrl,
    token,
    timeoutMs: options.timeoutMs ?? 300_000,
  });
  if (download.status !== 200) {
    throw new CheckFailure(`${label}: the Artifact download returned ${download.status}`);
  }
  if (download.headers.get("content-type") !== artifact.mimeType) {
    throw new CheckFailure(
      `${label}: the download is ${download.headers.get("content-type")}, not ${artifact.mimeType}`,
    );
  }
  if (download.bytes.byteLength !== artifact.byteLength) {
    throw new CheckFailure(
      `${label}: the download is ${download.bytes.byteLength} bytes, not the advertised ${artifact.byteLength}`,
    );
  }
  if (sha256(download.bytes) !== artifact.artifactHash) {
    throw new CheckFailure(
      `${label}: the downloaded bytes do not match the advertised ${artifact.artifactHash}`,
    );
  }
  return {
    bytes: download.bytes,
    artifact,
    contentHash: job.result?.semantic?.contentHash ?? null,
  };
}
