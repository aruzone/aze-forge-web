/**
 * The acceptance catalog the pinned compiler release publishes.
 *
 * The cutover's catalog clause is about *this* release's entries: a report that
 * names an entry the pinned release does not publish is evidence collected
 * against another build, and a report that skips the entries for a family
 * proves nothing about that family. Both readings need the catalog, and the
 * catalog is the compiler's to publish — it is read from the installed package
 * rather than restated here.
 */

import { ACCEPTANCE_CATALOG_ID, ACCEPTANCE_ENTRIES } from "@aruzone/aze-forge/contracts";

export const CATALOG_ID = ACCEPTANCE_CATALOG_ID;

/** The entries a run must execute and prove; the manual ones are not evidence a
 * suite can produce. */
export const AUTOMATED_ENTRIES = Object.freeze(
  ACCEPTANCE_ENTRIES.filter((entry) => entry.evidence === "automated"),
);

const ENTRY_BY_ID = new Map(ACCEPTANCE_ENTRIES.map((entry) => [entry.id, entry]));

/**
 * The catalog area an entry id belongs to, or `null` when the pinned release
 * publishes no such entry.
 *
 * @param {string} id
 * @returns {string | null}
 */
export function areaOfEntry(id) {
  return ENTRY_BY_ID.get(id)?.area ?? null;
}

/**
 * Whether the pinned release publishes any entry, automated or manual, in an
 * area.
 *
 * @param {string} area
 */
export function publishesEntry(area) {
  return ACCEPTANCE_ENTRIES.some((entry) => entry.area === area);
}

/**
 * Whether the pinned release publishes an automated entry in an area at all.
 *
 * The compiler families are not equally automated: the Circuit family's
 * acceptance evidence is a manual set by the compiler's own decision, so no
 * release will ever publish a green automated entry for it. A family whose area
 * publishes no automated entry is therefore evidenced outside this clause, not
 * missing from it.
 *
 * @param {string} area
 */
export function publishesAutomatedEntry(area) {
  return AUTOMATED_ENTRIES.some((entry) => entry.area === area);
}
