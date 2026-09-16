/**
 * The Sources the owner walkthrough opens.
 *
 * The walkthrough Source is the alpha's representative document: one Source
 * spanning all ten native capability families plus document composition, so the
 * owner's single pass exercises the whole catalog rather than a sample of it.
 * The golden report is the deployment acceptance document the smoke suite
 * compiles; the walkthrough spot-verifies it independently.
 */

import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const ACCEPTANCE = join(REPO, "acceptance");

/** The representative ten-family Source. */
export const WALKTHROUGH_SOURCE = join(ACCEPTANCE, "walkthrough.aze.md");

/** The deployment acceptance golden the smoke suite compiles. */
export const GOLDEN_REPORT = join(ACCEPTANCE, "golden-report.aze.md");

/**
 * @param {string} path
 * @returns {Promise<{ path: string, name: string, text: string }>}
 */
export async function readSource(path) {
  return { path, name: basename(path), text: await readFile(path, "utf8") };
}
