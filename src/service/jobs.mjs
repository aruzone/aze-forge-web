/**
 * Job lifecycle: admission, queueing, isolated execution, cancellation,
 * deadlines, retention.
 *
 * A job is a temporary execution record for one immutable Source snapshot —
 * not a saved document, and never shared with another job. Terminal states
 * never change. Cancellation and completion compete at a single atomic
 * terminal decision: whichever is observed first wins, and a `cancelling` job
 * can never publish an Artifact.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ERROR_CODES, ServiceError, serviceFailure } from "./errors.mjs";
import { canonicalJson, sha256BytesHex, sha256Hex } from "./hash.mjs";
import { PROTOCOL_VERSION } from "./protocol.mjs";

export const JOB_STATES = Object.freeze({
  queued: "queued",
  running: "running",
  cancelling: "cancelling",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
});

/** @type {ReadonlySet<import("./types.mjs").JobState>} */
const TERMINAL_STATES = new Set([
  JOB_STATES.completed,
  JOB_STATES.failed,
  JOB_STATES.cancelled,
]);

const MAX_CACHED_RESULT_BYTES = 8 * 1024 * 1024;

export class JobManager {
  /** @type {import("./config.mjs").Config} */
  #config;

  /** @type {import("./assets.mjs").AssetStore} */
  #assets;

  /** @type {import("./cache.mjs").ArtifactCache} */
  #cache;

  /** @type {import("./executor.mjs").JobExecutor} */
  #executor;

  /** @type {import("./types.mjs").AzeCompilerFacts} */
  #compilerFacts;

  /** @type {import("./types.mjs").AzeLogger} */
  #log;

  /** @type {() => number} */
  #now;

  /** @type {Map<string, import("./types.mjs").JobRecord>} */
  #jobs = new Map();

  /** @type {string[]} */
  #queue = [];

  /** @type {Set<string>} */
  #running = new Set();

  /** @type {Map<string, { pid?: number, kill: () => void }>} */
  #handles = new Map();

  /** @type {Map<string, NodeJS.Timeout>} */
  #deadlines = new Map();

  /** Bytes this process staged for retained jobs: frozen assets and Artifacts. */
  /** @type {number} */
  #jobDiskBytes = 0;

  /** @type {NodeJS.Timeout | null} */
  #pruneTimer = null;

  /**
   * @param {{ config: import("./config.mjs").Config,
   *           assets: import("./assets.mjs").AssetStore,
   *           cache: import("./cache.mjs").ArtifactCache,
   *           executor: import("./executor.mjs").JobExecutor,
   *           compilerFacts: import("./types.mjs").AzeCompilerFacts,
   *           log: import("./types.mjs").AzeLogger,
   *           now?: () => number }} input
   */
  constructor({ config, assets, cache, executor, compilerFacts, log, now = Date.now }) {
    this.#config = config;
    this.#assets = assets;
    this.#cache = cache;
    this.#executor = executor;
    this.#compilerFacts = compilerFacts;
    this.#log = log;
    this.#now = now;
  }

