/**
 * Stand-in for `src/service/worker-entry.mjs`.
 *
 * The HTTP tests must not boot a browser, so this fake speaks the same
 * file-based contract: read `<spec.json>`, write `<result.json>` (and
 * `artifact.bin` for a compile), exit 0. Behaviour is steered by markers in the
 * Source text, which is the only channel a job request controls.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [specPath, resultPath] = process.argv.slice(2);

const writeResult = async (value) => {
  const temporary = `${resultPath}.partial`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`);
  await rename(temporary, resultPath);
};

const spec = JSON.parse(await readFile(specPath, "utf8"));
const text = spec.source.text;
const marker = (name) => {
  const match = new RegExp(`STUB:${name}:?(\\d+)?`).exec(text);
  return match === null ? null : match[1] ?? "0";
};

if (marker("SPAWN") !== null) {
  // A plain child, deliberately *not* detached: it stays in this worker's
  // process group, exactly as the browser the compiler launches does.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], {
    stdio: "ignore",
  });
  child.unref();
  await writeFile(join(dirname(resultPath), "grandchild.pid"), String(child.pid));
  await new Promise((resolve) => setTimeout(resolve, 300_000));
}

if (marker("EXIT") !== null) {
  await writeResult({
    workerError: { name: "StubFailure", message: "simulated worker failure" },
  });
  process.exit(Number(marker("EXIT")) || 1);
}

const sleep = marker("SLEEP");
if (sleep !== null) await new Promise((resolve) => setTimeout(resolve, Number(sleep)));

const diagnostics =
  marker("DIAGNOSTICS") === null
    ? []
    : [
        {
          code: "stub.diagnostic#sample",
          severity: "error",
          message: "A stub diagnostic.",
          data: {},
          relatedLocations: [],
          location: {
            source: spec.source.name ?? "document.aze.md",
            range: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 2, offset: 1 },
            },
          },
          fix: {
            title: "Stub fix",
            applicability: "safe",
            edits: [
              {
                range: {
                  start: { line: 1, column: 1, offset: 0 },
                  end: { line: 1, column: 2, offset: 1 },
                },
                expectedText: text.slice(0, 1),
                replacementText: text.slice(0, 1),
              },
            ],
          },
        },
      ];

if (spec.operation === "format") {
  await writeResult({
    operation: "format",
    ok: marker("REFUSE") === null,
    semantic: null,
    diagnostics,
    proposal:
      marker("REFUSE") === null ? { kind: "formatted-source", source: `${text.trim()}\n` } : null,
    artifact: null,
  });
  process.exit(0);
}

const invalid = marker("INVALID") !== null;
const base = {
  operation: spec.operation,
  ok: !invalid && marker("DIAGNOSTICS") === null,
  semantic: invalid
    ? { valid: false, contentHash: null }
    : {
        valid: true,
        contentHash: `sha256:${"a".repeat(64)}`,
        ...(spec.includeDocument ? { document: { azemarkVersion: 2, schemaVersion: 2, blocks: [] } } : {}),
      },
  diagnostics,
  proposal: null,
  artifact: null,
};

if (spec.operation === "compile" && base.ok) {
  const bytes = Buffer.from(`stub-artifact:${spec.format}:${text.length}`, "utf8");
  await writeFile(join(dirname(resultPath), "artifact.bin"), bytes);
  const artifactHash =
    marker("TAMPER") === null
      ? `sha256:${createHash("sha256").update(bytes).digest("hex")}`
      : `sha256:${"d".repeat(64)}`;
  base.artifact = {
    format: spec.format,
    mimeType: `application/x-stub-${spec.format}`,
    metadata: {
      format: spec.format,
      mimeType: `application/x-stub-${spec.format}`,
      byteLength: marker("TAMPER") === null ? bytes.byteLength : bytes.byteLength + 1,
      contentHash: `sha256:${"a".repeat(64)}`,
      assetManifestHash: `sha256:${"b".repeat(64)}`,
      rendererFingerprint: `sha256:${"c".repeat(64)}`,
      artifactHash,
      theme: { id: spec.theme ?? "default", version: "1.0.0" },
      cssDimensions: { canvasWidthPx: 100, contentWidthPx: 80, paddingPx: 10 },
    },
  };
}

await writeResult(base);
process.exit(0);
