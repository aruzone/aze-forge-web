/**
 * Built-in alpha operating-envelope values.
 *
 * These are the numeric defaults owned by "Define the deployable web-alpha
 * operating envelope" (aruzone/aze-forge#54). Every value here is also the
 * hard ceiling for the corresponding deployment knob: configuration may only
 * lower a ceiling, never raise it. Raising one is an owner decision, not a
 * configuration change, so a configured value above `max` is a startup error
 * rather than a silent clamp.
 *
 * This module is the single source of truth for those numbers. Nothing else
 * may inline them.
 */

export const KIB = 1024;
export const MIB = 1024 * KIB;
export const GIB = 1024 * MIB;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/**
 * @typedef {object} Knob
 * @property {string} env environment variable name, without the `AZEWEB_` prefix
 * @property {"string" | "number"} [kind] defaults to `number`
 * @property {boolean} [required] no default; must be supplied
 * @property {boolean} [secret] never logged, never echoed
 * @property {string | number} [default]
 * @property {number} [min] smallest accepted value
 * @property {number} [max] envelope ceiling; configuration may only lower it
 */

/**
 * `env` is the `AZEWEB_`-stripped environment variable name.
 * `max` is the envelope ceiling; `min` is the smallest accepted value.
 * `required` knobs have no default and must be supplied.
 *
 * @type {Readonly<Record<string, Knob>>}
 */
export const KNOBS = Object.freeze({
  accessToken: { env: "ACCESS_TOKEN", required: true, secret: true, kind: "string" },
  host: { env: "HOST", default: "0.0.0.0", kind: "string" },
  port: { env: "PORT", default: 8080, min: 0, max: 65_535 },

  maxRunningJobs: { env: "MAX_RUNNING_JOBS", default: 2, min: 1, max: 2 },
  queueDepth: { env: "QUEUE_DEPTH", default: 8, min: 0, max: 8 },
  jobSubmissionsPerMinute: {
    env: "JOB_SUBMISSIONS_PER_MINUTE",
    default: 30,
    min: 1,
    max: 30,
  },
  assetUploadsPerMinute: {
    env: "ASSET_UPLOADS_PER_MINUTE",
    default: 60,
    min: 1,
    max: 60,
  },
  rateLimitWindowMs: { env: "RATE_LIMIT_WINDOW_MS", default: MINUTE_MS, min: 1_000, max: MINUTE_MS },

  deadlineAnalyzeMs: { env: "DEADLINE_ANALYZE_MS", default: MINUTE_MS, min: 1_000, max: MINUTE_MS },
  deadlineCompileMs: {
    env: "DEADLINE_COMPILE_MS",
    default: 5 * MINUTE_MS,
    min: 1_000,
    max: 5 * MINUTE_MS,
  },
  terminationGraceMs: { env: "TERMINATION_GRACE_MS", default: 5_000, min: 0, max: 5_000 },
  pollAfterMs: { env: "POLL_AFTER_MS", default: 2_000, min: 250, max: 2_000 },

  maxSourceBytes: { env: "MAX_SOURCE_BYTES", default: 1 * MIB, min: 1, max: 1 * MIB },
  maxJobBodyBytes: { env: "MAX_JOB_BODY_BYTES", default: 2 * MIB, min: 1, max: 2 * MIB },
  maxAssetBytes: { env: "MAX_ASSET_BYTES", default: 32 * MIB, min: 1, max: 32 * MIB },
  maxTotalAssetBytes: {
    env: "MAX_TOTAL_ASSET_BYTES",
    default: 128 * MIB,
    min: 1,
    max: 128 * MIB,
  },
  maxAssetsPerJob: { env: "MAX_ASSETS_PER_JOB", default: 64, min: 0, max: 64 },

  assetTtlMs: { env: "ASSET_TTL_MS", default: 24 * HOUR_MS, min: 1_000, max: 24 * HOUR_MS },
  resultTtlMs: { env: "RESULT_TTL_MS", default: HOUR_MS, min: 1_000, max: HOUR_MS },
  maxRetainedJobs: { env: "MAX_RETAINED_JOBS", default: 256, min: 16, max: 256 },
  cacheMaxBytes: { env: "CACHE_MAX_BYTES", default: 256 * MIB, min: 0, max: 256 * MIB },
  cacheMaxAgeMs: { env: "CACHE_MAX_AGE_MS", default: 24 * HOUR_MS, min: 1_000, max: 24 * HOUR_MS },
  scratchMaxBytes: { env: "SCRATCH_MAX_BYTES", default: 2 * GIB, min: 1, max: 2 * GIB },

  scratchDir: { env: "SCRATCH_DIR", kind: "string" },
});

const PREFIX = "AZEWEB_";

/** @param {string} key */
export function envNameFor(key) {
  const knob = KNOBS[key];
  if (knob === undefined) throw new Error(`Unknown configuration knob: ${key}`);
  return `${PREFIX}${knob.env}`;
}

/** Every `AZEWEB_*` variable name the service understands. */
export function knownEnvNames() {
  return Object.keys(KNOBS).map(envNameFor);
}

/**
 * @typedef {object} PublishedLimit
 * @property {string} id
 * @property {string} unit
 * @property {string} scope
 * @property {number} value
 */

/**
 * Effective limits published on `GET /v1/capabilities`. These are the values
 * the service actually enforces, with ids, units and scope.
 *
 * @param {import("./config.mjs").Config} config
 * @returns {readonly PublishedLimit[]}
 */
export function publishedLimits(config) {
  return Object.freeze([
    limit("source-bytes-per-job", "bytes", "job", config.maxSourceBytes),
    limit("job-body-bytes", "bytes", "request", config.maxJobBodyBytes),
    limit("asset-bytes", "bytes", "asset", config.maxAssetBytes),
    limit("total-asset-bytes", "bytes", "deployment", config.maxTotalAssetBytes),
    limit("assets-per-job", "count", "job", config.maxAssetsPerJob),
    limit("concurrent-jobs", "count", "deployment", config.maxRunningJobs),
    limit("queue-depth", "count", "deployment", config.queueDepth),
    limit("job-submissions", "requests", "per-token-per-minute", config.jobSubmissionsPerMinute),
    limit("asset-uploads", "requests", "per-token-per-minute", config.assetUploadsPerMinute),
    limit("job-deadline", "ms", "analyze|format", config.deadlineAnalyzeMs),
    limit("job-deadline", "ms", "compile", config.deadlineCompileMs),
    limit("termination-grace", "ms", "job", config.terminationGraceMs),
    limit("asset-handle-retention", "ms", "asset", config.assetTtlMs),
    limit("result-retention", "ms", "job", config.resultTtlMs),
    limit("retained-jobs", "count", "deployment", config.maxRetainedJobs),
    limit("cache-bytes", "bytes", "deployment", config.cacheMaxBytes),
    limit("cache-age", "ms", "deployment", config.cacheMaxAgeMs),
    limit("scratch-bytes", "bytes", "deployment", config.scratchMaxBytes),
  ]);
}

/**
 * @param {string} id
 * @param {string} unit
 * @param {string} scope
 * @param {number} value
 * @returns {PublishedLimit}
 */
function limit(id, unit, scope, value) {
  return Object.freeze({ id, unit, scope, value });
}
