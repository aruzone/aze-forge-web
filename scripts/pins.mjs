/**
 * The exact pins this repository ships.
 *
 * Two suites and the cutover all ask the same question — which compiler release
 * and which browser is this checkout pinned to — and the answer decides whether
 * the owner is approving the build that ships. It has one home.
 */

import { CHROME_HEADLESS_SHELL_VERSION } from "@aruzone/aze-forge/adapters";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectCompilerFacts } from "../src/service/compiler-facts.mjs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @returns {Promise<{ compiler: string, browser: string }>}
 */
export async function repoPins() {
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  const compilerPin = packageJson.dependencies["@aruzone/aze-forge"];
  if (typeof compilerPin !== "string" || !/^\d+\.\d+\.\d+/.test(compilerPin)) {
    throw new Error(`package.json must pin an exact @aruzone/aze-forge release; found ${compilerPin}`);
  }
  return { compiler: compilerPin, browser: CHROME_HEADLESS_SHELL_VERSION };
}

/**
 * The fingerprint the pinned release computes over its own registry: a
 * deployment advertising the same release string with another capability set is
 * not this build.
 *
 * @returns {Promise<string>}
 */
export async function pinnedCapabilityFingerprint() {
  const { capabilityFingerprint } = await collectCompilerFacts();
  return capabilityFingerprint;
}
