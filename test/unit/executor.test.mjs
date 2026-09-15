/**
 * Process-group isolation and the Node flags each worker is launched with.
 *
 * The heap ceiling is deployment configuration, so the check that it actually
 * reaches the child — as a Node flag, before the script path — is a real
 * contract with the operating system, not an implementation detail.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JobExecutor, descendantGroups } from "../../src/service/executor.mjs";

/** A spawn that records its arguments and hands back an inert child. */
function recordingSpawn() {
  /** @type {{ command: string, args: string[], options: Record<string, unknown> }[]} */
  const calls = [];
  const spawn = (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {Record<string, unknown>} */ options) => {
    calls.push({ command, args, options });
    return { pid: 4242, stdout: null, stderr: null, on: () => {} };
  };
  return { calls, spawn };
}

/**
 * A `/proc` fixture: fields after the command name are state, ppid, pgrp, sid.
 * The browser engine leads its own group and session (57, 232) exactly as the
 * pinned chrome-headless-shell does when it calls setsid().
 */
async function procFixture() {
  const root = await mkdtemp(join(tmpdir(), "azeweb-proc-"));
  const write = async (pid, ppid, pgrp, sid) => {
    await mkdir(join(root, String(pid)), { recursive: true });
    await writeFile(join(root, String(pid), "stat"), `${pid} (node) S ${ppid} ${pgrp} ${sid} 0 0\n`);
  };
  await write(1, 0, 1, 1); // the service
  await write(33, 1, 33, 33); // one job worker, leading its own group
  await write(57, 33, 57, 57); // the browser the worker launched
  await write(60, 57, 57, 57); // its zygote and renderers
  await write(232, 33, 232, 232); // a browser launched later, after an abort
  await write(999, 1, 1, 1); // something unrelated
  return root;
}

test("the worker's own group is not the whole tree: the browser leads another", async () => {
  const root = await procFixture();
  try {
    assert.deepEqual(descendantGroups(33, { procRoot: root }).sort((a, b) => a - b), [57, 232]);
    assert.deepEqual(descendantGroups(999, { procRoot: root }), []);
    assert.deepEqual(descendantGroups(4242, { procRoot: root }), [], "an unknown pid has no descendants");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a worker is launched with the configured heap ceiling before its script path", () => {
  const { calls, spawn } = recordingSpawn();
  const executor = new JobExecutor({
    workerEntry: "/app/src/service/worker-entry.mjs",
    nodePath: "/usr/local/bin/node",
    graceMs: 5_000,
    nodeHeapMb: 512,
    spawn: /** @type {any} */ (spawn),
  });

  executor.start({
    specPath: "/scratch/jobs/job-a/spec.json",
    resultPath: "/scratch/jobs/job-a/result.json",
    cwd: "/scratch/jobs/job-a",
    onSettled: () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/local/bin/node");
  assert.deepEqual(calls[0].args, [
    "--max-old-space-size=512",
    "/app/src/service/worker-entry.mjs",
    "/scratch/jobs/job-a/spec.json",
    "/scratch/jobs/job-a/result.json",
  ]);
  assert.equal(calls[0].options.detached, true, "the worker leads its own process group");
  assert.equal(calls[0].options.cwd, "/scratch/jobs/job-a");
});
