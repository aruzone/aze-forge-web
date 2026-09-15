/**
 * HTTP surface.
 *
 * `/v1` is the protocol major. Everything informative lives behind the bearer
 * token; only the two detail-free health endpoints and the inert frontend are
 * reachable without it. Response bodies are always JSON envelopes or Artifact
 * bytes, never server paths, stack traces or credentials.
 */

import { createServer } from "node:http";
import { SlidingWindowLimiter } from "./rate-limit.mjs";
import { buildWebCapabilities } from "./capabilities.mjs";
import { ERROR_CODES, ServiceError, serviceErrorBody, statusForErrorCode } from "./errors.mjs";
import { validateJobRequest } from "./protocol.mjs";
import { publicJob } from "./jobs.mjs";
import { FRONTEND_CONTENT_SECURITY_POLICY } from "./static.mjs";

const BASE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
});

/** An Artifact is data, never an application: it loads no scripts and reaches nowhere. */
const ARTIFACT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "script-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "sandbox",
].join("; ");

/**
 * @param {{
 *   config: import("./config.mjs").Config,
 *   log: import("./types.mjs").AzeLogger,
 *   accessBoundary: import("./auth.mjs").AccessBoundary,
 *   compilerFacts: import("./types.mjs").AzeCompilerFacts,
 *   schemaRegistry: Map<string, import("./types.mjs").AzeSchemaEntry>,
 *   assets: import("./assets.mjs").AssetStore,
 *   jobs: import("./jobs.mjs").JobManager,
 *   webAssets: Map<string, { body: Buffer, contentType: string }>,
 *   now?: () => number,
 * }} deps
 */
