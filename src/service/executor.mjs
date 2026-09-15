/**
 * Job execution isolation.
 *
 * Each admitted job runs in a spawned Node child with its own process group,
 * so the browser engine the compiler launches dies with it. Cooperative
 * cancellation propagates through the compiler's `AbortSignal`; a job that
 * ignores it — or a wedged browser — is terminated by signalling the whole
 * group: SIGTERM, a bounded grace period, then SIGKILL.
 */

import { spawn } from "node:child_process";

export class JobExecutor {
  /** @type {string} */
  #workerEntry;

  /** @type {string} */
  #nodePath;

  /** @type {number} */
  #graceMs;

  /** @type {typeof spawn} */
  #spawn;

  /**
   * @param {{ workerEntry: string, nodePath?: string, graceMs: number,
   *           spawn?: typeof spawn }} options
   */
  constructor({ workerEntry, nodePath = process.execPath, graceMs, spawn: spawnImpl = spawn }) {
    this.#workerEntry = workerEntry;
    this.#nodePath = nodePath;
    this.#graceMs = graceMs;
    this.#spawn = spawnImpl;
  }

  /**
   * @param {{ specPath: string, resultPath: string, cwd: string,
   *           onSettled: (outcome: { code: number | null, signal: NodeJS.Signals | null }) => void,
   *           onOutput?: (channel: "stdout" | "stderr", text: string) => void }} input
   * @returns {{ pid: number | undefined, kill: () => void }}
   */
  start({ specPath, resultPath, cwd, onSettled, onOutput }) {
    const child = this.#spawn(this.#nodePath, [this.#workerEntry, specPath, resultPath], {
      cwd,
      // A new process group: the browser grandchildren are in it too.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    });

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
    signalGroup(pid, "SIGTERM");
    const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), this.#graceMs);
    // The grace timer must not hold the process open on shutdown.
    timer.unref?.();
  }
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
