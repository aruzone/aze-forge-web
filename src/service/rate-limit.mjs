/**
 * Per-client-context sliding-window rate limits.
 *
 * Counters live in process memory only and die with the container; the alpha
 * has a single instance and no durable storage.
 */

export class SlidingWindowLimiter {
  /** @type {number} */
  #windowMs;

  /** @type {Map<string, number[]>} */
  #hits = new Map();

  /** @param {{ windowMs: number }} options */
  constructor({ windowMs }) {
    this.#windowMs = windowMs;
  }

  /**
   * Record one request for `key` and report whether it is inside `limit`.
   *
   * @param {string} key
   * @param {number} limit maximum requests per window
   * @param {number} now epoch milliseconds
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
   */
  take(key, limit, now) {
    const cutoff = now - this.#windowMs;
    const timestamps = (this.#hits.get(key) ?? []).filter((at) => at > cutoff);
    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      this.#hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, oldest + this.#windowMs - now),
      };
    }
    timestamps.push(now);
    this.#hits.set(key, timestamps);
    return { allowed: true, remaining: limit - timestamps.length, retryAfterMs: 0 };
  }

  /**
   * Drop windows that have fully aged out.
   * @param {number} now
   */
  prune(now) {
    const cutoff = now - this.#windowMs;
    for (const [key, timestamps] of this.#hits) {
      const live = timestamps.filter((at) => at > cutoff);
      if (live.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, live);
    }
  }
}
