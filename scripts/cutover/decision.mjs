/**
 * The alpha pass/fail rule of `aruzone/aze-forge#53` §8.
 *
 * The alpha passes iff every automated semantic and deterministic-render
 * catalog entry is green on the canonical host with no unpending drift (the one
 * approved azemark:2 re-baseline excepted), the deployability smoke suite
 * passes against a staged container, and the owner records Approve on the
 * walkthrough. Deployable means the staged image is the cutover image, so the
 * evidence runs must name the same image digest.
 *
 * This module is the rule and nothing else: it reads recorded evidence and
 * returns a decision, so the decision can be reviewed without running docker.
 */

import { areaOfEntry, publishesAutomatedEntry, publishesEntry } from "./catalog.mjs";
import { COVERAGE_UNITS } from "../walkthrough/families.mjs";
import { OWNER_APPROVED, entryViolations } from "../walkthrough/record.mjs";

export const APPROVED = "approved";
export const NOT_APPROVED = "not-approved";

/** The compiler repository's acceptance report schema. */
const CATALOG_REPORT_SCHEMA = "azeforge.acceptance-report/v1";

export const DRIFT_REBASELINE = {
  id: "azemark:2",
  reason:
    "The corpus proved azemark:1 while the alpha replaces it with azemark:2; the single reviewed canonical-host re-baseline is pre-approved by aruzone/aze-forge#53 §3.",
};

/**
 * @param {{ report: any, sha256: string, path: string, acceptedDrift?: string[] } | null} input
 * @param {{ areaOf?: (id: string) => string | null, publishingAutomated?: (area: string) => boolean,
 *           publishing?: (area: string) => boolean }} [catalog]
 *   the pinned release's catalog, injectable so the rule can be tested against
 *   a complete one
 * @returns {{ ok: boolean, detail: string, failures: string[], areas: string[], manual: string[], path: string | null, sha256: string | null }}
 */
export function evaluateCatalog(
  input,
  catalog = { areaOf: areaOfEntry, publishingAutomated: publishesAutomatedEntry },
) {
  if (input === null) {
    return {
      ok: false,
      detail: "no automated catalog report was supplied; the semantic and deterministic-render clause is not evidenced",
      failures: [],
      areas: [],
      manual: [],
      path: null,
      sha256: null,
    };
  }

  const { areaOf, publishingAutomated, publishing } = {
    areaOf: areaOfEntry,
    publishingAutomated: publishesAutomatedEntry,
    publishing: publishesEntry,
    ...catalog,
  };
  const { report } = input;
  if (report?.schema !== CATALOG_REPORT_SCHEMA) {
    return {
      ok: false,
      detail: `the catalog report is not ${CATALOG_REPORT_SCHEMA}`,
      failures: [],
      areas: [],
      manual: [],
      path: input.path,
      sha256: input.sha256,
    };
  }

  /** @type {string[]} */
  const failures = [];

  // The one exception the alpha pre-approves is the reviewed azemark:2
  // re-baseline. An operator may not name anything else: a rule that forgives
  // whatever id it is handed forgives anything.
  const accepted = new Set(input.acceptedDrift ?? []);
  for (const id of accepted) {
    if (id !== DRIFT_REBASELINE.id) failures.push(`accepted drift "${id}" is not the approved ${DRIFT_REBASELINE.id} re-baseline`);
  }

  const results = report.results ?? [];
  if (results.length === 0) failures.push("the report lists no results");

  const reportedFailures = results.filter((/** @type {any} */ result) => result.pass !== true);
  for (const result of reportedFailures) {
    if (accepted.has(result.id) && result.id === DRIFT_REBASELINE.id) continue;
    failures.push(`${result.id}: ${result.name}`);
  }
  // The report carries both the failing results and their count; a report that
  // declares more failures than it lists is not evidence of anything.
  const declared = typeof report.failures === "number" ? report.failures : reportedFailures.length;
  if (declared !== reportedFailures.length) {
    failures.push(`the report declares ${declared} failures but lists ${reportedFailures.length}`);
  }

  // §8 asks for the entries "for the ten native families and composition": a
  // green report that covers none of them proves nothing about the alpha.
  const green = new Set(
    results
      .filter((/** @type {any} */ result) => result.pass === true)
      .map((/** @type {any} */ result) => areaOf(result.id))
      .filter((/** @type {string | null} */ area) => area !== null),
  );
  // A unit is covered when an automated entry in one of its areas is green.
  // When none is, the catalog itself says why: an area with automated entries
  // that produced nothing green is a gap in the run, an area the compiler
  // evidences only manually (the Circuit family) is not this clause's business,
  // and an area with no entry at all is a gap in the catalog — the acceptance
  // decision requires a per-family entry for every approved family.
  /** @type {string[]} */
  const manual = [];
  for (const unit of COVERAGE_UNITS) {
    if (unit.areas.some((area) => green.has(area))) continue;
    if (unit.areas.some((area) => publishingAutomated(area))) {
      failures.push(
        `no green automated catalog entry covers ${unit.id}: the pinned release publishes automated entries in ${unit.areas.join("/")}`,
      );
    } else if (unit.areas.some((area) => publishing(area))) {
      manual.push(unit.id);
    } else {
      failures.push(
        `the pinned release's catalog publishes no entry for ${unit.id}: ` +
          "the acceptance decision requires a per-family entry for every approved family",
      );
    }
  }

  // The approved re-baseline is a corpus marker, not a catalog entry, so it is
  // not held to the pinned release's entry list.
  /** @type {string[]} */
  const unknown = results
    .map((/** @type {any} */ result) => result.id)
    .filter((/** @type {string} */ id) => areaOf(id) === null && !accepted.has(id));
  if (unknown.length > 0) {
    failures.push(
      `the report names ${unknown.length} entr${unknown.length === 1 ? "y" : "ies"} the pinned release's catalog does not publish: ${unknown.join(", ")}`,
    );
  }

  const areas = [...green].sort();
  return {
    ok: failures.length === 0,
    detail:
      failures.length === 0
        ? `every automated catalog entry is green (${results.length} checks over ${areas.length} areas, ` +
          `no unpending drift${manual.length === 0 ? "" : `; ${manual.join(", ")} evidenced manually by the catalog`})`
        : `${failures.length} catalog clause failure(s)`,
    failures,
    areas,
    manual,
    path: input.path,
    sha256: input.sha256,
  };
}

