/**
 * Configuration is environment-variables only, validated at startup and
 * fail-closed. Missing or invalid configuration is a startup error, distinct
 * from Source diagnostics.
 */

import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { KNOBS, envNameFor, knownEnvNames } from "./limits.mjs";

/**
 * The effective configuration. Every field is a validated envelope value, so
 * consumers never re-parse or re-check a setting.
 *
 * @typedef {object} Config
 * @property {string} accessToken
 * @property {string} host
 * @property {number} port
 * @property {number} maxRunningJobs
 * @property {number} queueDepth
 * @property {number} nodeHeapMb
 * @property {number} jobSubmissionsPerMinute
 * @property {number} assetUploadsPerMinute
 * @property {number} rateLimitWindowMs
 * @property {number} deadlineAnalyzeMs
 * @property {number} deadlineCompileMs
 * @property {number} terminationGraceMs
 * @property {number} pollAfterMs
 * @property {number} maxSourceBytes
 * @property {number} maxJobBodyBytes
 * @property {number} maxAssetBytes
 * @property {number} maxTotalAssetBytes
 * @property {number} maxAssetsPerJob
 * @property {number} assetTtlMs
 * @property {number} resultTtlMs
 * @property {number} maxRetainedJobs
 * @property {number} cacheMaxBytes
 * @property {number} cacheMaxAgeMs
 * @property {number} scratchMaxBytes
 * @property {string} scratchDir
 */

/** Thrown for any configuration problem. Never reaches an HTTP response. */
export class ConfigurationError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid AzeForge Web configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigurationError";
    this.problems = Object.freeze([...problems]);
  }

  /** @type {readonly string[]} */
  problems;
}

const MIN_TOKEN_LENGTH = 32;

/**
 * Parse and validate configuration from an environment object.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Readonly<Config>}
 */
export function loadConfig(env = process.env) {
  /** @type {string[]} */
  const problems = [];
  const known = new Set(knownEnvNames());
  for (const name of Object.keys(env)) {
    if (name.startsWith("AZEWEB_") && !known.has(name)) {
      problems.push(`${name} is not a recognized AzeForge Web setting.`);
    }
  }

  /** @type {Record<string, string | number>} */
  const raw = {};
  for (const [key, knob] of Object.entries(KNOBS)) {
    const name = envNameFor(key);
    const text = env[name];
    if (text === undefined || text === "") {
      if (knob.required === true) problems.push(`${name} is required.`);
      else if (knob.default !== undefined) raw[key] = knob.default;
      continue;
    }
    if (knob.kind === "string") {
      raw[key] = text;
      continue;
    }
    const value = Number(text);
    if (!Number.isInteger(value)) {
      problems.push(`${name} must be an integer; received ${JSON.stringify(text)}.`);
      continue;
    }
    if (knob.min !== undefined && value < knob.min) {
      problems.push(`${name} must be at least ${knob.min}; received ${value}.`);
      continue;
    }
    if (knob.max !== undefined && value > knob.max) {
      problems.push(
        `${name} exceeds the built-in alpha ceiling of ${knob.max}; received ${value}. ` +
          `Configuration may lower a ceiling, never raise it.`,
      );
      continue;
    }
    raw[key] = value;
  }

  const token = raw.accessToken;
  if (typeof token === "string") {
    if (token.length < MIN_TOKEN_LENGTH) {
      problems.push(
        `${envNameFor("accessToken")} must be at least ${MIN_TOKEN_LENGTH} characters; ` +
          `received ${token.length}.`,
      );
    }
    if (/\s/.test(token)) {
      problems.push(`${envNameFor("accessToken")} must not contain whitespace.`);
    }
  }

  if (problems.length > 0) throw new ConfigurationError(problems);

  const scratchDir = resolve(
    typeof raw.scratchDir === "string" ? raw.scratchDir : join(tmpdir(), "aze-forge-web"),
  );

  return /** @type {Readonly<Config>} */ (Object.freeze({ ...raw, scratchDir }));
}

/**
 * Which knobs are currently below their defaults, for startup diagnostics. The
 * service logs the *names* of overridden knobs, never their values.
 *
 * @param {Config} config
 */
export function overriddenKnobs(config) {
  /** @type {Record<string, string | number>} */
  const settings = config;
  return Object.entries(KNOBS)
    .filter(
      ([key, knob]) =>
        knob.secret !== true && knob.default !== undefined && settings[key] !== knob.default,
    )
    .map(([key]) => envNameFor(key))
    .sort();
}

/**
 * Resolve the per-operation job deadline.
 * @param {Config} config
 * @param {string} operation
 */
export function deadlineForOperation(config, operation) {
  return operation === "compile" ? config.deadlineCompileMs : config.deadlineAnalyzeMs;
}