export function createService(deps) {
  const { config, log, accessBoundary, compilerFacts, schemaRegistry, assets, jobs, webAssets } = deps;
  const now = deps.now ?? Date.now;
  /** @type {Awaited<ReturnType<import("./compiler-facts.mjs").collectCompilerFacts>>} */
  const facts = /** @type {Awaited<ReturnType<import("./compiler-facts.mjs").collectCompilerFacts>>} */ (
    compilerFacts
  );
  const limiter = new SlidingWindowLimiter({ windowMs: config.rateLimitWindowMs });

  const capabilities = buildWebCapabilities({ config, compilerFacts: facts });
  const serializedCapabilities = Buffer.from(`${JSON.stringify(capabilities)}\n`, "utf8");
  const themes = facts.themes;
  const formats = facts.formats;

  /** @type {{ ok: boolean, checks: { name: string, ok: boolean, detail?: string }[] }} */
  let readiness = { ok: false, checks: [] };

  /**
   * Readiness is the startup verdict *and* live capacity. Docker's HEALTHCHECK
   * depends on this being honest: a service that cannot stage another byte is
   * not ready, however healthy its startup checks were.
   *
   * @returns {{ ok: boolean, reason: "startup" | "scratch" | null }}
   */
  function evaluateReadiness() {
    if (!readiness.ok) return { ok: false, reason: "startup" };
    if (jobs.scratchBytesInUse >= config.scratchMaxBytes) return { ok: false, reason: "scratch" };
    return { ok: true, reason: null };
  }

  const server = createServer((req, res) => {
    const startedAt = now();
    handle(req, res)
      .catch((error) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (error instanceof ServiceError) {
          sendError(res, error);
          return;
        }
        log.error("request-handler-failed", {
          reason: error instanceof Error ? error.name : "unknown",
        });
        sendError(
          res,
          new ServiceError(ERROR_CODES.internalError, "The request could not be completed.", {}),
        );
      })
      .finally(() => {
        log.info("request", {
          method: req.method,
          route: routePattern(req.url),
          status: res.statusCode,
          durationMs: now() - startedAt,
        });
      });
  });

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @returns {Promise<void>}
   */
  async function handle(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://service.invalid").pathname;
    } catch {
      throw new ServiceError(ERROR_CODES.requestMalformed, "The request URL is not valid.", {});
    }
    const method = req.method ?? "GET";

    if (!pathname.startsWith("/v1/")) {
      await handleUnversioned(req, res, method, pathname);
      return;
    }

    const { tokenIdHash } = accessBoundary.authorize(req);
    if (!readiness.ok) {
      throw new ServiceError(
        ERROR_CODES.serviceUnavailable,
        "The service is not ready; startup validation has not passed.",
        { data: { checks: readiness.checks.filter((check) => !check.ok).map((check) => check.name) } },
      );
    }

    await handleVersioned(req, res, method, pathname, tokenIdHash);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} method
   * @param {string} pathname
   * @returns {Promise<void>}
   */
  async function handleUnversioned(req, res, method, pathname) {
    if (pathname === "/healthz") {
      if (method !== "GET") throw methodNotAllowed("GET");
      sendText(res, 200, "ok");
      return;
    }
    if (pathname === "/readyz") {
      if (method !== "GET") throw methodNotAllowed("GET");
      const live = evaluateReadiness();
      sendText(res, live.ok ? 200 : 503, live.ok ? "ready" : "not ready");
      return;
    }
    if (webAssets.has(pathname)) {
      if (method !== "GET") throw methodNotAllowed("GET");
      const asset = /** @type {{ body: Buffer, contentType: string }} */ (webAssets.get(pathname));
      res.writeHead(200, {
        ...BASE_HEADERS,
        "Content-Type": asset.contentType,
        "Content-Length": asset.body.byteLength,
        "Content-Security-Policy": FRONTEND_CONTENT_SECURITY_POLICY,
      });
      res.end(asset.body);
      return;
    }
    throw new ServiceError(ERROR_CODES.notFound, "That resource does not exist.", {});
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} method
   * @param {string} pathname
   * @param {string} tokenIdHash
   * @returns {Promise<void>}
   */
  async function handleVersioned(req, res, method, pathname, tokenIdHash) {
    const segments = pathname.slice("/v1/".length).split("/");

    if (pathname === "/v1/capabilities") {
      if (method !== "GET") throw methodNotAllowed("GET");
      sendJson(res, 200, serializedCapabilities);
      return;
    }

    if (segments[0] === "schemas") {
      if (method !== "GET") throw methodNotAllowed("GET");
      const schemaId = decodeSchemaId(pathname);
      const schema = schemaId === null ? undefined : schemaRegistry.get(schemaId);
      if (schema === undefined) {
        throw new ServiceError(ERROR_CODES.notFound, "That schema is not published by the installed compiler.", {});
      }
      sendJson(res, 200, Buffer.from(`${JSON.stringify(schema.document)}\n`, "utf8"));
      return;
    }

    if (segments[0] === "assets") {
      if (segments.length === 1) {
        if (method !== "POST") throw methodNotAllowed("POST");
        await uploadAsset(req, res, tokenIdHash);
        return;
      }
      if (segments.length === 2) {
        if (method !== "DELETE") throw methodNotAllowed("DELETE");
        const removed = await assets.revoke(segments[1], tokenIdHash);
        if (!removed) throw notFound();
        sendJson(res, 204, null);
        return;
      }
      throw notFound();
    }

    if (segments[0] === "jobs") {
      if (segments.length === 1) {
        if (method !== "POST") throw methodNotAllowed("POST");
        await submitJob(req, res, tokenIdHash);
        return;
      }
      const jobId = segments[1];
      if (segments.length === 2) {
        if (method !== "GET") throw methodNotAllowed("GET");
        const job = jobs.get(jobId, tokenIdHash);
        if (job === null) throw notFound();
        sendJson(res, 200, Buffer.from(`${JSON.stringify(publicJob(job, config.pollAfterMs))}\n`, "utf8"));
        return;
      }
      if (segments.length === 3 && segments[2] === "cancel") {
        if (method !== "POST") throw methodNotAllowed("POST");
        const job = await jobs.cancel(jobId, tokenIdHash);
        if (job === null) throw notFound();
        sendJson(res, 200, Buffer.from(`${JSON.stringify(publicJob(job, config.pollAfterMs))}\n`, "utf8"));
        return;
      }
      if (segments.length === 3 && segments[2] === "artifact") {
        if (method !== "GET") throw methodNotAllowed("GET");
        await sendArtifact(res, jobId, tokenIdHash);
        return;
      }
    }

    throw notFound();
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} tokenIdHash
   * @returns {Promise<void>}
   */
  async function uploadAsset(req, res, tokenIdHash) {
    const limit = limiter.take(`asset:${tokenIdHash}`, config.assetUploadsPerMinute, now());
    if (!limit.allowed) throw rateLimited(limit.retryAfterMs, "asset-uploads");
    if (jobs.scratchBytesInUse >= config.scratchMaxBytes) {
      throw new ServiceError(
        ERROR_CODES.serviceUnavailable,
        "Scratch storage is at capacity; retry shortly.",
        { data: { scope: "scratch-bytes" } },
      );
    }

    const body = await readBody(req, config.maxAssetBytes);
    const record = await assets.put(body, {
      mediaType: normaliseMediaType(req.headers["content-type"]),
      contextId: tokenIdHash,
    });
    log.info("asset-uploaded", {
      assetId: record.assetId,
      tokenId: tokenIdHash.slice(0, 12),
      byteLength: record.byteLength,
    });
    sendJson(
      res,
      201,
      Buffer.from(
        `${JSON.stringify({
          assetId: record.assetId,
          byteLength: record.byteLength,
          mediaType: record.mediaType,
          expiresAt: new Date(record.expiresAt).toISOString(),
        })}\n`,
        "utf8",
      ),
    );
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} tokenIdHash
   * @returns {Promise<void>}
   */
  async function submitJob(req, res, tokenIdHash) {
    const limit = limiter.take(`job:${tokenIdHash}`, config.jobSubmissionsPerMinute, now());
    if (!limit.allowed) throw rateLimited(limit.retryAfterMs, "job-submissions");

    const body = await readBody(req, config.maxJobBodyBytes);
    let parsed;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      throw new ServiceError(ERROR_CODES.requestMalformed, "The request body must be a JSON object.", {});
    }

    const spec = validateJobRequest(parsed, {
      maxSourceBytes: config.maxSourceBytes,
      maxAssetsPerJob: config.maxAssetsPerJob,
      themes,
      formats,
    });

    const job = await jobs.submit({ contextId: tokenIdHash, spec });
    res.writeHead(202, {
      ...BASE_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      Location: `/v1/jobs/${job.jobId}`,
    });
    res.end(
      `${JSON.stringify({
        jobId: job.jobId,
        status: job.state,
        statusUrl: `/v1/jobs/${job.jobId}`,
        pollAfterMs: config.pollAfterMs,
        expiresAt: job.expiresAt === null ? null : new Date(job.expiresAt).toISOString(),
      })}\n`,
    );
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {string} jobId
   * @param {string} tokenIdHash
   * @returns {Promise<void>}
   */
  async function sendArtifact(res, jobId, tokenIdHash) {
    const artifact = await jobs.readArtifact(jobId, tokenIdHash);
    if (artifact === null) throw notFound();
    const metadata = /** @type {{ mimeType?: string, format?: string }} */ (artifact.metadata);
    const mimeType = metadata.mimeType ?? "application/octet-stream";
    const format = metadata.format ?? "bin";
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": mimeType,
      "Content-Length": artifact.bytes.byteLength,
      "Content-Disposition": `attachment; filename="artifact.${format}"`,
      "Content-Security-Policy": ARTIFACT_CONTENT_SECURITY_POLICY,
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.end(artifact.bytes);
  }

  return {
    server,
    capabilities,
    limiter,
    /** @param {{ ok: boolean, checks: { name: string, ok: boolean, detail?: string }[] }} result */
    setReadiness(result) {
      readiness = result;
    },
    getReadiness() {
      return readiness;
    },
    evaluateReadiness,
  };
}

