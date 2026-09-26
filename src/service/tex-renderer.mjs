/**
 * The trusted TeX renderer, as this deployment runs it.
 *
 * `tex` Technical objects render through a deployment-configured, fixed-argv
 * command that speaks the compiler's batch JSON protocol on standard input and
 * output (`azeforge.tex-renderer/v1`). The command is the Docker CLI launching
 * the digest-pinned official renderer image; the argv, the sandbox flags and
 * the resource policy are fixed here, so author Source never contributes an
 * executable, an argument or a limit. The compiler owns the projection, the
 * typing and the publication decision; this module only supplies the adapter
 * the worker hands to `createCompiler`.
 *
 * Everything here is worker-deployment configuration. It reaches the browser
 * only as the coarse `hostEnabled`/`available` facts the capabilities document
 * publishes, never as an image digest, an executable path or a container
 * runtime detail.
 */

import { createCompiler } from "@aruzone/aze-forge";

import { spawn, spawnSync } from "node:child_process";

import { envNameFor, texRendererEnabled } from "./limits.mjs";

export { texRendererEnabled };

// The compiler owns the AzeMark grammar. Reusing its parser keeps this
// pre-dispatch decision aligned with nested Blocks and code fences.
const TEX_BLOCK_DETECTOR = createCompiler();

/**
 * @param {string} sourceText
 * @returns {boolean}
 */
export function sourceHasTexBlock(sourceText) {
  return includesTexBlock(TEX_BLOCK_DETECTOR.parse(sourceText).document.blocks);
}

/** @param {unknown} value @returns {boolean} */
function includesTexBlock(value) {
  if (Array.isArray(value)) return value.some(includesTexBlock);
  if (value === null || typeof value !== "object") return false;
  if (/** @type {{ kind?: unknown }} */ (value).kind === "tex") return true;
  return Object.values(value).some(includesTexBlock);
}


/** The executable the fixed argv launches. Never configurable. */
export const TEX_RENDERER_COMMAND = "docker";

/**
 * An immutable image reference: a content digest on its own, or a repository
 * pinned to one. A mutable tag would let the renderer move under the
 * deployment between two identical Sources.
 */
const IMMUTABLE_IMAGE = /^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$|^sha256:[a-f0-9]{64}$/;

/** The release-manifest identity the adapter is bound to. */
const MANIFEST_IDENTITY = /^sha256:[a-f0-9]{64}$/;

/** @param {string} value */
export function isImmutableRendererImage(value) {
  return IMMUTABLE_IMAGE.test(value);
}

/** @param {string} value */
export function isRendererIdentity(value) {
  return MANIFEST_IDENTITY.test(value);
}

/**
 * The reviewed sandbox argv shared by the compiler's own canonical and local
 * wrappers. The renderer gets no network, no writable root, no capabilities,
 * no host mounts, one CPU, 512 MiB and 64 processes, and the identity reaches
 * it only through a fixed environment variable.
 *
 * @param {string} image
 * @param {string} rendererIdentity
 * @param {string} rendererContainerName
 * @returns {string[]}
 */
export function dockerTexRendererArgs(image, rendererIdentity, rendererContainerName) {
  return [
    "run", "--rm", "--interactive", "--pull", "never", "--platform", "linux/amd64", "--network", "none", "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
    "--env", `AZEFORGE_TEX_RENDERER_IDENTITY=${rendererIdentity}`,
    "--name", rendererContainerName,
    image,
  ];
}

/**
 * The environment a job worker inherits. The worker is a fresh process, so the
 * renderer configuration travels with the job rather than being read from a
 * shared store; a job without the variables is a job without a TeX renderer.
 *
 * @param {{ texRendererImage?: string, texRendererIdentity?: string, texRenderTimeoutMs: number }} config
 * @returns {Record<string, string>}
 */
export function texRendererEnvironment(config) {
  if (!texRendererEnabled(config)) return {};
  return {
    [envNameFor("texRendererImage")]: /** @type {string} */ (config.texRendererImage),
    [envNameFor("texRendererIdentity")]: /** @type {string} */ (config.texRendererIdentity),
    [envNameFor("texRenderTimeoutMs")]: String(config.texRenderTimeoutMs),
  };
}

