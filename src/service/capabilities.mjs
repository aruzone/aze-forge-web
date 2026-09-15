/**
 * `GET /v1/capabilities`.
 *
 * The compiler's own capabilities document is embedded verbatim: capability
 * coverage, Plugin/Renderer versions, engines, Theme ids, formats and compiler
 * limits stay owned by the registry rather than being restated here. This
 * module adds only the deployment-specific facts the compiler cannot know —
 * effective policy, service limits, retention, and what this service can
 * execute.
 */

import { PROTOCOL_VERSION, SUPPORTED_OPERATIONS, UNAVAILABLE_OPERATIONS } from "./protocol.mjs";
import { publishedLimits } from "./limits.mjs";

export const WEB_CAPABILITIES_SCHEMA_ID = "azeforge.web.capabilities/v1";
export const WEB_CAPABILITIES_SCHEMA_VERSION = 1;

/**
 * @param {{ config: ReturnType<typeof import("./config.mjs").loadConfig>,
 *           compilerFacts: Awaited<ReturnType<import("./compiler-facts.mjs").collectCompilerFacts>> }} input
 */
export function buildWebCapabilities({ config, compilerFacts }) {
  const { capabilities, tool, versionReport, capabilityFingerprint } = compilerFacts;

  return {
    schema: WEB_CAPABILITIES_SCHEMA_ID,
    schemaVersion: WEB_CAPABILITIES_SCHEMA_VERSION,
    protocol: {
      version: PROTOCOL_VERSION,
      path: `/v${PROTOCOL_VERSION}`,
    },
    compiler: capabilities,
    compatibility: {
      protocolVersions: [PROTOCOL_VERSION],
      compilerRelease: tool.version,
      capabilityFingerprint,
      sourceLanguages: versionReport.source.azemarkVersions,
      documentSchemas: versionReport.document.schemaVersions,
      schemas: versionReport.schemas,
    },
    service: {
      operations: SUPPORTED_OPERATIONS,
      unavailableOperations: UNAVAILABLE_OPERATIONS,
      policy: {
        rawMath: "unavailable",
        rawMathNote:
          "Raw LaTeX stays trusted-local to the CLI. The web request boundary cannot enable it and no hosted isolation boundary is approved for the alpha.",
        rawHtml: "denied",
        remoteAssets: "denied",
        assetTransfer: "upload-handles",
        clientSuppliedHashes: "not-authoritative",
        jobExecution: "isolated-process-group",
        cache: "ephemeral-per-client-context",
        persistence: "none",
        accounts: false,
      },
      limits: publishedLimits(config),
      deadlines: {
        analyzeMs: config.deadlineAnalyzeMs,
        formatMs: config.deadlineAnalyzeMs,
        compileMs: config.deadlineCompileMs,
        terminationGraceMs: config.terminationGraceMs,
      },
      retention: {
        assetHandleMs: config.assetTtlMs,
        terminalResultMs: config.resultTtlMs,
        cacheMaxAgeMs: config.cacheMaxAgeMs,
      },
      polling: {
        pollAfterMs: config.pollAfterMs,
      },
    },
  };
}