/**
 * @typedef {object} CutoverInput
 * @property {{ reference: string, id: string } | null} image
 * @property {{ ok: boolean, detail: string, failures: string[], areas: string[], path: string | null, sha256: string | null } | null} catalog
 * @property {{ path: string, passed: number, failed: number, imageId: string | null } | null} smoke
 * @property {{ path: string, passed: number, failed: number, imageId: string | null, entry: any } | null} walkthrough
 */

/**
 * @param {CutoverInput} input
 * @returns {{ decision: string, clauses: Record<string, { ok: boolean, detail: string }>, reasons: string[] }}
 */
export function evaluateCutover(input) {
  const reasons = [];

  const catalog = input.catalog ?? {
    ok: false,
    detail: "no automated catalog report was supplied",
    failures: [],
    areas: [],
    path: null,
    sha256: null,
  };
  if (!catalog.ok) reasons.push(`catalog: ${catalog.detail}`);

  const smoke = input.smoke;
  const smokeOk = smoke !== null && smoke.failed === 0 && smoke.passed > 0;
  if (!smokeOk) {
    reasons.push(
      smoke === null
        ? "deployability: the smoke suite was not run"
        : `deployability: ${smoke.failed} of ${smoke.passed + smoke.failed} smoke checks failed`,
    );
  }

  const walkthrough = input.walkthrough;
  const automatedOk = walkthrough !== null && walkthrough.failed === 0 && walkthrough.passed > 0;
  if (!automatedOk) {
    reasons.push(
      walkthrough === null
        ? "walkthrough: the owner walkthrough was not run"
        : `walkthrough: ${walkthrough.failed} of ${walkthrough.passed + walkthrough.failed} automated walkthrough steps failed`,
    );
  }

  const violations = walkthrough === null ? ["no manual-evidence entry"] : entryViolations(walkthrough.entry);
  const approved = walkthrough?.entry?.record?.result === OWNER_APPROVED;
  if (!approved) reasons.push("owner: Approve is not recorded on the walkthrough entry");
  for (const violation of violations) reasons.push(`owner: ${violation}`);

  // "Deployable means the staged image is the cutover image": every run has to
  // name a digest, and they all have to be the same one. A run that names none
  // (a walkthrough pointed at a URL) is not evidence that the staged image is
  // what was cut over.
  const digests = [input.image?.id, smoke?.imageId, walkthrough?.imageId];
  const stagedOk = digests.every((id) => typeof id === "string" && id.length > 0) && new Set(digests).size === 1;
  if (!stagedOk) {
    reasons.push(
      "staged image: the smoke run, the walkthrough run and the cutover image are not the same image digest",
    );
  }

  const clauses = {
    catalog: { ok: catalog.ok, detail: catalog.detail },
    deployability: {
      ok: smokeOk,
      detail: smoke === null ? "not run" : `${smoke.passed} passed, ${smoke.failed} failed`,
    },
    walkthrough: {
      ok: automatedOk && approved && violations.length === 0,
      detail: automatedOk
        ? approved
          ? `owner ${walkthrough.entry.record.consentedIdentifier} recorded ${OWNER_APPROVED}`
          : "automated steps passed; owner Approve not recorded"
        : "automated steps failed",
    },
    stagedImage: {
      ok: stagedOk,
      detail: stagedOk ? `${input.image?.id}` : "the runs name different image digests",
    },
  };

  return {
    decision: reasons.length === 0 ? APPROVED : NOT_APPROVED,
    clauses,
    reasons,
  };
}
