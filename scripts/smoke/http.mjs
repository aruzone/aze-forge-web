/**
 * The HTTP client the deployment acceptance suite speaks.
 *
 * Every call has a hard timeout: an acceptance run that hangs is evidence of a
 * problem, not a reason to wait forever. Bodies are read as bytes, because the
 * Artifact checks are byte checks.
 */

import { createHash } from "node:crypto";

/**
 * @typedef {object} SmokeResponse
 * @property {number} status
 * @property {Headers} headers
 * @property {Buffer} bytes
 * @property {string} text
 * @property {any} json parsed body, or `null` when the body is not JSON
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @param {string} base
 * @param {{ method?: string, path: string, token?: string | null, body?: string | Uint8Array | object,
 *           contentType?: string, timeoutMs?: number }} input
 * @returns {Promise<SmokeResponse>}
 */
export async function request(base, input) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (input.token !== null && input.token !== undefined) {
    headers.Authorization = `Bearer ${input.token}`;
  }
  if (input.contentType !== undefined) headers["Content-Type"] = input.contentType;

  /** @type {BodyInit | undefined} */
  let body;
  if (input.body === undefined) body = undefined;
  else if (typeof input.body === "string") body = input.body;
  // lib.dom's BufferSource is not generic over ArrayBufferLike, which is what
  // Node's own Uint8Array/Buffer are; the value is a valid body either way.
  else if (input.body instanceof Uint8Array) body = /** @type {BodyInit} */ (/** @type {unknown} */ (input.body));
  else body = JSON.stringify(input.body);

  const response = await fetch(`${base}${input.path}`, {
    method: input.method ?? "GET",
    headers,
    body,
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  let json = null;
  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, bytes, text, json };
}

/** @param {Uint8Array} bytes */
export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** `code` of an error envelope, or `null` when the body was not one. */
/** @param {SmokeResponse} response */
export function errorCode(response) {
  const code = response.json?.error?.code;
  return typeof code === "string" ? code : null;
}

/** `scope` of an error envelope's data, or `null`. */
/** @param {SmokeResponse} response */
export function errorScope(response) {
  const scope = response.json?.error?.data?.scope;
  return typeof scope === "string" ? scope : null;
}

/** A compact rendering of a response body for evidence lines. */
/** @param {SmokeResponse} response @param {number} [limit] */
export function describe(response, limit = 160) {
  const text = response.text.replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Poll until the predicate accepts the body, or the deadline passes.
 *
 * @param {() => Promise<any>} read
 * @param {(value: any) => boolean} done
 * @param {{ timeoutMs: number, intervalMs?: number, onPoll?: () => void }} options
 */
export async function poll(read, done, { timeoutMs, intervalMs = 250, onPoll }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (onPoll !== undefined) onPoll();
    if (done(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`the condition was not satisfied within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
