/**
 * HTTP protocol version 1 request contract.
 *
 * Requests are strictly validated: unknown fields, unsupported option
 * combinations and unadvertised Theme/format choices are errors, never
 * silently ignored. The service accepts Source, never client-supplied
 * Documents, and no arbitrary compiler-option bag crosses this boundary.
 */

import { ERROR_CODES, ServiceError } from "./errors.mjs";

export const PROTOCOL_VERSION = 1;

/** Operations this deployment can actually execute against the pinned compiler. */
export const SUPPORTED_OPERATIONS = Object.freeze(["analyze", "compile", "format"]);

/**
 * Operations named by the library/service boundary that the pinned compiler
 * release cannot yet execute. They are rejected explicitly with a remedy
 * rather than approximated.
 */
/** @type {Record<string, string>} */
export const UNAVAILABLE_OPERATIONS = Object.freeze({
  migrate:
    "The pinned compiler release exposes no migrate operation. " +
    "Source migration lands with the compiler's explicit migration API.",
});

/** Options named by the boundary that the pinned compiler cannot honour yet. */
/** @type {Record<string, string>} */
export const UNAVAILABLE_OPTIONS = Object.freeze({
  includeComposition:
    "The pinned compiler release returns no shared composition results. " +
    "Request includeDocument for public Document data.",
});

const COMMON_KEYS = ["protocolVersion", "requestId", "revision", "operation", "source"];
/** @type {Record<string, readonly string[]>} */
const KEYS_BY_OPERATION = Object.freeze({
  analyze: ["includeDocument"],
  compile: ["format", "theme", "assets", "includeDocument"],
  format: [],
  migrate: ["targetAzemarkVersion"],
});

const ALL_UNSUPPORTED_KEYS = new Set(Object.keys(UNAVAILABLE_OPTIONS));
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_SOURCE_NAME_LENGTH = 200;
const MAX_ASSET_PATH_LENGTH = 1024;

/**
 * @param {unknown} body parsed JSON request body
 * @param {{
 *   maxSourceBytes: number,
 *   maxAssetsPerJob: number,
 *   themes: ReadonlySet<string>,
 *   formats: ReadonlySet<string>,
 * }} context
 * @returns {Readonly<import("./types.mjs").JobSpec>}
 */
export function validateJobRequest(body, context) {
  const request = asObject(body, "request");

  const protocolVersion = request.protocolVersion;
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new ServiceError(
      ERROR_CODES.protocolVersionUnsupported,
      `This service speaks protocol version ${PROTOCOL_VERSION}; ` +
        `received ${JSON.stringify(protocolVersion ?? null)}.`,
      { data: { protocolVersion: PROTOCOL_VERSION } },
    );
  }

  const operation = requireOperation(request.operation);
  const requestId = requireIdentifier(request.requestId, "requestId");
  const revision = requireIdentifier(request.revision, "revision");
  const source = requireSource(request.source, context.maxSourceBytes);

  const allowed = new Set([...COMMON_KEYS, ...(KEYS_BY_OPERATION[operation] ?? [])]);
  for (const key of Object.keys(request)) {
    if (allowed.has(key)) continue;
    if (ALL_UNSUPPORTED_KEYS.has(key)) {
      throw new ServiceError(ERROR_CODES.optionUnsupported, UNAVAILABLE_OPTIONS[key], {
        data: { field: key },
      });
    }
    throw new ServiceError(
      ERROR_CODES.optionUnsupported,
      `${key} is not accepted for operation ${operation}.`,
      { data: { field: key, operation } },
    );
  }

  const includeDocument = request.includeDocument === undefined
    ? false
    : requireBoolean(request.includeDocument, "includeDocument");

  /** @type {import("./types.mjs").JobSpec} */
  const spec = { protocolVersion, operation, requestId, revision, source, includeDocument };

  if (operation === "compile") {
    spec.format = requireFormat(request.format, context.formats);
    spec.theme = request.theme === undefined ? null : requireTheme(request.theme, context.themes);
    spec.assets = validateAssetBindings(request.assets, context.maxAssetsPerJob);
  }

  return Object.freeze(spec);
}

