/**
 * `GET /v1/schemas/{schemaId}`.
 *
 * The service publishes the schemas of the *installed* compiler, taken from
 * the compiler's own `contracts` entry point, plus the handful of documents
 * this service owns. Compiler-owned substructures are referenced rather than
 * copied: nothing here restates a Document, diagnostic or capability shape.
 */

import * as compilerContracts from "@aruzone/aze-forge/contracts";
import {
  SERVICE_ERROR_SCHEMA_ID,
  SERVICE_ERROR_SCHEMA_VERSION,
  serviceErrorJsonSchema,
} from "./errors.mjs";
import { WEB_CAPABILITIES_SCHEMA_ID, WEB_CAPABILITIES_SCHEMA_VERSION } from "./capabilities.mjs";
import { PROTOCOL_VERSION, SUPPORTED_OPERATIONS } from "./protocol.mjs";

export const JOB_REQUEST_SCHEMA_ID = "azeforge.web.job-request/v1";
export const JOB_RESULT_SCHEMA_ID = "azeforge.web.job-result/v1";
export const JOB_SUBMISSION_SCHEMA_ID = "azeforge.web.job-submission/v1";
export const ASSET_SCHEMA_ID = "azeforge.web.asset/v1";
export const WEB_SCHEMA_VERSION = 1;

const hashPattern = "^sha256:[0-9a-f]{64}$";

/** @param {{ diagnosticSchemaId: string, documentSchemaIds: readonly number[] }} context */
/**
 * @param {{ diagnosticSchemaId: string, documentSchemaIds: readonly number[] }} context
 * @returns {Map<string, import("./types.mjs").AzeSchemaEntry>}
 */
export function buildSchemaRegistry(context) {
  /** @type {Map<string, import("./types.mjs").AzeSchemaEntry>} */
  const registry = new Map();

  for (const value of Object.values(compilerContracts)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const document = /** @type {Record<string, unknown>} */ (value);
    if (typeof document.$id !== "string" || document.type === undefined) continue;
    registry.set(document.$id, {
      id: document.$id,
      version: versionOfSchemaId(document.$id),
      owner: "compiler",
      document,
    });
  }

  registry.set(WEB_CAPABILITIES_SCHEMA_ID, {
    id: WEB_CAPABILITIES_SCHEMA_ID,
    version: WEB_CAPABILITIES_SCHEMA_VERSION,
    owner: "service",
    document: webCapabilitiesSchema(context),
  });
  registry.set(SERVICE_ERROR_SCHEMA_ID, {
    id: SERVICE_ERROR_SCHEMA_ID,
    version: SERVICE_ERROR_SCHEMA_VERSION,
    owner: "service",
    document: serviceErrorJsonSchema,
  });
  registry.set(JOB_REQUEST_SCHEMA_ID, {
    id: JOB_REQUEST_SCHEMA_ID,
    version: WEB_SCHEMA_VERSION,
    owner: "service",
    document: jobRequestSchema(context),
  });
  registry.set(JOB_RESULT_SCHEMA_ID, {
    id: JOB_RESULT_SCHEMA_ID,
    version: WEB_SCHEMA_VERSION,
    owner: "service",
    document: jobResultSchema(),
  });
  registry.set(JOB_SUBMISSION_SCHEMA_ID, {
    id: JOB_SUBMISSION_SCHEMA_ID,
    version: WEB_SCHEMA_VERSION,
    owner: "service",
    document: jobSubmissionSchema(),
  });
  registry.set(ASSET_SCHEMA_ID, {
    id: ASSET_SCHEMA_ID,
    version: WEB_SCHEMA_VERSION,
    owner: "service",
    document: assetSchema(),
  });

  return registry;
}

/**
 * Schema ids the compiler advertises but does not ship a schema document for.
 * Reported at startup so the gap is visible rather than silently 404ing.
 */
/**
 * @param {readonly string[]} advertisedIds
 * @param {Map<string, import("./types.mjs").AzeSchemaEntry>} registry
 * @returns {string[]}
 */
export function unservableSchemaIds(advertisedIds, registry) {
  return advertisedIds.filter((id) => !registry.has(id)).sort();
}

