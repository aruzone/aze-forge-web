/**
 * The walkthrough's decision logic: family coverage, the manual-evidence entry,
 * and the alpha pass/fail rule.
 *
 * These are the parts a bug would silently turn into a false approval — an
 * uncovered family that reports as covered, an entry that records Approve with
 * no identity behind it, or a cutover that approves runs on different images —
 * so they are tested without a deployment.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { APPROVED, NOT_APPROVED, evaluateCatalog, evaluateCutover } from "../../scripts/cutover/decision.mjs";
import { COVERAGE_UNITS, REQUIRED_KINDS, collectKinds, coverageReport, uncoveredUnits } from "../../scripts/walkthrough/families.mjs";
import {
  GOLDEN_IDENTITY_SCHEMA,
  goldenDifferences,
  goldenIdentityFrom,
  readGoldenIdentity,
} from "../../scripts/walkthrough/golden.mjs";
import {
  MANUAL_EVIDENCE_SCHEMA,
  OWNER_APPROVED,
  OWNER_NOT_APPROVED,
  REQUIRED_RECORD_FIELDS,
  WALKTHROUGH_ACCEPTANCE_ID,
  buildEntry,
  entryViolations,
} from "../../scripts/walkthrough/record.mjs";

/** @param {string[]} kinds */
function documentOf(kinds) {
  return { azemarkVersion: 2, schemaVersion: 2, blocks: kinds.map((kind) => ({ kind })) };
}

/** A Document that spans every unit, each kind appearing once. */
const fullDocument = documentOf([...REQUIRED_KINDS]);

const AUTOMATED = {
  date: "2026-09-16T00:00:00.000Z",
  os: "linux x64 · node v24.0.0 · host canonical",
  compilerRelease: "0.3.1",
  compilerFingerprint: `sha256:${"1".repeat(64)}`,
  fixture: { name: "walkthrough.aze.md", contentHash: `sha256:${"2".repeat(64)}` },
  fixtureArtifactHashes: {
    html: `sha256:${"3".repeat(64)}`,
    svg: `sha256:${"4".repeat(64)}`,
    png: `sha256:${"5".repeat(64)}`,
    pdf: `sha256:${"6".repeat(64)}`,
  },
  commands: ["npm run walkthrough -- --image aze-forge-web:abc1234"],
};

test("the catalog's ten families plus composition are the coverage units", () => {
  assert.equal(COVERAGE_UNITS.length, 11);
  assert.deepEqual(
    COVERAGE_UNITS.map((unit) => unit.id),
    [
      "mathematics",
      "plotting",
      "geometry",
      "diagrams",
      "models",
      "circuit",
      "timing",
      "chemistry",
      "engineering",
      "content",
      "composition",
    ],
  );
  for (const unit of COVERAGE_UNITS) {
    assert.ok(unit.kinds.length > 0, `${unit.id} names no Block kind`);
    assert.ok(unit.areas.length > 0, `${unit.id} names no catalog area`);
  }
});

test("a Source spanning every family is covered, and a gap names the family it misses", () => {
  assert.deepEqual(uncoveredUnits(fullDocument), []);

  const withoutTiming = documentOf(REQUIRED_KINDS.filter((kind) => kind !== "timing"));
  assert.deepEqual(uncoveredUnits(withoutTiming), ["timing"]);

  const bare = documentOf(["heading", "paragraph", "equation"]);
  const uncovered = uncoveredUnits(bare);
  assert.ok(uncovered.includes("plotting"), uncovered.join(", "));
  assert.ok(uncovered.includes("composition"), uncovered.join(", "));
  assert.ok(!uncovered.includes("mathematics"), "one kind of a family is enough to cover it");
});

test("coverage is measured on the semantic Document, including nested content", () => {
  const nested = {
    azemarkVersion: 2,
    schemaVersion: 2,
    blocks: [
      { kind: "figure", children: [{ kind: "equation" }] },
      { kind: "example", steps: [{ body: [{ kind: "derivation" }] }] },
    ],
  };
  const kinds = collectKinds(nested);
  assert.ok(kinds.has("equation") && kinds.has("derivation"), [...kinds].join(", "));
  const coverage = coverageReport(nested);
  assert.equal(coverage.find((unit) => unit.id === "mathematics")?.covered, true);
  assert.equal(coverage.find((unit) => unit.id === "chemistry")?.covered, false);
});