/**
 * The compiler options the worker builds from that environment. A deployment
 * with no renderer configured returns none: documents without `tex` Blocks
 * compile exactly as before, and one with them reports the compiler's truthful
 * `azeforge.renderer#adapter-missing` diagnostic.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} rendererContainerName
 * @returns {{ texRenderer?: import("@aruzone/aze-forge").TexRenderer, texRenderTimeoutMs?: number }}
 */
export function texRendererCompilerOptions(env, rendererContainerName) {
  const image = env[envNameFor("texRendererImage")];
  const rendererIdentity = env[envNameFor("texRendererIdentity")];
  if (image === undefined || rendererIdentity === undefined) return {};
  const rawTimeout = env[envNameFor("texRenderTimeoutMs")];
  const timeout = rawTimeout === undefined ? undefined : Number(rawTimeout);
  return {
    texRenderer: {
      rendererIdentity: /** @type {`sha256:${string}`} */ (rendererIdentity),
      command: TEX_RENDERER_COMMAND,
      args: dockerTexRendererArgs(image, rendererIdentity, rendererContainerName),
    },
    ...(timeout === undefined || !Number.isInteger(timeout) ? {} : { texRenderTimeoutMs: timeout }),
  };
}

/**
 * Check the configured renderer image before this deployment admits work. This
 * intentionally inspects rather than runs the image: renderer instances belong
 * only to qualifying compile jobs.
 *
 * @param {{ config: { texRendererImage?: string, texRendererIdentity?: string, texRenderTimeoutMs: number },
 *           timeoutMs?: number,
 *           spawn?: typeof spawnSync }} input
 * @returns {{ ok: boolean, detail?: string }}
 */
export function probeTexRenderer({ config, timeoutMs = 60_000, spawn = spawnSync }) {
  const image = config.texRendererImage;
  const rendererIdentity = config.texRendererIdentity;
  if (image === undefined || rendererIdentity === undefined) return { ok: false, detail: "not-configured" };

  const outcome = spawn(TEX_RENDERER_COMMAND, ["image", "inspect", image], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    stdio: "ignore",
  });
  if (outcome.error !== undefined && outcome.error !== null) {
    const code = /** @type {NodeJS.ErrnoException} */ (outcome.error).code;
    return { ok: false, detail: code === "ETIMEDOUT" ? "renderer-timeout" : "executable-unavailable" };
  }
  if (outcome.status !== 0) return { ok: false, detail: "renderer-image-unavailable" };
  return { ok: true };
}

/**
 * Asynchronous renderer preflight for request admission. It bounds a hung
 * Docker client without blocking the HTTP event loop.
 *
 * @param {{ config: { texRendererImage?: string, texRendererIdentity?: string, texRenderTimeoutMs: number },
 *           timeoutMs?: number, spawn?: typeof spawn }} input
 * @returns {Promise<{ ok: boolean, detail?: string }>}
 */
export function probeTexRendererAsync({ config, timeoutMs = 5_000, spawn: spawnImpl = spawn }) {
  const image = config.texRendererImage;
  const rendererIdentity = config.texRendererIdentity;
  if (image === undefined || rendererIdentity === undefined) {
    return Promise.resolve({ ok: false, detail: "not-configured" });
  }

  return new Promise((resolve) => {
    let settled = false;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @param {{ ok: boolean, detail?: string }} outcome */
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    let child;
    try {
      child = spawnImpl(TEX_RENDERER_COMMAND, ["image", "inspect", image], { stdio: "ignore" });
    } catch {
      finish({ ok: false, detail: "executable-unavailable" });
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, detail: "renderer-timeout" });
    }, timeoutMs);
    child.once("error", () => finish({ ok: false, detail: "executable-unavailable" }));
    child.once("close", (status) => finish(status === 0 ? { ok: true } : { ok: false, detail: "renderer-image-unavailable" }));
  });
}

/** The knob names the worker reads, exposed for diagnostics and tests. */
export const TEX_RENDERER_ENV = Object.freeze({
  image: envNameFor("texRendererImage"),
  identity: envNameFor("texRendererIdentity"),
  timeoutMs: envNameFor("texRenderTimeoutMs"),
});
