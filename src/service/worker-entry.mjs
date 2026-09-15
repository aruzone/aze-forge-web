/**
 * Per-job child process.
 *
 * Usage: `node worker-entry.mjs <spec.json> <result.json>`
 *
 * One process, one job, one immutable snapshot. The process becomes a process
 * group leader, so terminating the group also terminates any browser the
 * compiler launched. Nothing here is shared with the HTTP service or with
 * another job.
 *
 * The result file is written once, atomically, after the operation settles.
 * Artifact bytes are written next to it as `artifact.bin`; JSON never carries
 * Artifact bytes.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCompiler } from "@aruzone/aze-forge";
import { runOperation } from "./runner.mjs";

const [specPath, resultPath] = /** @type {[string, string]} */ (process.argv.slice(2));
if (specPath === undefined || resultPath === undefined) {
  process.stderr.write("worker-entry requires <spec.json> <result.json>\n");
  process.exit(2);
}

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => controller.abort());
}

try {
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const compiler = createCompiler();
  const result = await runOperation(compiler, spec, { signal: controller.signal });

  const artifactBytes = result.artifact?.bytes;
  if (artifactBytes !== undefined) {
    const artifactPath = join(dirname(resultPath), "artifact.bin");
    await writeFile(artifactPath, artifactBytes, { mode: 0o600 });
  }

  await writeResult(resultPath, {
    operation: result.operation ?? spec.operation,
    ok: result.ok,
    semantic: result.semantic ?? null,
    diagnostics: result.diagnostics ?? [],
    proposal: result.proposal ?? null,
    artifact:
      result.artifact === undefined || result.artifact === null
        ? null
        : {
            format: result.artifact.format,
            mimeType: result.artifact.mimeType,
            metadata: result.artifact.metadata,
          },
  });
  process.exit(0);
} catch (error) {
  // The class name is the only part the service is willing to log; the message
  // may mention host paths and never reaches a response or a log line.
  await writeResult(resultPath, {
    workerError: {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    },
  });
  process.exit(1);
}

/**
 * @param {string} path
 * @param {unknown} value
 */
async function writeResult(path, value) {
  const temporary = `${path}.partial`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
