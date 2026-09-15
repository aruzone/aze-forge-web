/**
 * Compiler facts the HTTP layer needs without compiling anything.
 *
 * Building the capabilities document constructs the immutable registry; it
 * launches no engine, touches no network and probes nothing the compiler's
 * documented local-only probe does not already cover. The service process
 * never renders: every job executes in its own child process.
 */

import { buildCapabilities, serializeCapabilities } from "@aruzone/aze-forge";
import { createVersionReport, publicSchemaVersions } from "@aruzone/aze-forge/contracts";
import { sha256Hex } from "./hash.mjs";

/**
 * @returns {Promise<{
 *   capabilities: Awaited<ReturnType<typeof buildCapabilities>>,
 *   capabilityFingerprint: string,
 *   themes: ReadonlySet<string>,
 *   formats: ReadonlySet<string>,
 *   tool: { name: string, version: string },
 *   versionReport: ReturnType<typeof createVersionReport>,
 *   schemaIds: readonly string[],
 * }>}
 */
export async function collectCompilerFacts() {
  // Availability probes report on the host; the fingerprint must not, so it is
  // taken over the unprobed registry document and stays comparable across
  // hosts running the same pinned release.
  const registryCapabilities = await buildCapabilities({ probe: false });
  const capabilities = await buildCapabilities({ probe: true });
  const capabilityFingerprint = `sha256:${sha256Hex(serializeCapabilities(registryCapabilities))}`;

  return Object.freeze({
    capabilities,
    capabilityFingerprint,
    themes: new Set(capabilities.themes.map((theme) => theme.id)),
    formats: new Set(capabilities.formats),
    tool: capabilities.tool,
    versionReport: createVersionReport(),
    schemaIds: publicSchemaVersions().map((schema) => schema.id),
  });
}