  async init() {
    await mkdir(this.jobsRoot(), { recursive: true });
    this.#pruneTimer = setInterval(() => {
      void this.prune();
    }, 30_000);
    this.#pruneTimer.unref?.();
  }

  jobsRoot() {
    return join(this.#config.scratchDir, "jobs");
  }

  /**
   * Admit one immutable snapshot. Returns the job record; throws a
   * `ServiceError` when admission itself is refused.
   *
   * @param {{ contextId: string, spec: import("./types.mjs").JobSpec }} input
   * @returns {Promise<import("./types.mjs").JobRecord>}
   */
  async submit({ contextId, spec }) {
    const bindings = await this.#resolveBindings(spec.assets ?? [], contextId);

    if (this.scratchBytesInUse >= this.#config.scratchMaxBytes) {
      throw new ServiceError(
        ERROR_CODES.serviceUnavailable,
        "Scratch storage is at capacity; retry shortly.",
        { data: { scope: "scratch-bytes" } },
      );
    }
    if (this.#retainedResults() >= this.#config.maxRetainedJobs) {
      throw new ServiceError(
        ERROR_CODES.serviceUnavailable,
        "The service is retaining the maximum number of unexpired results; retry after they expire.",
        { data: { limit: this.#config.maxRetainedJobs, scope: "retained-jobs" } },
      );
    }

    const jobId = randomUUID();
    const jobDir = join(this.jobsRoot(), jobId);
    await mkdir(join(jobDir, "assets"), { recursive: true });

    /** @type {import("./types.mjs").JobRecord} */
    const job = {
      jobId,
      contextId,
      operation: spec.operation,
      requestId: spec.requestId,
      revision: spec.revision,
      sourceName: spec.source.name ?? null,
      sourceText: spec.source.text,
      includeDocument: spec.includeDocument === true,
      hasAssets: bindings.length > 0,
      format: spec.format ?? null,
      theme: spec.theme ?? null,
      fingerprint: null,
      state: JOB_STATES.queued,
      ok: null,
      result: null,
      failure: null,
      cacheHit: false,
      timedOut: false,
      jobDir,
      artifactPath: null,
      artifactByteLength: 0,
      diskBytes: 0,
      submittedAt: this.#now(),
      startedAt: null,
      terminalAt: null,
      expiresAt: null,
      settled: false,
    };
    this.#jobs.set(jobId, job);
    this.#log.info("job-admitted", {
      jobId,
      tokenId: contextId.slice(0, 12),
      operation: job.operation,
      format: job.format,
      theme: job.theme,
    });

    const assetDigests = await this.#materializeAssets(job, bindings);

    if (job.operation === "compile") {
      const fingerprint = this.#compileFingerprint(spec, assetDigests);
      const cached = this.#cache.lookup(contextId, fingerprint);
      // A cache hit that cannot be read back is a miss, not a failure: the entry
      // may have been evicted between the lookup and the read.
      if (cached !== null && (await this.#completeFromCache(job, cached))) {
        return job;
      }
      job.fingerprint = fingerprint;
    }

    if (this.#running.size < this.#config.maxRunningJobs) {
      await this.#start(job);
    } else if (this.#queue.length < this.#config.queueDepth) {
      this.#queue.push(jobId);
      this.#armDeadline(job);
    } else {
      this.#jobs.delete(jobId);
      await rm(jobDir, { recursive: true, force: true });
      throw new ServiceError(
        ERROR_CODES.admissionLimit,
        `The service is at capacity (${this.#running.size} running, ${this.#queue.length} queued). Retry shortly.`,
        { data: { running: this.#running.size, queued: this.#queue.length, scope: "queue-depth" } },
      );
    }

    return job;
  }

  /**
   * @param {string} jobId
   * @param {string} contextId
   * @returns {import("./types.mjs").JobRecord | null}
   */
  get(jobId, contextId) {
    const job = this.#jobs.get(jobId);
    if (job === undefined || job.contextId !== contextId) return null;
    return job;
  }

  /**
   * Idempotent cancellation. A job that already reached a terminal state
   * reports that authoritative outcome unchanged.
   *
   * @param {string} jobId
   * @param {string} contextId
   * @returns {Promise<import("./types.mjs").JobRecord | null>}
   */
  async cancel(jobId, contextId) {
    const job = this.get(jobId, contextId);
    if (job === null) return null;
    if (TERMINAL_STATES.has(job.state)) return job;

    if (job.state === JOB_STATES.queued) {
      const index = this.#queue.indexOf(jobId);
      if (index >= 0) this.#queue.splice(index, 1);
      this.#terminalize(job, JOB_STATES.cancelled);
      this.#log.info("job-cancelled", { jobId, tokenId: contextId.slice(0, 12), state: "queued" });
      this.#pump();
      return job;
    }

    if (job.state === JOB_STATES.running) {
      job.state = JOB_STATES.cancelling;
      this.#log.info("job-cancelling", { jobId, tokenId: contextId.slice(0, 12) });
      this.#handles.get(jobId)?.kill();
    }
    return job;
  }

  /**
   * @param {string} jobId @param {string} contextId
   * @returns {Promise<{ bytes: Buffer, metadata: object } | null>}
   */
  async readArtifact(jobId, contextId) {
    const job = this.get(jobId, contextId);
    if (job === null || job.state !== JOB_STATES.completed) return null;
    if (job.artifactPath === null) return null;
    if (job.expiresAt !== null && job.expiresAt <= this.#now()) return null;
    try {
      const bytes = await readFile(job.artifactPath);
      return { bytes, metadata: job.result?.artifact?.metadata ?? {} };
    } catch {
      return null;
    }
  }

  get scratchBytesInUse() {
    return this.#assets.bytesInUse + this.#cache.bytesInUse + this.#jobDiskBytes;
  }

  stats() {
    /** @type {Record<string, number>} */
    const states = {};
    for (const job of this.#jobs.values()) {
      states[job.state] = (states[job.state] ?? 0) + 1;
    }
    return Object.freeze({
      running: this.#running.size,
      queued: this.#queue.length,
      retained: this.#jobs.size,
      states,
      scratchBytes: this.scratchBytesInUse,
    });
  }

  /** Drop expired assets, results and cache entries. */
  async prune() {
    const now = this.#now();
    await this.#assets.pruneExpired(now);
    await this.#cache.pruneExpired(now);

    for (const job of [...this.#jobs.values()]) {
      if (!TERMINAL_STATES.has(job.state)) continue;
      if (job.expiresAt === null || job.expiresAt > now) continue;
      await this.#discard(job);
    }
  }

  async close() {
    if (this.#pruneTimer !== null) clearInterval(this.#pruneTimer);
    for (const [jobId, handle] of this.#handles) {
      handle.kill();
      this.#log.warn("job-terminated-on-shutdown", { jobId });
    }
    for (const timer of this.#deadlines.values()) clearTimeout(timer);
    this.#deadlines.clear();
  }

  // ---------------------------------------------------------------- internals

  /**
   * @param {readonly { path: string, handle: string }[]} bindings
   * @param {string} contextId
   * @returns {Promise<import("./types.mjs").MaterializedBinding[]>}
   */
  async #resolveBindings(bindings, contextId) {
    const resolved = [];
    for (const binding of bindings) {
      const record = this.#assets.lookup(binding.handle, contextId);
      if (record === null) {
        throw new ServiceError(ERROR_CODES.notFound, "That asset is not available.", {});
      }
      resolved.push({ path: binding.path, record });
    }
    return resolved;
  }

  /**
   * Freeze the bound bytes into the job directory. From here on the job owns
   * them: revoking or expiring the upload handle cannot change this job.
   *
   * @param {import("./types.mjs").JobRecord} job
   * @param {readonly import("./types.mjs").MaterializedBinding[]} bindings
   * @returns {Promise<import("./types.mjs").AssetDigest[]>}
   */
  async #materializeAssets(job, bindings) {
    const assetsDir = join(job.jobDir, "assets");
    const digests = [];
    for (const { path, record } of bindings) {
      const bytes = await this.#assets.read(record.assetId);
      const target = resolve(assetsDir, ...path.split("/"));
      if (target !== assetsDir && !target.startsWith(`${assetsDir}${sep}`)) {
        throw new ServiceError(ERROR_CODES.optionUnsupported, "That asset path escapes the job root.", {
          data: { field: "assets" },
        });
      }
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, bytes, { mode: 0o600 });
      job.diskBytes += bytes.byteLength;
      this.#jobDiskBytes += bytes.byteLength;
      digests.push({ path, hash: sha256BytesHex(bytes), byteLength: bytes.byteLength });
    }
    digests.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return digests;
  }

  /**
   * @param {import("./types.mjs").JobSpec} spec
   * @param {import("./types.mjs").AssetDigest[]} assetDigests
   * @returns {string}
   */
  #compileFingerprint(spec, assetDigests) {
    return sha256Hex(
      canonicalJson({
        version: 1,
        compilerRelease: this.#compilerFacts.tool.version,
        capabilityFingerprint: this.#compilerFacts.capabilityFingerprint,
        operation: "compile",
        format: spec.format,
        theme: spec.theme,
        includeDocument: spec.includeDocument === true,
        sourceDigest: sha256Hex(spec.source.text),
        // Diagnostic locations carry the Source name, so a cached result may
        // only answer a job that submitted the same label.
        sourceName: spec.source.name ?? null,
        assets: assetDigests,
      }),
    );
  }

  /** @param {import("./types.mjs").JobRecord} job @returns {Promise<void>} */
  async #start(job) {
    job.state = JOB_STATES.running;
    job.startedAt = this.#now();
    this.#running.add(job.jobId);
    this.#armDeadline(job);

    const specPath = join(job.jobDir, "spec.json");
    const resultPath = join(job.jobDir, "result.json");
    try {
      await writeFile(
        specPath,
        JSON.stringify({
          operation: job.operation,
          source: {
            text: job.sourceText,
            ...(job.sourceName === null ? {} : { name: job.sourceName }),
          },
          ...(job.format === null ? {} : { format: job.format }),
          ...(job.theme === null ? {} : { theme: job.theme }),
          ...(job.includeDocument ? { includeDocument: true } : {}),
          ...(job.hasAssets ? { projectRoot: join(job.jobDir, "assets") } : {}),
        }),
        { mode: 0o600 },
      );
    } catch {
      this.#running.delete(job.jobId);
      this.#terminalize(
        job,
        JOB_STATES.failed,
        serviceFailure(ERROR_CODES.jobFailed, "The job snapshot could not be staged.", {}),
      );
      this.#log.error("job-stage-failure", { jobId: job.jobId });
      return;
    }

    const startedAt = this.#now();
    const handle = this.#executor.start({
      specPath,
      resultPath,
      cwd: job.jobDir,
      onSettled: (outcome) => {
        void this.#settle(job, outcome, resultPath, startedAt);
      },
    });
    this.#handles.set(job.jobId, handle);
  }

  /**
   * @param {import("./types.mjs").JobRecord} job
   * @param {{ code: number | null, signal: NodeJS.Signals | null }} outcome
   * @param {string} resultPath
   * @param {number} startedAt
   * @returns {Promise<void>}
   */
  async #settle(job, outcome, resultPath, startedAt) {
    if (job.settled) return;
    job.settled = true;

    this.#clearDeadline(job.jobId);
    this.#handles.delete(job.jobId);
    this.#running.delete(job.jobId);

    const durationMs = this.#now() - startedAt;

    if (job.state === JOB_STATES.cancelling) {
      this.#terminalize(job, JOB_STATES.cancelled);
      this.#log.info("job-cancelled", {
        jobId: job.jobId,
        tokenId: job.contextId.slice(0, 12),
        state: "running",
        durationMs,
      });
      this.#pump();
      return;
    }

    if (job.timedOut) {
      this.#terminalize(
        job,
        JOB_STATES.failed,
        serviceFailure(ERROR_CODES.jobTimeout, "The job exceeded its execution deadline.", {
          deadlineMs: this.#deadlineFor(job),
          scope: "job-deadline",
        }),
      );
      this.#log.warn("job-timeout", {
        jobId: job.jobId,
        tokenId: job.contextId.slice(0, 12),
        durationMs,
      });
      this.#pump();
      return;
    }

    const raw = await readResult(resultPath);
    if (raw === null || raw.workerError !== undefined) {
      this.#terminalize(
        job,
        JOB_STATES.failed,
        serviceFailure(ERROR_CODES.jobFailed, "The job did not complete successfully.", {}),
      );
      this.#log.error("job-failed", {
        jobId: job.jobId,
        tokenId: job.contextId.slice(0, 12),
        durationMs,
        exitCode: outcome.code,
        signal: outcome.signal ?? undefined,
        workerErrorName: raw?.workerError?.name,
      });
      this.#pump();
      return;
    }

    const completed = await this.#complete(job, raw);
    if (!completed) {
      this.#pump();
      return;
    }
    this.#log.info("job-completed", {
      jobId: job.jobId,
      tokenId: job.contextId.slice(0, 12),
      operation: job.operation,
      format: job.format,
      theme: job.theme,
      durationMs,
      ok: job.result?.ok,
      artifactBytes: job.artifactByteLength,
      artifactHash: job.result?.artifact?.artifactHash,
    });
    this.#pump();
  }

  /**
   * @param {import("./types.mjs").JobRecord} job
   * @param {import("./types.mjs").WorkerResult} raw
   * @returns {Promise<boolean>} false when the Artifact failed integrity checks
   */
  async #complete(job, raw) {
    /** @type {import("./types.mjs").AzeJobResult} */
    const result = {
      ok: raw.ok === true,
      compiler: this.#compilerContext(),
      semantic: raw.semantic ?? null,
      diagnostics: raw.diagnostics ?? [],
    };
    if (raw.proposal !== undefined && raw.proposal !== null) {
      result.proposal = { ...raw.proposal, revision: job.revision };
    }

    if (raw.artifact !== undefined && raw.artifact !== null) {
      const artifactPath = join(job.jobDir, "artifact.bin");
      /** @type {Buffer | null} */
      let bytes = null;
      try {
        bytes = await readFile(artifactPath);
      } catch {
        bytes = null;
      }

      // Cancellation and the deadline can be decided while the result and the
      // Artifact are being read. Every terminal decision below is therefore
      // taken after the awaits, so a job cancelled in the meantime cannot
      // publish, and cannot be relabelled as a failure either.
      if (!this.#mayPublish(job)) return false;

      if (bytes === null) {
        this.#terminalize(
          job,
          JOB_STATES.failed,
          serviceFailure(ERROR_CODES.jobFailed, "The Artifact was not delivered by the compiler.", {}),
        );
        return false;
      }
      if (
        bytes.byteLength !== raw.artifact.metadata.byteLength ||
        `sha256:${sha256BytesHex(bytes)}` !== raw.artifact.metadata.artifactHash
      ) {
        await rm(artifactPath, { force: true });
        if (!this.#mayPublish(job)) return false;
        this.#terminalize(
          job,
          JOB_STATES.failed,
          serviceFailure(ERROR_CODES.jobFailed, "The Artifact failed its integrity check.", {}),
        );
        this.#log.error("artifact-integrity-failure", {
          jobId: job.jobId,
          tokenId: job.contextId.slice(0, 12),
        });
        return false;
      }

      job.artifactPath = artifactPath;
      job.artifactByteLength = bytes.byteLength;
      this.#jobDiskBytes += bytes.byteLength;
      result.artifact = {
        format: raw.artifact.format,
        mimeType: raw.artifact.mimeType,
        byteLength: bytes.byteLength,
        artifactHash: raw.artifact.metadata.artifactHash,
        metadata: raw.artifact.metadata,
      };
    }

    if (!this.#mayPublish(job)) return false;
    this.#terminalize(job, JOB_STATES.completed, null, result);

    if (job.operation === "compile" && result.ok && result.artifact !== undefined) {
      await this.#admitToCache(job, result);
    }
    return true;
  }

  /**
   * @param {import("./types.mjs").JobRecord} job
   * @param {import("./types.mjs").AzeJobResult} result
   * @returns {Promise<void>}
   */
  async #admitToCache(job, result) {
    const cachedResult = { ...result };
    let serialized;
    try {
      serialized = canonicalJson(cachedResult);
    } catch {
      return;
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_CACHED_RESULT_BYTES) return;

    const artifact = result.artifact;
    const fingerprint = job.fingerprint;
    if (artifact === undefined || fingerprint === null) return;

    const bytes = await readFile(/** @type {string} */ (job.artifactPath));
    await this.#cache.admit({
      contextId: job.contextId,
      fingerprint,
      identity: {
        contentHash: result.semantic?.contentHash ?? null,
        assetManifestHash: artifact.metadata.assetManifestHash,
        rendererFingerprint: artifact.metadata.rendererFingerprint,
        artifactHash: artifact.artifactHash,
        format: artifact.format,
        theme: artifact.metadata.theme,
        compilerRelease: this.#compilerFacts.tool.version,
      },
      bytes,
      result: cachedResult,
    });
  }

  /**
   * @param {import("./types.mjs").JobRecord} job
   * @param {{ path: string, byteLength: number, result: any }} entry
   * @returns {Promise<boolean>} false when the cached bytes are no longer readable
   */
  async #completeFromCache(job, entry) {
    /** @type {Buffer} */
    let bytes;
    try {
      bytes = await this.#cache.read(entry);
    } catch {
      return false;
    }
    const artifactPath = join(job.jobDir, "artifact.bin");
    await writeFile(artifactPath, bytes, { mode: 0o600 });

    job.artifactPath = artifactPath;
    job.artifactByteLength = bytes.byteLength;
    this.#jobDiskBytes += bytes.byteLength;
    job.cacheHit = true;

    const cachedResult = entry.result;
    const result = {
      ok: cachedResult.ok,
      compiler: this.#compilerContext(),
      semantic: cachedResult.semantic,
      diagnostics: cachedResult.diagnostics,
      artifact: {
        format: cachedResult.artifact.format,
        mimeType: cachedResult.artifact.mimeType,
        byteLength: bytes.byteLength,
        artifactHash: cachedResult.artifact.artifactHash,
        metadata: cachedResult.artifact.metadata,
      },
    };
    this.#terminalize(job, JOB_STATES.completed, null, result);
    this.#log.info("job-cache-hit", {
      jobId: job.jobId,
      tokenId: job.contextId.slice(0, 12),
      format: job.format,
      theme: job.theme,
      artifactBytes: bytes.byteLength,
    });
    return true;
  }

  /**
   * A job may only publish while it is still allowed to finish: not cancelled,
   * not past its deadline. Checked after awaits, immediately before publishing.
   * @param {import("./types.mjs").JobRecord} job
   * @returns {boolean}
   */
  #mayPublish(job) {
    if (job.state === JOB_STATES.cancelling) {
      this.#terminalize(job, JOB_STATES.cancelled);
      this.#log.info("job-cancelled", {
        jobId: job.jobId,
        tokenId: job.contextId.slice(0, 12),
        state: "publication",
      });
      return false;
    }
    if (job.timedOut) {
      this.#terminalize(
        job,
        JOB_STATES.failed,
        serviceFailure(ERROR_CODES.jobTimeout, "The job exceeded its execution deadline.", {
          deadlineMs: this.#deadlineFor(job),
          scope: "job-deadline",
        }),
      );
      this.#log.warn("job-timeout", {
        jobId: job.jobId,
        tokenId: job.contextId.slice(0, 12),
        state: "publication",
      });
      return false;
    }
    return true;
  }

  /** @returns {object} */
  #compilerContext() {
    const { tool, capabilityFingerprint, versionReport } = this.#compilerFacts;
    const versions = /** @type {{ source: { azemarkVersions: number[] },
     *   document: { schemaVersions: number[] } }} */ (versionReport);
    return {
      release: tool.version,
      capabilityFingerprint,
      protocolVersion: PROTOCOL_VERSION,
      sourceLanguages: versions.source.azemarkVersions,
      documentSchemas: versions.document.schemaVersions,
      diagnosticSchema: "azeforge.diagnostics/v1",
    };
  }

  /** @param {import("./types.mjs").JobRecord} job */
  #armDeadline(job) {
    this.#clearDeadline(job.jobId);
    const remaining = Math.max(1, job.submittedAt + this.#deadlineFor(job) - this.#now());
    const timer = setTimeout(() => this.#expire(job.jobId), remaining);
    timer.unref?.();
    this.#deadlines.set(job.jobId, timer);
  }

  /** @param {string} jobId */
  #clearDeadline(jobId) {
    const timer = this.#deadlines.get(jobId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#deadlines.delete(jobId);
    }
  }

  /** @param {import("./types.mjs").JobRecord} job @returns {number} */
  #deadlineFor(job) {
    return job.operation === "compile"
      ? this.#config.deadlineCompileMs
      : this.#config.deadlineAnalyzeMs;
  }

  /** @param {string} jobId */
  #expire(jobId) {
    const job = this.#jobs.get(jobId);
    if (job === undefined || TERMINAL_STATES.has(job.state)) return;

    if (job.state === JOB_STATES.queued) {
      const index = this.#queue.indexOf(jobId);
      if (index >= 0) this.#queue.splice(index, 1);
      this.#terminalize(
        job,
        JOB_STATES.failed,
        serviceFailure(ERROR_CODES.jobTimeout, "The job exceeded its execution deadline.", {
          deadlineMs: this.#deadlineFor(job),
          scope: "job-deadline",
        }),
      );
      this.#log.warn("job-timeout", { jobId, tokenId: job.contextId.slice(0, 12), state: "queued" });
      this.#pump();
      return;
    }

    job.timedOut = true;
    this.#handles.get(jobId)?.kill();
  }

  /**
   * @param {import("./types.mjs").JobRecord} job
   * @param {import("./types.mjs").JobState} state
   * @param {import("./types.mjs").ServiceFailureInfo | null} [failure]
   * @param {import("./types.mjs").AzeJobResult | null} [result]
   */
  #terminalize(job, state, failure = null, result = null) {
    if (TERMINAL_STATES.has(job.state)) return;
    this.#clearDeadline(job.jobId);
    job.state = state;
    job.failure = failure;
    job.result = result;
    job.ok = state === JOB_STATES.completed && result !== null ? result.ok : null;
    job.terminalAt = this.#now();
    job.expiresAt = job.terminalAt + this.#config.resultTtlMs;
  }

  #pump() {
    while (this.#queue.length > 0 && this.#running.size < this.#config.maxRunningJobs) {
      const jobId = /** @type {string} */ (this.#queue.shift());
      const job = this.#jobs.get(jobId);
      if (job === undefined || job.state !== JOB_STATES.queued) continue;
      void this.#start(job);
    }
  }

  /**
   * Terminal results are retained for exactly as long as their advertised
   * `expiresAt` promises: an unexpired result is never evicted to make room.
   * The retained-record bound is therefore an admission bound, not an eviction
   * policy, and refusing new work is the honest failure mode.
   */
  #retainedResults() {
    const now = this.#now();
    let retained = 0;
    for (const job of this.#jobs.values()) {
      if (!TERMINAL_STATES.has(job.state)) continue;
      if (job.expiresAt !== null && job.expiresAt <= now) continue;
      retained += 1;
    }
    return retained;
  }

  /** @param {import("./types.mjs").JobRecord} job */
  async #discard(job) {
    if (!TERMINAL_STATES.has(job.state)) return;
    this.#jobs.delete(job.jobId);
    this.#jobDiskBytes -= job.diskBytes;
    await rm(job.jobDir, { recursive: true, force: true });
  }
}

