/**
 * Uploaded binary assets.
 *
 * Uploads land under opaque temporary handles scoped to the authorized client
 * context. Handles are not public download resources, the service enforces
 * bytes rather than meaning, and client-supplied hashes are never treated as
 * authoritative. An accepted job pins the bytes it bound through execution, so
 * revoking or expiring a handle only affects future submissions.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ERROR_CODES, ServiceError } from "./errors.mjs";

export class AssetStore {
  #dir;
  #maxAssetBytes;
  #maxTotalAssetBytes;
  #ttlMs;
  #now;
  #records = new Map();
  #bytesInUse = 0;

  /**
   * @param {{ scratchDir: string, maxAssetBytes: number, maxTotalAssetBytes: number,
   *           assetTtlMs: number, now?: () => number }} options
   */
  constructor({ scratchDir, maxAssetBytes, maxTotalAssetBytes, assetTtlMs, now = Date.now }) {
    this.#dir = join(scratchDir, "assets");
    this.#maxAssetBytes = maxAssetBytes;
    this.#maxTotalAssetBytes = maxTotalAssetBytes;
    this.#ttlMs = assetTtlMs;
    this.#now = now;
  }

  async init() {
    await mkdir(this.#dir, { recursive: true });
  }

  get bytesInUse() {
    return this.#bytesInUse;
  }

  get count() {
    return this.#records.size;
  }

  /**
   * @param {Buffer} bytes
   * @param {{ mediaType: string | null, contextId: string }} options
   */
  async put(bytes, { mediaType, contextId }) {
    if (bytes.byteLength === 0) {
      throw new ServiceError(ERROR_CODES.requestMalformed, "An asset upload must not be empty.", {
        data: { field: "body" },
      });
    }
    if (bytes.byteLength > this.#maxAssetBytes) {
      throw new ServiceError(
        ERROR_CODES.payloadTooLarge,
        `Asset is ${bytes.byteLength} bytes; this deployment accepts at most ${this.#maxAssetBytes} bytes per asset.`,
        { data: { byteLength: bytes.byteLength, limit: this.#maxAssetBytes, scope: "asset-bytes" } },
      );
    }
    if (this.#bytesInUse + bytes.byteLength > this.#maxTotalAssetBytes) {
      throw new ServiceError(
        ERROR_CODES.payloadTooLarge,
        `Uploading ${bytes.byteLength} bytes would exceed this deployment's ${this.#maxTotalAssetBytes} byte asset budget.`,
        {
          data: {
            byteLength: bytes.byteLength,
            limit: this.#maxTotalAssetBytes,
            scope: "total-asset-bytes",
          },
        },
      );
    }

    const assetId = randomUUID();
    const path = join(this.#dir, `${assetId}.bin`);
    await writeFile(path, bytes, { mode: 0o600 });
    const record = Object.freeze({
      assetId,
      path,
      contextId,
      byteLength: bytes.byteLength,
      mediaType,
      uploadedAt: this.#now(),
      expiresAt: this.#now() + this.#ttlMs,
    });
    this.#records.set(assetId, record);
    this.#bytesInUse += bytes.byteLength;
    return record;
  }

  /**
   * Unknown, expired and inaccessible handles are indistinguishable to the
   * caller: all three return `null`.
   *
   * @param {string} assetId
   * @param {string} contextId
   */
  lookup(assetId, contextId) {
    const record = this.#records.get(assetId);
    if (record === undefined) return null;
    if (record.contextId !== contextId) return null;
    if (record.expiresAt <= this.#now()) return null;
    return record;
  }

  /** @param {string} assetId @param {string} contextId */
  async revoke(assetId, contextId) {
    const record = this.lookup(assetId, contextId);
    if (record === null) return false;
    this.#records.delete(assetId);
    this.#bytesInUse -= record.byteLength;
    await rm(record.path, { force: true });
    return true;
  }

  /** @param {string} assetId */
  async read(assetId) {
    const record = this.#records.get(assetId);
    if (record === undefined) {
      throw new ServiceError(ERROR_CODES.notFound, "That asset is not available.", {});
    }
    return readFile(record.path);
  }

  /** Drop expired handles and the bytes they hold. */
  async pruneExpired(now = this.#now()) {
    for (const [assetId, record] of [...this.#records]) {
      if (record.expiresAt > now) continue;
      this.#records.delete(assetId);
      this.#bytesInUse -= record.byteLength;
      await rm(record.path, { force: true });
    }
  }
}
