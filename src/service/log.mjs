/**
 * Metadata-only structured logging.
 *
 * Logs go to stdout as one JSON object per line. Source text, asset bytes,
 * Artifact bytes and diagnostic message excerpts never appear here: the
 * deployment's privacy claim depends on that. Message *codes* are fine;
 * message text is not.
 */

const LEVELS = new Set(["debug", "info", "warn", "error"]);

/**
 * @param {{ stream?: import("./types.mjs").AzeLogSink, level?: string, now?: () => number }} [options]
 * @returns {import("./types.mjs").AzeLogger}
 */
export function createLogger({ stream = process.stdout, level = "info", now = Date.now } = {}) {
  const threshold = LEVELS.has(level) ? level : "info";
  const order = ["debug", "info", "warn", "error"];

  /**
   * @param {string} entryLevel
   * @param {string} event
   * @param {Record<string, unknown>} fields
   */
  function emit(entryLevel, event, fields) {
    if (order.indexOf(entryLevel) < order.indexOf(threshold)) return;
    const line = JSON.stringify({
      ts: new Date(now()).toISOString(),
      level: entryLevel,
      event,
      ...fields,
    });
    stream.write(`${line}\n`);
  }

  return {
    info: (event, fields) => emit("info", event, fields ?? {}),
    warn: (event, fields) => emit("warn", event, fields ?? {}),
    error: (event, fields) => emit("error", event, fields ?? {}),
    debug: (event, fields) => emit("debug", event, fields ?? {}),
  };
}
