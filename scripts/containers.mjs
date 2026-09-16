/**
 * Staging and container-level evidence.
 *
 * The suite runs the image the way it is deployed — read-only rootfs,
 * capability-free, no-new-privileges, capped memory and pids, a scratch tmpfs —
 * so the checks that depend on process isolation and log privacy observe the
 * real thing rather than a loose local run. The same flags are documented in
 * README.md ("Deployment"); the run command the suite used is printed in the
 * recorded evidence.
 */

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { GIB, KNOBS } from "../src/service/limits.mjs";

/** The scratch tmpfs has to hold the deployment's advertised scratch ceiling. */
const SCRATCH_TMPFS = `${Math.ceil(Number(KNOBS.scratchMaxBytes.default) / GIB)}g`;

/**
 * Where this profile departs from the operating envelope's hardening list, and
 * why. It is printed with every acceptance run so the deviation is visible in
 * the evidence rather than buried in a flag list.
 */
export const CONTAINER_DEVIATIONS = Object.freeze([
  "--security-opt seccomp=unconfined: Docker's default seccomp profile refuses clone(CLONE_NEWUSER) " +
    "without CAP_SYS_ADMIN, and Chrome refuses to start without a usable sandbox. The compiler owns the " +
    "browser's launch arguments, so --no-sandbox is not available to this deployment; the alternative is " +
    "an image that cannot render. Everything else in the envelope's hardening list is in place.",
]);

/**
 * The hardening this deployment form requires, in one place: the same flags
 * README.md documents, which the suite therefore cannot drift away from.
 *
 * The container network is deliberately not among them. The suite has to reach
 * the staged service from the host, and a `--internal` network removes the
 * container's route entirely — taking the published ingress port with it — so
 * blocking egress is the host firewall's job and is not something this profile
 * can assert.
 */
export const CONTAINER_FLAGS = Object.freeze([
  "--read-only",
  // Service scratch: uploads, job snapshots, cache, Artifacts.
  "--tmpfs", `/scratch:rw,noexec,nosuid,nodev,size=${SCRATCH_TMPFS},mode=1777`,
  // Runtime temp: the browser engine and the Node runtime both need a writable
  // temporary directory, and a read-only rootfs does not have one. This is not
  // scratch storage and is deliberately smaller than it.
  "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
  // Docker's default seccomp profile refuses `clone(CLONE_NEWUSER)` without
  // CAP_SYS_ADMIN, which is what the pinned browser needs to enter its own
  // namespace sandbox. The alternative is running Chrome with `--no-sandbox`,
  // and the launch arguments belong to the pinned compiler. The browser's
  // sandbox is therefore kept, and Docker's syscall filter — the one hardening
  // flag the operating envelope does not require — is what gives way.
  "--security-opt", "seccomp=unconfined",
  "--memory", "6g",
  "--memory-swap", "6g",
  "--pids-limit", "512",
]);

/**
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`docker ${args.join(" ")} failed: ${result.error.message}`);
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A host port that was free a moment ago; docker fails loudly if it is taken. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** @param {string} image */
export function imageIdentity(image) {
  const inspected = docker(["inspect", image, "--format", "{{.Id}} {{json .RepoDigests}}"]);
  if (inspected.status !== 0) {
    throw new Error(`image ${image} is not present locally: ${inspected.stderr.trim()}`);
  }
  const [id, digests] = inspected.stdout.trim().split(" ");
  return { id: id ?? "", digests: JSON.parse(digests ?? "[]") };
}

/**
 * @param {{ name: string, image: string, port: number, env: Record<string, string> }} input
 * @returns {{ name: string, base: string, command: string[] }}
 */
export function startContainer({ name, image, port, env }) {
  const environment = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const command = [
    "run", "-d", "--name", name,
    ...CONTAINER_FLAGS,
    ...environment,
    "-p", `127.0.0.1:${port}:8080`,
    image,
  ];
  const started = docker(command);
  if (started.status !== 0) {
    throw new Error(`docker run failed: ${started.stderr.trim()}`);
  }
  return { name, base: `http://127.0.0.1:${port}`, command };
}

/** @param {string} name */
export function stopContainer(name) {
  docker(["rm", "-f", name], { timeoutMs: 60_000 });
}

/** @param {string} name @param {number} [tail] */
export function containerLogs(name, tail = 5000) {
  const logged = docker(["logs", "--tail", String(tail), name], { timeoutMs: 60_000 });
  return `${logged.stdout}${logged.stderr}`;
}

/** @param {string} name */
export function containerState(name) {
  const inspected = docker(["inspect", name, "--format", "{{.State.Status}} {{.State.ExitCode}}"]);
  if (inspected.status !== 0) return null;
  const [status, exitCode] = inspected.stdout.trim().split(" ");
  return { status, exitCode: Number(exitCode) };
}

/**
 * The process probe runs inside the container, in the image's own Node, over
 * that container's PID namespace: this is the process-group evidence, not a
 * host-side guess. The whole command line is matched, not `argv[0]` — a worker
 * is started as `node --max-old-space-size=… worker-entry.mjs …`, so its first
 * argument says nothing about which process it is.
 */
const PROCESS_PROBE = [
  "const fs = require('node:fs');",
  "const pattern = process.argv[1];",
  "const found = [];",
  "for (const entry of fs.readdirSync('/proc')) {",
  "  if (!/^[0-9]+$/.test(entry)) continue;",
  "  // The probe carries the pattern in its own command line.",
  "  if (Number(entry) === process.pid) continue;",
  "  let command = '';",
  "  try { command = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\\0').join(' '); } catch { continue; }",
  "  if (command.includes(pattern)) found.push({ pid: Number(entry), command: command.trim() });",
  "}",
  "process.stdout.write(JSON.stringify(found));",
].join("\n");

/**
 * @param {string} container
 * @param {string} pattern
 * @returns {{ count: number, pids: number[] }}
 */
export function probeProcesses(container, pattern) {
  const probed = docker(["exec", container, "node", "-e", PROCESS_PROBE, pattern], { timeoutMs: 30_000 });
  if (probed.status !== 0) {
    throw new Error(`process probe failed in ${container}: ${probed.stderr.trim()}`);
  }
  /** @type {{ pid: number, command: string }[]} */
  const found = JSON.parse(probed.stdout);
  return { count: found.length, pids: found.map((entry) => entry.pid) };
}

/** @param {string} container @param {string} path */
export function readContainerFile(container, path) {
  const read = docker(["exec", container, "cat", path], { timeoutMs: 60_000 });
  if (read.status !== 0) {
    throw new Error(`docker exec cat ${path} failed in ${container}: ${read.stderr.trim()}`);
  }
  return read.stdout;
}

/**
 * Wait until the staged service reports ready. Readiness is fail-closed in the
 * service (registry, pinned browser, scratch, and a real compile through an
 * isolated worker), so this is the deployment's own verdict, not a TCP check.
 *
 * @param {{ base: string, container: string, timeoutMs?: number }} input
 */
export async function awaitReady({ base, container, timeoutMs = 300_000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  for (;;) {
    const state = containerState(container);
    if (state !== null && state.status !== "running") {
      throw new Error(
        `container ${container} is ${state.status} (exit ${state.exitCode}); logs:\n${containerLogs(container, 80)}`,
      );
    }
    try {
      const health = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5_000) });
      if (health.ok) {
        const ready = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(5_000) });
        if (ready.status === 200) return;
        last = `/readyz ${ready.status} ${(await ready.text()).trim()}`;
      } else {
        last = `/healthz ${health.status}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) {
      throw new Error(`service in ${container} never became ready (${last}); logs:\n${containerLogs(container, 80)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
