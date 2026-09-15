/**
 * Shared domain typedefs.
 *
 * This file has no runtime behaviour: it declares the shapes that cross module
 * boundaries in the service, so `tsc` can check the lifecycle code. Reference
 * them as `import("./types.mjs").Name`.
 */

/**
 * One immutable job snapshot, validated from an HTTP request.
 *
 * @typedef {object} JobSpec
 * @property {number} protocolVersion
 * @property {"analyze" | "compile" | "format"} operation
 * @property {string} requestId
 * @property {string} revision
 * @property {{ text: string, name?: string }} source
 * @property {boolean} includeDocument
 * @property {"html" | "svg" | "png" | "pdf"} [format]
 * @property {string | null} [theme]
 * @property {readonly { path: string, handle: string }[]} [assets]
 */

/**
 * One frozen logical-path/upload-handle binding, materialized into the job.
 * @typedef {{ path: string, record: AzeAssetRecord }} MaterializedBinding
 */

/** @typedef {{ path: string, hash: string, byteLength: number }} AssetDigest */

/** @typedef {{ assetId: string, path: string, contextId: string, byteLength: number,
 *               mediaType: string | null, uploadedAt: number, expiresAt: number }} AzeAssetRecord */

/** @typedef {"queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled"} JobState */

/** @typedef {{ code: string, message: string, data: Record<string, unknown> }} ServiceFailureInfo */

/**
 * The compiler-side result of one operation, as the worker reports it.
 *
 * @typedef {object} WorkerResult
 * @property {string} [operation]
 * @property {boolean} [ok]
 * @property {{ valid: boolean, contentHash: string | null, document?: object } | null} [semantic]
 * @property {object[]} [diagnostics]
 * @property {{ kind: string, source: string } | null} [proposal]
 * @property {{ format: string, mimeType: string, metadata: ArtifactMetadataLike, bytes?: Uint8Array } | null} [artifact]
 * @property {{ name: string, message: string }} [workerError]
 */

/**
 * @typedef {object} ArtifactMetadataLike
 * @property {string} [format]
 * @property {string} [mimeType]
 * @property {number} [byteLength]
 * @property {string} [artifactHash]
 * @property {string} [contentHash]
 * @property {string} [assetManifestHash]
 * @property {string} [rendererFingerprint]
 * @property {{ id: string, version: string }} [theme]
 * @property {object} [cssDimensions]
 */

/**
 * A job record held by the manager.
 *
 * @typedef {object} JobRecord
 * @property {string} jobId
 * @property {string} contextId
 * @property {string} operation
 * @property {string} requestId
 * @property {string} revision
 * @property {string | null} sourceName
 * @property {string} sourceText
 * @property {boolean} includeDocument
 * @property {boolean} hasAssets
 * @property {string | null} format
 * @property {string | null} theme
 * @property {string | null} fingerprint
 * @property {JobState} state
 * @property {boolean | null} ok
 * @property {AzeJobResult | null} result
 * @property {ServiceFailureInfo | null} failure
 * @property {boolean} cacheHit
 * @property {boolean} timedOut
 * @property {string} jobDir
 * @property {string | null} artifactPath
 * @property {number} artifactByteLength
 * @property {number} submittedAt
 * @property {number | null} startedAt
 * @property {number | null} terminalAt
 * @property {number | null} expiresAt
 * @property {boolean} settled
 */

/**
 * The service's job result envelope.
 *
 * @typedef {object} AzeJobResult
 * @property {boolean} ok
 * @property {object} compiler
 * @property {{ valid: boolean, contentHash: string | null, document?: object } | null} semantic
 * @property {object[]} diagnostics
 * @property {{ kind: string, source: string, revision: string }} [proposal]
 * @property {AzeArtifactReference} [artifact]
 */

/**
 * @typedef {object} AzeArtifactReference
 * @property {string} format
 * @property {string} mimeType
 * @property {number} byteLength
 * @property {string} artifactHash
 * @property {ArtifactMetadataLike} metadata
 */

/**
 * Compiler facts collected once at startup.
 *
 * @typedef {object} AzeCompilerFacts
 * @property {object} capabilities
 * @property {string} capabilityFingerprint
 * @property {ReadonlySet<string>} themes
 * @property {ReadonlySet<string>} formats
 * @property {{ name: string, version: string }} tool
 * @property {object} versionReport
 * @property {readonly string[]} schemaIds
 */

/**
 * A published schema document.
 * @typedef {{ id: string, version: number | string, owner: "compiler" | "service", document: unknown }} AzeSchemaEntry
 */

/** @typedef {{ write: (chunk: string) => unknown }} AzeLogSink */

/**
 * @typedef {object} AzeLogger
 * @property {(event: string, fields?: Record<string, unknown>) => void} info
 * @property {(event: string, fields?: Record<string, unknown>) => void} warn
 * @property {(event: string, fields?: Record<string, unknown>) => void} error
 * @property {(event: string, fields?: Record<string, unknown>) => void} debug
 */

export {};
