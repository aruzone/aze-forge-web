/**
 * Deployment-approved access boundary.
 *
 * One deployment-issued static bearer token over the TLS ingress. Its digests
 * are the single authorized client context: asset handles, jobs and cache
 * entries are scoped to it. Clients never choose an owner id, and a token is
 * never echoed back or logged in the clear.
 */

import { timingSafeEqual } from "node:crypto";
import { ERROR_CODES, ServiceError } from "./errors.mjs";
import { sha256Hex } from "./hash.mjs";

export class AccessBoundary {
  #expectedDigest;
  #expectedRaw;

  /** @param {string} accessToken */
  constructor(accessToken) {
    this.#expectedRaw = Buffer.from(accessToken, "utf8");
    this.#expectedDigest = Buffer.from(sha256Hex(accessToken), "hex");
  }

  /**
   * Stable, non-reversible client-context id used for scoping and logs.
   * @param {string} token
   * @returns {string}
   */
  contextIdFor(token) {
    return sha256Hex(token);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @returns {{ tokenIdHash: string }} the authorized client context
   * @throws {ServiceError} 401 for a missing, malformed or wrong token
   */
  authorize(req) {
    const header = req.headers.authorization;
    if (typeof header !== "string") {
      throw new ServiceError(ERROR_CODES.unauthorized, "A bearer token is required.", {
        data: { header: "authorization" },
      });
    }
    const match = /^Bearer[ ]+(\S+)$/i.exec(header);
    if (match === null) {
      throw new ServiceError(ERROR_CODES.unauthorized, "Authorization must use the Bearer scheme.", {
        data: { header: "authorization" },
      });
    }
    const token = match[1];
    if (!this.#matches(token)) {
      throw new ServiceError(ERROR_CODES.unauthorized, "The bearer token is not valid.", {});
    }
    return { tokenIdHash: this.contextIdFor(token) };
  }

  /** @param {string} token @returns {boolean} */
  #matches(token) {
    const candidate = Buffer.from(token, "utf8");
    if (candidate.length !== this.#expectedRaw.length) {
      // Still compare a same-length buffer so length is not a timing oracle.
      timingSafeEqual(this.#expectedDigest, this.#expectedDigest);
      return false;
    }
    const candidateDigest = Buffer.from(sha256Hex(token), "hex");
    return timingSafeEqual(candidateDigest, this.#expectedDigest);
  }
}