/** @param {string} id @returns {string | number} */
function versionOfSchemaId(id) {
  const suffix = id.slice(id.lastIndexOf("/") + 1);
  const parsed = Number(suffix.replace(/^v/, ""));
  return Number.isFinite(parsed) && String(parsed) === suffix.replace(/^v/, "") ? parsed : suffix;
}

/** @param {{ documentSchemaIds: readonly number[] }} input */
function jobRequestSchema({ documentSchemaIds }) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: JOB_REQUEST_SCHEMA_ID,
    title: "AzeForge Web job request",
    description:
      "One immutable Source snapshot plus operation choices. Unknown fields are rejected.",
    type: "object",
    // The runtime validator is strict, so the published schema must be too:
    // unknown fields are rejected, not ignored.
    additionalProperties: false,
    required: ["protocolVersion", "requestId", "revision", "operation", "source"],
    properties: {
      protocolVersion: { const: PROTOCOL_VERSION },
      requestId: { type: "string", minLength: 1, maxLength: 200 },
      revision: { type: "string", minLength: 1, maxLength: 200 },
      operation: { enum: SUPPORTED_OPERATIONS },
      source: {
        type: "object",
        required: ["text"],
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          name: {
            type: "string",
            maxLength: 200,
            description: "Diagnostic label only; never a filesystem path.",
          },
        },
      },
      includeDocument: {
        type: "boolean",
        description: `Request public Document data conforming to azeforge document schema ${documentSchemaIds.join(", ")}.`,
      },
      format: { enum: ["html", "svg", "png", "pdf"] },
      theme: { type: "string" },
      assets: {
        type: "array",
        maxItems: 64,
        items: {
          type: "object",
          required: ["path", "handle"],
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Root-relative, case-preserved logical path." },
            handle: { type: "string", description: "Opaque upload handle for this client context." },
          },
        },
      },
    },
    allOf: [
      {
        if: { properties: { operation: { const: "compile" } }, required: ["operation"] },
        then: { required: ["format"] },
        else: { not: { anyOf: [{ required: ["format"] }, { required: ["theme"] }, { required: ["assets"] }] } },
      },
      {
        // Source-only operations carry no Artifact request.
        if: { properties: { operation: { const: "format" } }, required: ["operation"] },
        then: { not: { required: ["includeDocument"] } },
      },
      {
        // `migrate` is named by the boundary but unavailable in the pinned
        // compiler; the service rejects it, so it is not a request the schema
        // admits.
        not: { properties: { operation: { const: "migrate" } }, required: ["operation"] },
      },
    ],
  };
}

function jobResultSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: JOB_RESULT_SCHEMA_ID,
    title: "AzeForge Web job",
    type: "object",
    required: ["jobId", "status", "operation", "requestId", "revision", "submittedAt", "pollAfterMs"],
    properties: {
      jobId: { type: "string" },
      status: {
        enum: ["queued", "running", "cancelling", "completed", "failed", "cancelled"],
      },
      operation: { type: "string" },
      requestId: { type: "string" },
      revision: { type: "string" },
      submittedAt: { type: "string", format: "date-time" },
      startedAt: { type: ["string", "null"], format: "date-time" },
      terminalAt: { type: ["string", "null"], format: "date-time" },
      expiresAt: { type: ["string", "null"], format: "date-time" },
      pollAfterMs: { type: "integer", minimum: 0 },
      cacheHit: { type: "boolean" },
      result: {
        type: ["object", "null"],
        description: "Present once the job is completed.",
        properties: {
          ok: { type: "boolean" },
          compiler: { type: "object" },
          semantic: {
            type: ["object", "null"],
            properties: {
              valid: { type: "boolean" },
              contentHash: { type: ["string", "null"], pattern: hashPattern },
              document: {
                type: "object",
                description:
                  "Public Document data. Fragments and renderer-generated geometry never appear here.",
              },
            },
          },
          diagnostics: { type: "array", description: "Compiler diagnostic records, unchanged." },
          proposal: {
            type: ["object", "null"],
            properties: {
              kind: { enum: ["formatted-source"] },
              source: { type: "string" },
              revision: { type: "string" },
            },
          },
          artifact: {
            type: ["object", "null"],
            properties: {
              format: { enum: ["html", "svg", "png", "pdf"] },
              mimeType: { type: "string" },
              byteLength: { type: "integer" },
              artifactHash: { type: "string", pattern: hashPattern },
              downloadUrl: { type: "string" },
              expiresAt: { type: "string", format: "date-time" },
              metadata: { type: "object" },
            },
          },
        },
      },
      failure: {
        type: ["object", "null"],
        description: "Present once the job is failed. A service failure, never a Source diagnostic.",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          data: { type: "object" },
        },
      },
    },
  };
}

function jobSubmissionSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: JOB_SUBMISSION_SCHEMA_ID,
    title: "AzeForge Web job submission acceptance",
    type: "object",
    required: ["jobId", "status", "statusUrl", "pollAfterMs"],
    properties: {
      jobId: { type: "string" },
      status: { enum: ["queued", "running", "completed"] },
      statusUrl: { type: "string" },
      pollAfterMs: { type: "integer", minimum: 0 },
      expiresAt: { type: ["string", "null"], format: "date-time" },
    },
  };
}

function assetSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: ASSET_SCHEMA_ID,
    title: "AzeForge Web asset handle",
    type: "object",
    required: ["assetId", "byteLength", "expiresAt"],
    properties: {
      assetId: { type: "string" },
      byteLength: { type: "integer" },
      mediaType: {
        type: ["string", "null"],
        description: "Declared upload Content-Type. The compiler owns media validation.",
      },
      expiresAt: { type: "string", format: "date-time" },
    },
  };
}

/**
 * @param {{ diagnosticSchemaId: string, documentSchemaIds: readonly number[] }} input
 */
function webCapabilitiesSchema({ diagnosticSchemaId, documentSchemaIds }) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: WEB_CAPABILITIES_SCHEMA_ID,
    title: "AzeForge Web capabilities",
    type: "object",
    required: ["schema", "schemaVersion", "protocol", "compiler", "compatibility", "service"],
    properties: {
      schema: { const: WEB_CAPABILITIES_SCHEMA_ID },
      schemaVersion: { const: WEB_CAPABILITIES_SCHEMA_VERSION },
      protocol: {
        type: "object",
        properties: { version: { const: PROTOCOL_VERSION }, path: { type: "string" } },
      },
      compiler: {
        type: "object",
        description: "The installed compiler's capabilities document, embedded verbatim.",
        properties: {
          schema: { const: "azeforge.capabilities/v1" },
          tool: {
            type: "object",
            properties: { name: { const: "azeforge" }, version: { type: "string" } },
          },
        },
      },
      compatibility: {
        type: "object",
        properties: {
          protocolVersions: { type: "array", items: { const: PROTOCOL_VERSION } },
          compilerRelease: { type: "string" },
          capabilityFingerprint: {
            type: "string",
            pattern: hashPattern,
            description:
              "Digest of the unprobed compiler registry document; compare across cutovers.",
          },
          sourceLanguages: { type: "array", items: { type: "integer" } },
          documentSchemas: {
            type: "array",
            items: { enum: documentSchemaIds },
          },
          schemas: { type: "array", items: { type: "object" } },
        },
      },
      service: {
        type: "object",
        required: ["operations", "limits"],
        properties: {
          operations: { type: "array", items: { enum: SUPPORTED_OPERATIONS } },
          unavailableOperations: { type: "object" },
          policy: {
            type: "object",
            properties: {
              rawMath: { const: "unavailable" },
              remoteAssets: { const: "denied" },
            },
          },
          limits: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "unit", "scope", "value"],
              properties: {
                id: { type: "string" },
                unit: { type: "string" },
                scope: { type: "string" },
                value: { type: "integer" },
              },
            },
          },
          deadlines: { type: "object" },
          retention: { type: "object" },
          polling: { type: "object" },
        },
      },
    },
    $comment: `Compiler diagnostics in job results carry schema ${diagnosticSchemaId}.`,
  };
}
