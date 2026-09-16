/**
 * The Checkpoint B manual-evidence entry.
 *
 * The owner walkthrough is recorded as one entry against the compiler
 * repository's existing manual-evidence schema
 * (`acceptance/manual-evidence/p0-author-001.json`): `participantRole`,
 * `consentedIdentifier`, the fixture's `contentHash`, the exported
 * `artifactHashes`, the commands that produced them, the owner's binary
 * `result`, unresolved notes, the date, the compiler fingerprint and the OS.
 *
 * The automated half is collected whether or not the owner has decided yet, so
 * a pending entry still carries the identity the owner is being asked to
 * approve — and an entry can never be approved without one.
 */

export const MANUAL_EVIDENCE_SCHEMA = "azeforge.acceptance-manual-evidence/v1";

/**
 * The Artifact formats the alpha exports. The record carries one hash per
 * format and the walkthrough exports exactly these, so the list has one home.
 */
export const ARTIFACT_FORMATS = Object.freeze(["html", "svg", "png", "pdf"]);

/** This decision's identifier; the alpha has exactly one owner walkthrough. */
export const WALKTHROUGH_ACCEPTANCE_ID = "ALPHA-WALKTHROUGH-001";

/**
 * The field contract of the manual-evidence schema, restated so a produced
 * record can be checked here rather than only by its consumer.
 */
export const REQUIRED_RECORD_FIELDS = Object.freeze([
  "participantRole",
  "consentedIdentifier",
  "fixtureContentHash",
  "fixtureArtifactHashes",
  "commands",
  "result",
  "unresolvedNotes",
  "date",
  "compilerFingerprint",
  "os",
]);

export const OWNER_APPROVED = "approved";
export const OWNER_NOT_APPROVED = "not-approved";

/**
 * @typedef {object} AutomatedEvidence
 * @property {string} date
 * @property {string} os
 * @property {string} compilerRelease
 * @property {string} compilerFingerprint
 * @property {{ name: string, contentHash: string | null }} fixture
 * @property {Record<string, string>} fixtureArtifactHashes
 * @property {string[]} commands
 */

/**
 * @param {AutomatedEvidence} automated
 * @param {{ result: string, consentedIdentifier: string, notes?: string[] } | null} decision
 * @param {{ note: string, unresolvedNotes?: string[] }} context
 */
export function buildEntry(automated, decision, context) {
  return {
    schema: MANUAL_EVIDENCE_SCHEMA,
    acceptanceId: WALKTHROUGH_ACCEPTANCE_ID,
    status: decision === null ? "pending-owner-approval" : "recorded",
    note: context.note,
    required: [...REQUIRED_RECORD_FIELDS],
    automated,
    record: decision === null ? null : buildRecord(automated, decision, context),
  };
}

/**
 * @param {AutomatedEvidence} automated
 * @param {{ result: string, consentedIdentifier: string, notes?: string[] }} decision
 * @param {{ unresolvedNotes?: string[] }} context
 */
function buildRecord(automated, decision, context) {
  return {
    participantRole: "owner",
    consentedIdentifier: decision.consentedIdentifier,
    fixtureContentHash: automated.fixture.contentHash,
    fixtureArtifactHashes: automated.fixtureArtifactHashes,
    commands: automated.commands,
    result: decision.result,
    unresolvedNotes: [...(context.unresolvedNotes ?? []), ...(decision.notes ?? [])],
    date: automated.date,
    compilerFingerprint: automated.compilerFingerprint,
    os: automated.os,
  };
}

/**
 * The record is complete only when every required field is present and the
 * automated half it claims actually exists.
 *
 * @param {any} entry
 * @returns {string[]} the contract violations, empty when the entry holds
 */
export function entryViolations(entry) {
  /** @type {string[]} */
  const violations = [];
  if (entry?.schema !== MANUAL_EVIDENCE_SCHEMA) {
    violations.push(`schema must be ${MANUAL_EVIDENCE_SCHEMA}`);
  }
  if (entry?.record === null || entry?.record === undefined) return violations;
  for (const field of REQUIRED_RECORD_FIELDS) {
    const value = entry.record[field];
    if (value === undefined || value === null || value === "") violations.push(`record.${field} is missing`);
  }
  if (entry.record.result !== OWNER_APPROVED && entry.record.result !== OWNER_NOT_APPROVED) {
    violations.push(`record.result must be ${OWNER_APPROVED} or ${OWNER_NOT_APPROVED}`);
  }
  if (entry.record.fixtureContentHash === null) {
    violations.push("record.fixtureContentHash is missing");
  }
  const hashes = entry.record.fixtureArtifactHashes;
  for (const format of ARTIFACT_FORMATS) {
    if (typeof hashes?.[format] !== "string" || hashes[format].length === 0) {
      violations.push(`record.fixtureArtifactHashes.${format} is missing`);
    }
  }
  return violations;
}