/** Strictly bounded body read: an oversized request is refused, never buffered. */
/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(
        new ServiceError(
          ERROR_CODES.payloadTooLarge,
          `The request body exceeds this deployment's ${maxBytes} byte limit.`,
          { data: { limit: maxBytes, scope: "request-body" } },
        ),
      );
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on("data", (/** @type {Buffer} */ chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(
          new ServiceError(
            ERROR_CODES.payloadTooLarge,
            `The request body exceeds this deployment's ${maxBytes} byte limit.`,
            { data: { limit: maxBytes, scope: "request-body" } },
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => {
      reject(new ServiceError(ERROR_CODES.requestMalformed, "The request body could not be read.", {}));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * @param {string | string[] | undefined} header
 * @returns {string | null}
 */
function normaliseMediaType(header) {
  if (typeof header !== "string") return null;
  const value = header.split(";")[0].trim();
  return value.length === 0 ? null : value;
}

/** @param {string} pathname @returns {string | null} */
function decodeSchemaId(pathname) {
  const remainder = pathname.slice("/v1/schemas/".length);
  if (remainder.length === 0) return null;
  try {
    return decodeURIComponent(remainder);
  } catch {
    return null;
  }
}

/** @param {string | undefined} url @returns {string} */
function routePattern(url) {
  const path = (url ?? "/").split("?")[0];
  if (path.startsWith("/v1/schemas/")) return "/v1/schemas/:schemaId";
  if (path.startsWith("/v1/assets/")) return "/v1/assets/:assetId";
  if (path.startsWith("/v1/jobs/")) {
    const rest = path.slice("/v1/jobs/".length).split("/");
    if (rest.length === 1) return "/v1/jobs/:jobId";
    if (rest[1] === "cancel") return "/v1/jobs/:jobId/cancel";
    if (rest[1] === "artifact") return "/v1/jobs/:jobId/artifact";
  }
  return path;
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {Buffer | null} body
 */
function sendJson(res, status, body) {
  if (status === 204 || body === null) {
    res.writeHead(204, { ...BASE_HEADERS });
    res.end();
    return;
  }
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
  });
  res.end(body);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} text
 */
function sendText(res, status, text) {
  const body = Buffer.from(`${text}\n`, "utf8");
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.byteLength,
  });
  res.end(body);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {ServiceError} error
 */
function sendError(res, error) {
  const body = Buffer.from(`${JSON.stringify(serviceErrorBody(error))}\n`, "utf8");
  /** @type {Record<string, string | number>} */
  const headers = {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
  };
  if (error.status === 429) {
    const retryAfterMs = typeof error.data.retryAfterMs === "number" ? error.data.retryAfterMs : 1000;
    headers["Retry-After"] = String(Math.ceil(retryAfterMs / 1000));
  }
  res.writeHead(statusForErrorCode(error.code), headers);
  res.end(body);
}

function notFound() {
  return new ServiceError(ERROR_CODES.notFound, "That resource does not exist.", {});
}

/** @param {string} allow */
function methodNotAllowed(allow) {
  return new ServiceError(ERROR_CODES.methodNotAllowed, `This resource supports ${allow}.`, { data: { allow } });
}

/** @param {number} retryAfterMs @param {string} scope */
function rateLimited(retryAfterMs, scope) {
  return new ServiceError(
    ERROR_CODES.rateLimitExceeded,
    "Too many requests; retry shortly.",
    { data: { retryAfterMs, scope } },
  );
}