test("a pending entry carries the automated half but no owner decision", () => {
  const entry = buildEntry(AUTOMATED, null, { note: "walkthrough" });
  assert.equal(entry.schema, MANUAL_EVIDENCE_SCHEMA);
  assert.equal(entry.acceptanceId, WALKTHROUGH_ACCEPTANCE_ID);
  assert.equal(entry.status, "pending-owner-approval");
  assert.equal(entry.record, null);
  assert.deepEqual(entry.required, [...REQUIRED_RECORD_FIELDS]);
  assert.equal(entry.automated.fixture.contentHash, AUTOMATED.fixture.contentHash);
  assert.deepEqual(entryViolations(entry), [], "a pending entry is not yet a violation");
});

test("an approved entry satisfies the manual-evidence schema's required fields", () => {
  const entry = buildEntry(
    AUTOMATED,
    { result: OWNER_APPROVED, consentedIdentifier: "owner@example.com" },
    { note: "walkthrough", unresolvedNotes: [] },
  );
  assert.equal(entry.status, "recorded");
  assert.deepEqual(entryViolations(entry), []);
  for (const field of REQUIRED_RECORD_FIELDS) {
    assert.ok(entry.record[field] !== undefined, `record.${field} is missing`);
  }
  assert.equal(entry.record.participantRole, "owner");
  assert.equal(entry.record.result, OWNER_APPROVED);
  assert.equal(entry.record.fixtureContentHash, AUTOMATED.fixture.contentHash);
  assert.deepEqual(entry.record.fixtureArtifactHashes, AUTOMATED.fixtureArtifactHashes);
});

test("the entry contract rejects an approval with no identity behind it", () => {
  const entry = buildEntry(
    { ...AUTOMATED, fixtureArtifactHashes: { html: AUTOMATED.fixtureArtifactHashes.html } },
    { result: OWNER_APPROVED, consentedIdentifier: "owner@example.com" },
    { note: "walkthrough" },
  );
  const violations = entryViolations(entry);
  assert.ok(violations.some((violation) => violation.includes("svg")), violations.join(", "));
  assert.ok(violations.some((violation) => violation.includes("pdf")), violations.join(", "));

  const nameless = buildEntry(AUTOMATED, { result: OWNER_APPROVED, consentedIdentifier: "" }, { note: "walkthrough" });
  assert.ok(
    entryViolations(nameless).some((violation) => violation.includes("consentedIdentifier")),
    entryViolations(nameless).join(", "),
  );
});

/**
 * A catalog that publishes an entry for every unit, so the clause's success
 * path can be tested without depending on which entries the pinned release
 * happens to publish today.
 */
const COMPLETE_CATALOG = new Map();
for (const unit of COVERAGE_UNITS) {
  for (const area of unit.areas) COMPLETE_CATALOG.set(`X-${area}`, area);
}
/** The injected catalog: every unit publishes an automated entry. */
const COMPLETE_CATALOG_RULE = {
  areaOf: (/** @type {string} */ id) => COMPLETE_CATALOG.get(id) ?? null,
  publishingAutomated: () => true,
  publishing: () => true,
};

const CATALOG_REPORT = {
  schema: "azeforge.acceptance-report/v1",
  failures: 0,
  results: [...COMPLETE_CATALOG.keys()].map((id) => ({ id, name: id, pass: true, detail: "" })),
};

/** @param {any} report @param {{ acceptedDrift?: string[] }} [extra] */
function catalogInput(report, extra = {}) {
  return { report, sha256: "sha256:x", path: "p.json", ...extra };
}

test("the catalog clause needs a green report, not an absent one", () => {
  assert.equal(evaluateCatalog(null).ok, false);

  const missing = evaluateCatalog(catalogInput({ schema: "something-else" }), COMPLETE_CATALOG_RULE);
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /azeforge\.acceptance-report\/v1/);

  const empty = evaluateCatalog(catalogInput({ schema: "azeforge.acceptance-report/v1", failures: 0, results: [] }), COMPLETE_CATALOG_RULE);
  assert.equal(empty.ok, false);
  assert.ok(empty.failures.some((failure) => failure.includes("lists no results")), empty.failures.join("; "));

  const green = evaluateCatalog(catalogInput(CATALOG_REPORT), COMPLETE_CATALOG_RULE);
  assert.equal(green.ok, true, green.failures.join("; "));
  assert.equal(green.areas.length, COMPLETE_CATALOG.size);

  const failing = evaluateCatalog(
    catalogInput({
      ...CATALOG_REPORT,
      failures: 1,
      results: [...CATALOG_REPORT.results, { id: "X-timing", name: "timing", pass: false, detail: "" }],
    }),
    COMPLETE_CATALOG_RULE,
  );
  assert.equal(failing.ok, false);
  assert.deepEqual(failing.failures, ["X-timing: timing"]);
});

