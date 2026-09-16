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

import { ACCEPTANCE_ENTRIES, ACCEPTANCE_CATALOG_ID } from "@aruzone/aze-forge/contracts";

export const CATALOG_ID = ACCEPTANCE_CATALOG_ID;

/** The entries a run must execute and prove; the manual ones are not evidence a
 * suite can produce. */
export const AUTOMATED_ENTRIES = Object.freeze(
  ACCEPTANCE_ENTRIES.filter((entry) => entry.evidence === "automated"),
);

const AREA_BY_ID = new Map(AUTOMATED_ENTRIES.map((entry) => [entry.id, entry.area]));

/**
 * The catalog area an entry id belongs to, or `null` when the pinned release
 * publishes no such entry.
 *
 * @param {string} id
 * @returns {string | null}
 */
export function areaOfEntry(id) {
  return AREA_BY_ID.get(id) ?? null;
}
