/**
 * The command-line vocabulary the acceptance scripts share.
 *
 * The smoke suite, the owner walkthrough and the cutover orchestrator are three
 * entry points over one evidence model, so they agree on how a flag is parsed,
 * how a run's lines are recorded, and what a failed expectation is.
 */

import { createHash } from "node:crypto";

/**
 * `--flag value` pairs, plus the named valueless flags; `--help`/`-h`
 * short-circuits. A `--no-<flag>` spelling is `false`.
 *
 * @param {string[]} argv
 * @param {{ booleans?: readonly string[] }} [options]
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv, options = {}) {
  const booleans = new Set(options.booleans ?? []);
  /** @type {Record<string, string | boolean>} */
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument.startsWith("--no-")) {
      parsed[argument.slice(5)] = false;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected argument ${argument}`);
    const name = argument.slice(2);
    if (booleans.has(name)) {
      parsed[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} needs a value`);
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}

/**
 * @param {Record<string, string | boolean>} options
 * @param {string} name
 * @param {number} fallback
 */
export function numberOption(options, name, fallback) {
  const raw = options[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

/**
 * @param {Record<string, string | boolean>} options
 * @param {string} name
 * @returns {string | null}
 */
export function stringOption(options, name) {
  const raw = options[name];
  return typeof raw === "string" ? raw : null;
}

/**
 * Every `--name` value, in order, for flags that may repeat.
 *
 * @param {string[]} argv
 * @param {string} name
 * @returns {string[]}
 */
export function repeatedOption(argv, name) {
  /** @type {string[]} */
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}` && argv[index + 1] !== undefined) values.push(argv[index + 1]);
  }
  return values;
}

/** A failed expectation. The runner reports the message as the step's verdict. */
export class CheckFailure extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "CheckFailure";
  }
}

/** @param {unknown} condition @param {string} message */
export function expect(condition, message) {
  if (condition !== true) throw new CheckFailure(message);
}

/**
 * A run's recorded output: lines are both printed as they happen and kept for
 * the evidence file.
 */
export function createRecorder() {
  /** @type {string[]} */
  const lines = [];
  return {
    lines,
    /** @param {string} line */
    emit(line) {
      lines.push(line);
      process.stdout.write(`${line}\n`);
    },
    /** @param {string} text */
    heading(text) {
      lines.push(text);
      process.stdout.write(`${text}\n`);
    },
  };
}

/**
 * @param {string[]} command
 * @param {string} secret
 * @returns {string}
 */
export function redact(command, secret) {
  return command.map((part) => part.split(secret).join("<redacted>")).join(" ");
}

/** @param {string} token */
export function tokenDigest(token) {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12);
}

/** A filesystem- and URL-safe stamp for evidence file names. */
/** @param {Date} date */
export function evidenceStamp(date) {
  return date.toISOString().replace(/[:.]/g, "-").replace(/-Z$/, "Z");
}