test("a family the pinned catalog evidences manually is not demanded as an automated entry", () => {
  const manualOnly = {
    areaOf: (/** @type {string} */ id) => (id === "X-chemistry" ? "chemistry" : COMPLETE_CATALOG.get(id) ?? null),
    publishingAutomated: (/** @type {string} */ area) => area !== "chemistry",
    publishing: () => true,
  };
  // The report carries no green automated entry for chemistry, because the
  // pinned catalog publishes none: the family is evidenced another way.
  const withoutChemistry = CATALOG_REPORT.results.filter((result) => result.id !== "X-chemistry");
  const clause = evaluateCatalog(catalogInput({ ...CATALOG_REPORT, results: withoutChemistry }), manualOnly);
  assert.equal(clause.ok, true, clause.failures.join("; "));
  assert.deepEqual(clause.manual, ["chemistry"]);
  assert.match(clause.detail, /chemistry evidenced manually/);
});

test("a family with no catalog entry at all is a gap in the catalog, not coverage", () => {
  const unpublishing = {
    areaOf: (/** @type {string} */ id) => COMPLETE_CATALOG.get(id) ?? null,
    publishingAutomated: (/** @type {string} */ area) => area !== "timing",
    publishing: (/** @type {string} */ area) => area !== "timing",
  };
  const withoutTiming = CATALOG_REPORT.results.filter((result) => result.id !== "X-timing");
  const clause = evaluateCatalog(catalogInput({ ...CATALOG_REPORT, results: withoutTiming }), unpublishing);
  assert.equal(clause.ok, false);
  assert.ok(
    clause.failures.some((failure) => failure.includes("publishes no entry for timing")),
    clause.failures.join("; "),
  );
});

test("a green report still has to cover the ten families and composition", () => {
  const withoutTiming = CATALOG_REPORT.results.filter((result) => !result.id.startsWith("X-timing"));
  const clause = evaluateCatalog(catalogInput({ ...CATALOG_REPORT, results: withoutTiming }), COMPLETE_CATALOG_RULE);
  assert.equal(clause.ok, false);
  assert.ok(clause.failures.some((failure) => failure.includes("covers timing")), clause.failures.join("; "));
});

test("a report naming entries the pinned release does not publish is not this build's evidence", () => {
  // The default mapping is the pinned release's own catalog: an entry it does
  // not publish means the report describes another build.
  const clause = evaluateCatalog(catalogInput(CATALOG_REPORT));
  assert.equal(clause.ok, false);
  assert.ok(
    clause.failures.some((failure) => failure.includes("does not publish")),
    clause.failures.join("; "),
  );
});

test("a report that declares more failures than it lists is not evidence", () => {
  const clause = evaluateCatalog(catalogInput({ ...CATALOG_REPORT, failures: 2 }), COMPLETE_CATALOG_RULE);
  assert.equal(clause.ok, false);
  assert.ok(clause.failures.some((failure) => failure.includes("declares 2 failures")), clause.failures.join("; "));
});

test("only the approved azemark:2 re-baseline may be accepted", () => {
  const drifted = {
    ...CATALOG_REPORT,
    failures: 1,
    results: [{ id: "X-equation", name: "azemark:2 baseline", pass: false, detail: "drift" }],
  };
  assert.equal(evaluateCatalog(catalogInput(drifted), COMPLETE_CATALOG_RULE).ok, false);

  const unforgiven = evaluateCatalog(catalogInput(drifted, { acceptedDrift: ["X-equation"] }), COMPLETE_CATALOG_RULE);
  assert.equal(unforgiven.ok, false);
  assert.ok(
    unforgiven.failures.some((failure) => failure.includes("is not the approved azemark:2 re-baseline")),
    unforgiven.failures.join("; "),
  );

  const approved = {
    ...CATALOG_REPORT,
    failures: 1,
    results: [...CATALOG_REPORT.results, { id: "azemark:2", name: "corpus re-baseline", pass: false, detail: "re-baselined" }],
  };
  assert.equal(evaluateCatalog(catalogInput(approved), COMPLETE_CATALOG_RULE).ok, false);
  assert.equal(evaluateCatalog(catalogInput(approved, { acceptedDrift: ["azemark:2"] }), COMPLETE_CATALOG_RULE).ok, true);
});

/** The entry a recorded owner Approve produces. */
function approvedEntry() {
  return buildEntry(
    AUTOMATED,
    { result: OWNER_APPROVED, consentedIdentifier: "owner@example.com" },
    { note: "walkthrough" },
  );
}

/** @param {Partial<import("../../scripts/cutover/decision.mjs").CutoverInput>} overrides */
function cutoverInput(overrides = {}) {
  const image = { reference: "aze-forge-web:abc1234", id: "sha256:image" };
  return {
    image,
    catalog: evaluateCatalog(catalogInput(CATALOG_REPORT), COMPLETE_CATALOG_RULE),
    smoke: { path: "acceptance/cutover/smoke/x.json", passed: 9, failed: 0, imageId: "sha256:image" },
    walkthrough: {
      path: "acceptance/cutover/walkthrough/x.json",
      passed: 5,
      failed: 0,
      imageId: "sha256:image",
      entry: approvedEntry(),
    },
    ...overrides,
  };
}