/**
 * @param {string} resultPath
 * @returns {Promise<import("./types.mjs").WorkerResult | null>}
 */
async function readResult(resultPath) {
  try {
    return JSON.parse(await readFile(resultPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Public projection of a job record.
 * @param {import("./types.mjs").JobRecord} job
 * @param {number} pollAfterMs
 */
export function publicJob(job, pollAfterMs) {
  return {
    jobId: job.jobId,
    status: job.state,
    operation: job.operation,
    requestId: job.requestId,
    revision: job.revision,
    submittedAt: new Date(job.submittedAt).toISOString(),
    startedAt: job.startedAt === null ? null : new Date(job.startedAt).toISOString(),
    terminalAt: job.terminalAt === null ? null : new Date(job.terminalAt).toISOString(),
    expiresAt: job.expiresAt === null ? null : new Date(job.expiresAt).toISOString(),
    pollAfterMs,
    cacheHit: job.cacheHit,
    result:
      job.result === null || job.expiresAt === null
        ? job.result
        : {
            ...job.result,
            ...(job.result.artifact === undefined
              ? {}
              : {
                  artifact: {
                    ...job.result.artifact,
                    downloadUrl: `/v1/jobs/${job.jobId}/artifact`,
                    expiresAt: new Date(job.expiresAt).toISOString(),
                  },
                }),
          },
    failure: job.failure,
  };
}
