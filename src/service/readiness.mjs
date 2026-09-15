/**
 * Fail-closed startup validation.
 *
 * Readiness is only reported once the compiler registry constructs, the pinned
 * browser engine is present, scratch storage is writable, and a real compile of
 * a trivial Source succeeds in an isolated child process. That last check is
 * what proves the font assets the compiler inlines actually resolve: the
 * library resolves them internally, so exercising the HTML renderer is the only
 * public-API way to verify them.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SELF_CHECK_SOURCE = [
  "---",
  "azemark: 2",
  "title: AzeForge Web readiness",
  "---",
  "",
  "# Readiness",
  "",
  "Self-check Source. It is never served and never logged.",
  "",
].join("\n");

/**
 * @param {{ config: import("./config.mjs").Config, compilerFacts: import("./types.mjs").AzeCompilerFacts,
 *           workerEntry: string, nodePath?: string, timeoutMs?: number,
 *           spawn?: typeof spawnSync }} input
 * @returns {{ ok: boolean, checks: { name: string, ok: boolean, detail?: string }[] }}
 */
export function runStartupChecks({
  config,
  compilerFacts,
  workerEntry,
  nodePath = process.execPath,
  timeoutMs = 60_000,
  spawn = spawnSync,
}) {
  const checks = [];

  checks.push({
    name: "compiler-registry",
    ok: typeof compilerFacts?.tool?.version === "string",
    detail: compilerFacts?.tool?.version,
  });

  const engines = /** @type {{ engines?: { browser?: { name?: string, pinnedVersion?: string, availability?: string } } }} */ (
    compilerFacts?.capabilities ?? {}
  ).engines;
  const browser = engines?.browser;
  checks.push({
    name: "browser-engine",
    ok: browser?.availability === "available",
    detail: browser === undefined ? undefined : `${browser.name} ${browser.pinnedVersion}`,
  });

  let free = -1;
  try {
    const stats = statfsSync(config.scratchDir);
    free = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    free = -1;
  }
  checks.push({ name: "scratch-storage", ok: free > 0, detail: `${free}` });

  checks.push(runSelfCheck({ config, workerEntry, nodePath, timeoutMs, spawn }));

  return { ok: checks.every((check) => check.ok), checks };
}

/**
 * @param {{ config: import("./config.mjs").Config, workerEntry: string, nodePath: string,
 *           timeoutMs: number, spawn: typeof spawnSync }} input
 * @returns {{ name: string, ok: boolean, detail?: string }}
 */
function runSelfCheck({ config, workerEntry, nodePath, timeoutMs, spawn }) {
  // spawnSync is deliberate: this runs before traffic is admitted, so blocking
  // startup on one bounded, real compile is exactly the point.
  const directory = join(config.scratchDir, "self-check");
  const specPath = join(directory, "spec.json");
  const resultPath = join(directory, "result.json");
  try {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      specPath,
      JSON.stringify({
        operation: "compile",
        source: { text: SELF_CHECK_SOURCE, name: "readiness.aze.md" },
        format: "html",
      }),
    );
    const outcome = spawn(nodePath, [workerEntry, specPath, resultPath], {
      cwd: directory,
      timeout: timeoutMs,
      stdio: "ignore",
    });
    if (outcome.status !== 0) {
      return { name: "self-check-compile", ok: false, detail: `worker-exit-${outcome.status}` };
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    return {
      name: "self-check-compile",
      ok: result.ok === true && result.artifact?.format === "html",
      detail: result.artifact === null || result.artifact === undefined ? "no-artifact" : undefined,
    };
  } catch {
    return { name: "self-check-compile", ok: false, detail: "self-check-threw" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
