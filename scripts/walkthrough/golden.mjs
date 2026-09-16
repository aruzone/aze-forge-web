/**
 * The recorded identity of the golden artifacts the walkthrough spot-checks.
 *
 * Two fresh renders agreeing proves the deployment renders deterministically;
 * it does not prove the deployment renders the *recorded* document, because a
 * deterministic-but-wrong render would agree with itself. So the walkthrough
 * also compares what it rendered against the identity recorded here, from a
 * green run, and a mismatch is reported as drift rather than passed.
 *
 * A recorded identity is a reviewed artifact: it changes only when someone
 * re-records it deliberately (`--record-golden`), which is the posture the
 * compiler's own golden corpus takes.
 */

import { readFile } from "node:fs/promises";

export const GOLDEN_IDENTITY_SCHEMA = "azeforge.web.golden-identity/v1";

/**
 * @typedef {object} GoldenRender
 * @property {string} source
 * @property {string} format
 * @property {string | null} contentHash
 * @property {string} artifactHash
 * @property {number} byteLength
 */

/**
 * @typedef {object} GoldenIdentity
 * @property {string} schema
 * @property {string} recordedAt
 * @property {string} image image digest the identity was recorded on
 * @property {string} compilerRelease
 * @property {string} capabilityFingerprint
 * @property {Record<string, GoldenRender>} entries keyed by Source name
 */

/**
 * @param {string} path
 * @returns {Promise<GoldenIdentity | null>} `null` when nothing has been recorded yet
 */
export async function readGoldenIdentity(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (/** @type {any} */ (error)?.code === "ENOENT") return null;
    throw error;
  }
  const identity = JSON.parse(text);
  return identity?.schema === GOLDEN_IDENTITY_SCHEMA ? identity : null;
}

/**
 * @param {{ recordedAt: string, image: string | null, findings: any }} input
 * @returns {GoldenIdentity}
 */
export function goldenIdentityFrom({ recordedAt, image, findings }) {
  /** @type {Record<string, GoldenRender>} */
  const entries = {};
  for (const render of findings.determinism) entries[render.source] = render;
  return {
    schema: GOLDEN_IDENTITY_SCHEMA,
    recordedAt,
    image: image ?? "unknown",
    compilerRelease: findings.capabilities?.release ?? "unknown",
    capabilityFingerprint: findings.capabilities?.fingerprint ?? "unknown",
    entries,
  };
}

/**
 * @param {GoldenIdentity | null} identity
 * @param {GoldenRender} render
 * @param {{ path: string }} recorded where the identity lives
 * @returns {string[]} the differences between a fresh render and the recorded identity
 */
export function goldenDifferences(identity, render, recorded) {
  if (identity === null) {
    return [
      `no golden identity has been recorded at ${recorded.path}; ` +
        "a reviewed run records one with --record-golden",
    ];
  }

  // The image digest a rebuild produces is incidental (layers carry their own
  // timestamps); what has to agree is the render, so the digest is recorded as
  // provenance and compared through the artifact hash below rather than on its
  // own.
  /** @type {string[]} */
  const differences = [];
  const expected = identity.entries[render.source];
  if (expected === undefined) {
    differences.push(`the recorded identity has no ${render.format} entry for ${render.source}`);
    return differences;
  }
  if (expected.artifactHash !== render.artifactHash) {
    differences.push(`artifactHash ${render.artifactHash} ≠ recorded ${expected.artifactHash}`);
  }
  if (expected.contentHash !== render.contentHash) {
    differences.push(`contentHash ${render.contentHash} ≠ recorded ${expected.contentHash}`);
  }
  if (expected.byteLength !== render.byteLength) {
    differences.push(`byteLength ${render.byteLength} ≠ recorded ${expected.byteLength}`);
  }
  if (differences.length > 0) {
    // Where the recording came from is the first thing a reader needs: the same
    // Document renders differently on another platform or browser build, and
    // the recording is the deployment that ships.
    differences.push(
      `the recording is from ${identity.image} (${identity.compilerRelease}, ${identity.recordedAt})`,
    );
  }
  return differences;
}
