/**
 * Bounded ephemeral Artifact reuse.
 *
 * Two identities are involved, and conflating them would be a trust bug:
 *
 *  - the *authoritative* identity the compiler computes for a completed
 *    compile (contentHash, assetManifestHash, rendererFingerprint, canonical
 *    render options, artifactHash, compiler version), recorded with the entry;
 *  - the *admission fingerprint* this service computes from an immutable job
 *    snapshot (exact Source bytes, bound asset bytes, operation choices,
 *    compiler version) to decide whether a previous entry can answer a new
 *    submission without executing it.
 *
 * The admission fingerprint is only ever computed by the service, from bytes
 * the service holds; a client-supplied key or hash can never select an entry.
 * Because identical inputs plus an identical compiler are deterministic, a
 * fingerprint hit implies an identical authoritative identity — the recorded
 * identity is kept precisely so that claim is inspectable rather than assumed.
 *
 * Cache entries are copies. A job's own Artifact bytes live in its job
 * directory, so evicting a cache entry can never break an advertised download
 * that a client is still entitled to.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class ArtifactCache {
  /** @type {string} */
  #dir;

  /** @type {number} */
  #maxBytes;

  /** @type {number} */
  #maxAgeMs;

  /** @type {() => number} */
  #now;

  /** @type {Map<string, { key: string, path: string, byteLength: number, result: unknown,
   *          identity: unknown, addedAt: number, lastUsedAt: number, expiresAt: number }>} */
  #entries = new Map();

  /** @type {number} */
  #bytesInUse = 0;

  /** @param {{ scratchDir: string, maxBytes: number, maxAgeMs: number, now?: () => number }} options */
  constructor({ scratchDir, maxBytes, maxAgeMs, now = Date.now }) {
    this.#dir = join(scratchDir, "cache");
    this.#maxBytes = maxBytes;
    this.#maxAgeMs = maxAgeMs;
    this.#now = now;
  }

  async init() {
    await mkdir(this.#dir, { recursive: true });
  }

  get bytesInUse() {
    return this.#bytesInUse;
  }

  get size() {
    return this.#entries.size;
  }

  /**
   * @param {string} contextId
   * @param {string} fingerprint
   * @returns {{ path: string, byteLength: number, result: unknown,
   *                     identity: unknown, expiresAt: number } | null}
   */
  lookup(contextId, fingerprint) {
    const entry = this.#entries.get(entryKey(contextId, fingerprint));
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.#now()) return null;
    entry.lastUsedAt = this.#now();
    return entry;
  }

  /**
   * Store a completed, successful Artifact for reuse. Returns the stored entry,
   * or `null` when the cache cannot afford it — admission is bounded and
   * best-effort, never a reason to fail the job that produced the bytes.
   */
  /**
   * @param {{ contextId: string, fingerprint: string, identity: unknown,
   *           bytes: Buffer, result: unknown }} input
   */
  async admit({ contextId, fingerprint, identity, bytes, result }) {
    if (this.#maxBytes <= 0 || bytes.byteLength > this.#maxBytes) return null;
    this.#prune(this.#now());
    this.#evictToFit(bytes.byteLength);

    const key = entryKey(contextId, fingerprint);
    await this.#remove(key);
    if (this.#bytesInUse + bytes.byteLength > this.#maxBytes) return null;

    const path = join(this.#dir, `${key}.bin`);
    await writeFile(path, bytes, { mode: 0o600 });
    const entry = {
      key,
      path,
      byteLength: bytes.byteLength,
      result,
      identity,
      addedAt: this.#now(),
      lastUsedAt: this.#now(),
      expiresAt: this.#now() + this.#maxAgeMs,
    };
    this.#entries.set(key, entry);
    this.#bytesInUse += bytes.byteLength;
    return entry;
  }

  /** @param {{ path: string }} entry */
  read(entry) {
    return readFile(entry.path);
  }

  /** @param {number} [now] */
  async pruneExpired(now = this.#now()) {
    this.#prune(now);
  }

  async clear() {
    for (const key of [...this.#entries.keys()]) await this.#remove(key);
  }

  /** @param {number} now */
  #prune(now) {
    for (const [key, entry] of [...this.#entries]) {
      if (entry.expiresAt > now) continue;
      this.#entries.delete(key);
      this.#bytesInUse -= entry.byteLength;
      void rm(entry.path, { force: true });
    }
  }

  /** @param {number} incomingBytes */
  #evictToFit(incomingBytes) {
    while (this.#bytesInUse + incomingBytes > this.#maxBytes) {
      let victim = null;
      for (const entry of this.#entries.values()) {
        if (victim === null || entry.lastUsedAt < victim.lastUsedAt) victim = entry;
      }
      if (victim === null) return;
      this.#entries.delete(victim.key);
      this.#bytesInUse -= victim.byteLength;
      void rm(victim.path, { force: true });
    }
  }

  /** @param {string} key */
  async #remove(key) {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    this.#entries.delete(key);
    this.#bytesInUse -= entry.byteLength;
    await rm(entry.path, { force: true });
  }
}

/** @param {string} contextId @param {string} fingerprint @returns {string} */
function entryKey(contextId, fingerprint) {
  return `${contextId}.${fingerprint}`;
}
