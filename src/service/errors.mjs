/**
 * Service error envelope.
 *
 * This is deliberately separate from compiler diagnostics: a malformed
 * request, an incompatible protocol, a missing asset handle, an admission
 * limit or an internal transport failure is never disguised as a Source
 * problem. Messages are human-readable; `code` is the machine identity.
 */

export const SERVICE_ERROR_SCHEMA_ID = "azeforge.web.service-error/v1";
export const SERVICE_ERROR_SCHEMA_VERSION = 1;

/**
 * Stable machine codes. Do not renumber or repurpose: clients match on these.
 * `job-timeout` and `job-failed` are terminal *job* failures reported inside a
 * job result; the rest are HTTP-level envelopes.
 */
export const ERROR_CODES = Object.freeze({
  unauthorized: "unauthorized",
  notFound: "not-found",
  methodNotAllowed: "method-not-allowed",
  requestMalformed: "request-malformed",
  protocolVersionUnsupported: "protocol-version-unsupported",
  operationUnsupported: "operation-unsupported",
  optionUnsupported: "option-unsupported",
  payloadTooLarge: "payload-too-large",
  admissionLimit: "admission-limit",
  rateLimitExceeded: "rate-limit-exceeded",
  serviceUnavailable: "service-unavailable",
  internalError: "internal-error",
  jobTimeout: "job-timeout",
  jobFailed: "job-failed",
  compilerConfigurationError: "compiler-configuration-error",
});

/** @type {Record<string, number>} */
const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.unauthorized]: 401,
  [ERROR_CODES.notFound]: 404,
  [ERROR_CODES.methodNotAllowed]: 405,
  [ERROR_CODES.requestMalformed]: 400,
  [ERROR_CODES.protocolVersionUnsupported]: 400,
  [ERROR_CODES.operationUnsupported]: 400,
  [ERROR_CODES.optionUnsupported]: 400,
  [ERROR_CODES.payloadTooLarge]: 413,
  [ERROR_CODES.admissionLimit]: 429,
  [ERROR_CODES.rateLimitExceeded]: 429,
  [ERROR_CODES.serviceUnavailable]: 503,
  [ERROR_CODES.internalError]: 500,
  [ERROR_CODES.jobTimeout]: 500,
  [ERROR_CODES.jobFailed]: 500,
  [ERROR_CODES.compilerConfigurationError]: 500,
});

export class ServiceError extends Error {
  /** @type {string} */
  code;

  /** @type {Record<string, unknown>} */
  data;

  /** @type {number} */
  status;

  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message human-readable, safe to return to the client
   * @param {string} code
   * @param {string} message
   * @param {{ data?: Record<string, unknown>, status?: number, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ServiceError";
    this.code = code;
    this.data = options.data ?? {};
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500;
  }
}

/** @param {string} code @returns {number} */
export function statusForErrorCode(code) {
  return STATUS_BY_CODE[code] ?? 500;
}

/**
 * Canonical JSON body for an HTTP-level service error.
 * @param {ServiceError} error
 */
export function serviceErrorBody(error) {
  return {
    schema: SERVICE_ERROR_SCHEMA_ID,
    schemaVersion: SERVICE_ERROR_SCHEMA_VERSION,
    error: {
      code: error.code,
      message: error.message,
      data: error.data,
    },
  };
}

/**
 * Structured (not thrown) service failure for a terminal job state.
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 * @returns {import("./types.mjs").ServiceFailureInfo}
 */
export function serviceFailure(code, message, data = {}) {
  return Object.freeze({ code, message, data: Object.freeze({ ...data }) });
}

/** The response-body JSON schema published at `/v1/schemas/...`. */
export const serviceErrorJsonSchema = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SERVICE_ERROR_SCHEMA_ID,
  title: "AzeForge Web service error",
  type: "object",
  additionalProperties: false,
  required: ["schema", "schemaVersion", "error"],
  properties: {
    schema: { const: SERVICE_ERROR_SCHEMA_ID },
    schemaVersion: { const: SERVICE_ERROR_SCHEMA_VERSION },
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "data"],
      properties: {
        code: { type: "string", enum: Object.values(ERROR_CODES) },
        message: { type: "string" },
        data: { type: "object" },
      },
    },
  },
});
