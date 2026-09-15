/**
 * Job execution isolation.
 *
 * Each admitted job runs in a spawned Node child with its own process group.
 * That group is not, on its own, enough to terminate a job: the pinned browser
 * engine calls `setsid()` when it starts, so it leads a *second* session and
 * process group that a signal addressed at the worker's group never reaches.
 * Termination therefore signals the worker's group *and* every process group
 * its descendants lead, freezing the worker before the hard kill so nothing new
 * can be launched in between.
 *
 * Cooperative cancellation propagates through the compiler's `AbortSignal`
 * first; a job that ignores it — or a wedged browser — is terminated by the
 * signalling above: SIGTERM, a bounded grace period, then SIGKILL.
 */

import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class JobExecutor {
  /** @type {string} */
  #workerEntry;

  /** @type {string} */
  #nodePath;

  /** @type {number} */
  #graceMs;

  /** @type {number} */
  #nodeHeapMb;

  /** @type {typeof spawn} */
  #spawn;

  /**
   * @param {{ workerEntry: string, nodePath?: string, graceMs: number,
   *           nodeHeapMb: number, spawn?: typeof spawn }} options
   */
  constructor({ workerEntry, nodePath = process.execPath, graceMs, nodeHeapMb, spawn: spawnImpl = spawn }) {
    this.#workerEntry = workerEntry;
    this.#nodePath = nodePath;
    this.#graceMs = graceMs;
    this.#nodeHeapMb = nodeHeapMb;
    this.#spawn = spawnImpl;
  }

  /**
   * @param {{ specPath: string, resultPath: string, cwd: string,
   *           onSettled: (outcome: { code: number | null, signal: NodeJS.Signals | null }) => void,
   *           onOutput?: (channel: "stdout" | "stderr", text: string) => void }} input
   * @returns {{ pid: number | undefined, kill: () => void }}
   */
  start({ specPath, resultPath, cwd, onSettled, onOutput }) {
    const child = this.#spawn(
      this.#nodePath,
      // The heap ceiling is a Node flag, so it must precede the script path:
      // anything after it is passed to the script instead.
      [`--max-old-space-size=${this.#nodeHeapMb}`, this.#workerEntry, specPath, resultPath],
      {
        cwd,
        // A new process group for the worker; the trees it detaches from are
        // found again at termination (see `descendantGroups`).
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
      },
    );

    let captured = 0;
    /** @param {"stdout" | "stderr"} channel @returns {(chunk: Buffer) => void} */
    const capture = (channel) => (chunk) => {
      if (onOutput === undefined || captured > 8192) return;
      captured += chunk.length;
      onOutput(channel, chunk.toString("utf8"));
    };
    child.stdout?.on("data", capture("stdout"));
    child.stderr?.on("data", capture("stderr"));

    let settled = false;
    child.on("error", () => {
      if (settled) return;
      settled = true;
      onSettled({ code: null, signal: null });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      onSettled({ code, signal });
    });

    return {
      pid: child.pid,
      kill: () => {
        if (child.pid !== undefined) this.#terminateGroup(child.pid);
      },
    };
  }

  /** @param {number} pid */
  #terminateGroup(pid) {
    if (pid === undefined || pid === null) return;

    // The pinned browser engine calls setsid(), so it leads its own session and
    // process group: terminating the worker's group alone would leave a browser
    // rendering for nobody. Its tree is still a descendant of the worker, which
    // is what makes it findable while the worker is alive.
    const groups = descendantGroups(pid);
    signalGroup(pid, "SIGTERM");
    for (const group of groups) signalGroup(group, "SIGTERM");

    const timer = setTimeout(() => {
      // Freeze the worker before enumerating again: a stopped worker launches
      // nothing, so the hard kill cannot miss a browser it started in the
      // grace window. The known trees are killed even if the refresh missed
      // them, and the worker goes last.
      signalGroup(pid, "SIGSTOP");
      for (const group of new Set([...groups, ...descendantGroups(pid)])) {
        signalGroup(group, "SIGKILL");
      }
      signalGroup(pid, "SIGKILL");
    }, this.#graceMs);
    // The grace timer must not hold the process open on shutdown.
    timer.unref?.();
  }
}

/**
 * The process groups a worker's descendants lead, other than the worker's own.
 *
 * A job's only legitimate processes are its worker and whatever the compiler
 * launches from it; the browser engine gives itself a fresh session, so this is
 * the difference between "the browser dies with the job" and "the browser keeps
 * rendering until the container is replaced".
 *
 * Reads `/proc` directly, and reports nothing when it is absent (a platform
 * without it has no process-group kill to correct in the first place).
 *
 * @param {number} pid
 * @param {{ procRoot?: string }} [options]
 * @returns {number[]}
 */
export function descendantGroups(pid, options = {}) {
  const procRoot = options.procRoot ?? "/proc";
  const self = readProcessStat(procRoot, pid);
  if (self === null) return [];

  /** @type {Map<number, number[]>} */
  const children = new Map();
  for (const entry of readProcessIds(procRoot)) {
    const stat = readProcessStat(procRoot, entry);
    if (stat === null) continue;
    const siblings = children.get(stat.ppid);
    if (siblings === undefined) children.set(stat.ppid, [entry]);
    else siblings.push(entry);
  }

  const groups = new Set();
  const seen = new Set([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    const current = /** @type {number} */ (queue.shift());
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      const stat = readProcessStat(procRoot, child);
      if (stat !== null && stat.pgrp !== self.pgrp) groups.add(stat.pgrp);
      queue.push(child);
    }
  }
  return [...groups];
}

/** @param {string} procRoot @returns {number[]} */
function readProcessIds(procRoot) {
  try {
    return readdirSync(procRoot)
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);
  } catch {
    return [];
  }
}

/**
 * `state, ppid, pgrp, session` follow the parenthesised command name, which may
 * itself contain spaces and parentheses — hence the search for the last one.
 *
 * @param {string} procRoot
 * @param {number} pid
 * @returns {{ ppid: number, pgrp: number, session: number } | null}
 */
function readProcessStat(procRoot, pid) {
  let text;
  try {
    text = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
  } catch {
    return null;
  }
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const session = Number(fields[3]);
  if (!Number.isInteger(ppid) || !Number.isInteger(pgrp) || !Number.isInteger(session)) return null;
  return { ppid, pgrp, session };
}

/**
 * Signal a whole process group, tolerating an already-dead group.
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function signalGroup(pid, signal) {
  try {
    // Negative pid addresses the group the detached child leads.
    process.kill(-pid, signal);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH") throw error;
  }
}
