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

import { areaOfEntry } from "./catalog.mjs";
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
 * @param {(id: string) => string | null} [areaOf] the pinned release's catalog, injectable so the rule can be tested against a complete one
 * @returns {{ ok: boolean, detail: string, failures: string[], areas: string[], path: string | null, sha256: string | null }}
 */
export function evaluateCatalog(input, areaOf = areaOfEntry) {
  if (input === null) {
    return {
      ok: false,
      detail: "no automated catalog report was supplied; the semantic and deterministic-render clause is not evidenced",
      failures: [],
      areas: [],
      path: null,
      sha256: null,
    };
  }

  const { report } = input;
  if (report?.schema !== CATALOG_REPORT_SCHEMA) {
    return {
      ok: false,
      detail: `the catalog report is not ${CATALOG_REPORT_SCHEMA}`,
      failures: [],
      areas: [],
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
  for (const unit of COVERAGE_UNITS) {
    if (!unit.areas.some((area) => green.has(area))) {
      failures.push(
        `no green automated catalog entry covers ${unit.id}: the pinned release publishes no executed entry in ${unit.areas.join("/")}`,
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
        ? `every automated catalog entry is green (${results.length} checks over ${areas.length} areas, no unpending drift)`
        : `${failures.length} catalog clause failure(s)`,
    failures,
    areas,
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

  const digests = new Set(
    [input.image?.id, smoke?.imageId, walkthrough?.imageId].filter((id) => typeof id === "string"),
  );
  const stagedOk = digests.size === 1 && input.image !== null;
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