test("the alpha passes only when all three clauses hold on one image", () => {
  const approved = evaluateCutover(cutoverInput());
  assert.equal(approved.decision, APPROVED, approved.reasons.join("; "));
  assert.ok(Object.values(approved.clauses).every((clause) => clause.ok));
});

test("a missing owner decision, a failed suite or a different image withholds approval", () => {
  const withoutOwner = evaluateCutover(
    cutoverInput({
      walkthrough: {
        path: "p",
        passed: 5,
        failed: 0,
        imageId: "sha256:image",
        entry: buildEntry(AUTOMATED, null, { note: "walkthrough" }),
      },
    }),
  );
  assert.equal(withoutOwner.decision, NOT_APPROVED);
  assert.ok(withoutOwner.reasons.some((reason) => reason.includes("Approve is not recorded")));

  const failedSmoke = evaluateCutover(
    cutoverInput({ smoke: { path: "p", passed: 8, failed: 1, imageId: "sha256:image" } }),
  );
  assert.equal(failedSmoke.decision, NOT_APPROVED);
  assert.ok(failedSmoke.reasons.some((reason) => reason.includes("1 of 9 smoke checks failed")));

  const restaged = evaluateCutover(
    cutoverInput({ smoke: { path: "p", passed: 9, failed: 0, imageId: "sha256:other" } }),
  );
  assert.equal(restaged.decision, NOT_APPROVED);
  assert.ok(restaged.reasons.some((reason) => reason.includes("same image digest")));

  // A run that names no image at all cannot show the staged image is the one
  // that was cut over, however green it is.
  const unlisted = evaluateCutover(
    cutoverInput({ walkthrough: { path: "p", passed: 5, failed: 0, imageId: null, entry: approvedEntry() } }),
  );
  assert.equal(unlisted.decision, NOT_APPROVED);
  assert.ok(unlisted.reasons.some((reason) => reason.includes("same image digest")));
});

test("an owner rejection is recorded, and is not an approval", () => {
  const entry = buildEntry(
    AUTOMATED,
    { result: OWNER_NOT_APPROVED, consentedIdentifier: "owner@example.com" },
    { note: "walkthrough", unresolvedNotes: ["theme contrast"] },
  );
  assert.equal(entry.record.result, OWNER_NOT_APPROVED);
  assert.deepEqual(entry.record.unresolvedNotes, ["theme contrast"]);
  const evaluation = evaluateCutover(
    cutoverInput({
      walkthrough: { path: "p", passed: 5, failed: 0, imageId: "sha256:image", entry },
    }),
  );
  assert.equal(evaluation.decision, NOT_APPROVED);
});


test("the recorded golden identity is built from a run and compared exactly", () => {
  const findings = {
    capabilities: { release: "0.3.1", fingerprint: `sha256:${"f".repeat(64)}` },
    determinism: [
      {
        source: "golden-report.aze.md",
        format: "html",
        contentHash: `sha256:${"7".repeat(64)}`,
        artifactHash: `sha256:${"8".repeat(64)}`,
        byteLength: 805_333,
      },
    ],
  };
  const identity = goldenIdentityFrom({ recordedAt: "2026-09-16T00:00:00.000Z", image: "sha256:image", findings });
  assert.equal(identity.schema, GOLDEN_IDENTITY_SCHEMA);
  assert.deepEqual(identity.entries["golden-report.aze.md"], findings.determinism[0]);

  const recorded = { path: "acceptance/golden-identity.json" };
  assert.deepEqual(goldenDifferences(identity, findings.determinism[0], recorded), []);

  const drifted = { ...findings.determinism[0], artifactHash: `sha256:${"9".repeat(64)}` };
  const differences = goldenDifferences(identity, drifted, recorded);
  assert.ok(differences.some((difference) => difference.includes("artifactHash")), differences.join("; "));

  const unsampled = goldenDifferences(identity, { ...findings.determinism[0], source: "walkthrough.aze.md" }, recorded);
  assert.ok(unsampled.some((difference) => difference.includes("no html entry")), unsampled.join("; "));

  const unrecorded = goldenDifferences(null, findings.determinism[0], recorded);
  assert.ok(unrecorded[0].includes("no golden identity has been recorded"), unrecorded.join("; "));
});

test("a golden identity that has not been recorded reads as absent, not as an error", async () => {
  assert.equal(await readGoldenIdentity("does-not-exist.json"), null);
});