/** @param {unknown} value @returns {"analyze" | "compile" | "format"} */
export function requireOperation(value) {
  if (typeof value !== "string") {
    throw new ServiceError(ERROR_CODES.requestMalformed, "operation must be a string.", {
      data: { field: "operation" },
    });
  }
  const remedy = UNAVAILABLE_OPERATIONS[value];
  const supported = /** @type {readonly string[]} */ (SUPPORTED_OPERATIONS);
  if (remedy !== undefined) {
    throw new ServiceError(ERROR_CODES.operationUnsupported, remedy, {
      data: { field: "operation", operation: value, supported: SUPPORTED_OPERATIONS },
    });
  }
  if (!supported.includes(value)) {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${value} is not a known operation.`, {
      data: { field: "operation", supported },
    });
  }
  return /** @type {import("./types.mjs").JobSpec["operation"]} */ (value);
}

/**
 * A Source name is a diagnostic label, never a filesystem path: path
 * separators are rejected rather than sanitized.
 */
/**
 * @param {unknown} value
 * @param {number} maxSourceBytes
 * @returns {Readonly<{ text: string, name?: string }>}
 */
export function requireSource(value, maxSourceBytes) {
  const source = asObject(value, "source");
  const allowed = new Set(["text", "name"]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) {
      throw new ServiceError(ERROR_CODES.optionUnsupported, `source.${key} is not accepted.`, {
        data: { field: `source.${key}` },
      });
    }
  }
  const text = source.text;
  if (typeof text !== "string") {
    throw new ServiceError(ERROR_CODES.requestMalformed, "source.text must be a string.", {
      data: { field: "source.text" },
    });
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxSourceBytes) {
    throw new ServiceError(
      ERROR_CODES.payloadTooLarge,
      `source.text is ${byteLength} bytes; this deployment accepts at most ${maxSourceBytes} bytes per job.`,
      { data: { byteLength, limit: maxSourceBytes, unit: "bytes", scope: "source-bytes-per-job" } },
    );
  }

  let name;
  if (source.name !== undefined) {
    if (typeof source.name !== "string" || source.name.length === 0) {
      throw new ServiceError(ERROR_CODES.requestMalformed, "source.name must be a non-empty string.", {
        data: { field: "source.name" },
      });
    }
    if (source.name.length > MAX_SOURCE_NAME_LENGTH) {
      throw new ServiceError(ERROR_CODES.requestMalformed, "source.name is too long.", {
        data: { field: "source.name", limit: MAX_SOURCE_NAME_LENGTH },
      });
    }
    if (/[\\/\0]/.test(source.name) || hasControlCharacters(source.name)) {
      throw new ServiceError(
        ERROR_CODES.optionUnsupported,
        "source.name is a diagnostic label, not a filesystem path.",
        { data: { field: "source.name" } },
      );
    }
    name = source.name;
  }

  return Object.freeze(name === undefined ? { text } : { text, name });
}

/**
 * Bind root-relative, case-preserved logical paths to opaque upload handles.
 * Bindings are frozen at admission; replacing bytes requires a new handle.
 */
/**
 * @param {unknown} value
 * @param {number} maxAssetsPerJob
 * @returns {readonly { path: string, handle: string }[]}
 */
export function validateAssetBindings(value, maxAssetsPerJob) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new ServiceError(ERROR_CODES.requestMalformed, "assets must be an array.", {
      data: { field: "assets" },
    });
  }
  if (value.length > maxAssetsPerJob) {
    throw new ServiceError(
      ERROR_CODES.payloadTooLarge,
      `At most ${maxAssetsPerJob} assets may be bound to one job; received ${value.length}.`,
      { data: { limit: maxAssetsPerJob, scope: "assets-per-job" } },
    );
  }

  const seen = new Set();
  const bindings = value.map((entry, index) => {
    const binding = asObject(entry, `assets[${index}]`);
    for (const key of Object.keys(binding)) {
      if (key !== "path" && key !== "handle") {
        throw new ServiceError(
          ERROR_CODES.optionUnsupported,
          `assets[${index}].${key} is not accepted.`,
          { data: { field: `assets[${index}].${key}` } },
        );
      }
    }
    const path = requireLogicalPath(binding.path, `assets[${index}].path`);
    if (seen.has(path)) {
      throw new ServiceError(ERROR_CODES.requestMalformed, `assets binds ${path} twice.`, {
        data: { field: `assets[${index}].path` },
      });
    }
    seen.add(path);
    if (typeof binding.handle !== "string" || binding.handle.length === 0) {
      throw new ServiceError(
        ERROR_CODES.requestMalformed,
        `assets[${index}].handle must be a non-empty string.`,
        { data: { field: `assets[${index}].handle` } },
      );
    }
    return Object.freeze({ path, handle: binding.handle });
  });

  return Object.freeze(bindings);
}

/** Root-relative, contained, case-preserved logical path. */
/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
export function requireLogicalPath(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${field} must be a non-empty string.`, {
      data: { field },
    });
  }
  if (value.length > MAX_ASSET_PATH_LENGTH) {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${field} is too long.`, {
      data: { field, limit: MAX_ASSET_PATH_LENGTH },
    });
  }
  if (value.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || hasControlCharacters(value)) {
    throw new ServiceError(
      ERROR_CODES.optionUnsupported,
      `${field} must be a root-relative logical path, not an absolute path or remote URL.`,
      { data: { field } },
    );
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ServiceError(
      ERROR_CODES.optionUnsupported,
      `${field} must not contain empty, "." or ".." path segments.`,
      { data: { field } },
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {ReadonlySet<string>} formats
 * @returns {"html" | "svg" | "png" | "pdf"}
 */
function requireFormat(value, formats) {
  if (typeof value !== "string") {
    throw new ServiceError(ERROR_CODES.requestMalformed, "format is required for a compile job.", {
      data: { field: "format", supported: [...formats] },
    });
  }
  if (!formats.has(value)) {
    throw new ServiceError(ERROR_CODES.optionUnsupported, `${value} is not an advertised format.`, {
      data: { field: "format", supported: [...formats] },
    });
  }
  // The advertised set is the compiler's own format list; it is exactly the
  // Artifact formats this service can request.
  return /** @type {"html" | "svg" | "png" | "pdf"} */ (value);
}

/**
 * @param {unknown} value
 * @param {ReadonlySet<string>} themes
 * @returns {string}
 */
function requireTheme(value, themes) {
  if (typeof value !== "string") {
    throw new ServiceError(ERROR_CODES.requestMalformed, "theme must be a string.", {
      data: { field: "theme", supported: [...themes] },
    });
  }
  if (!themes.has(value)) {
    throw new ServiceError(ERROR_CODES.optionUnsupported, `${value} is not an advertised Theme.`, {
      data: { field: "theme", supported: [...themes] },
    });
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireIdentifier(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${field} must be a non-empty string.`, {
      data: { field },
    });
  }
  if (value.length > MAX_IDENTIFIER_LENGTH || hasControlCharacters(value)) {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${field} is not a valid correlation value.`, {
      data: { field, limit: MAX_IDENTIFIER_LENGTH },
    });
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 */
function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${field} must be a boolean.`, {
      data: { field },
    });
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function asObject(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServiceError(ERROR_CODES.requestMalformed, `${field} must be a JSON object.`, {
      data: { field },
    });
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {string} text @returns {boolean} */
function hasControlCharacters(text) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
