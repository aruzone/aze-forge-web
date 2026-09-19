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

import { spawnSync } from "node:child_process";

import { envNameFor, texRendererEnabled } from "./limits.mjs";

export { texRendererEnabled };

/** The batch protocol discriminant the renderer answers with. */
export const TEX_RENDERER_PROTOCOL = "azeforge.tex-renderer/v1";

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
 * @returns {string[]}
 */
export function dockerTexRendererArgs(image, rendererIdentity) {
  return [
    "run", "--rm", "--interactive", "--platform", "linux/amd64", "--network", "none", "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
    "--env", `AZEFORGE_TEX_RENDERER_IDENTITY=${rendererIdentity}`,
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
 * @returns {{ texRenderer?: import("@aruzone/aze-forge").TexRenderer, texRenderTimeoutMs?: number }}
 */
export function texRendererCompilerOptions(env) {
  const image = env[envNameFor("texRendererImage")];
  const rendererIdentity = env[envNameFor("texRendererIdentity")];
  if (image === undefined || rendererIdentity === undefined) return {};
  const rawTimeout = env[envNameFor("texRenderTimeoutMs")];
  const timeout = rawTimeout === undefined ? undefined : Number(rawTimeout);
  return {
    texRenderer: {
      rendererIdentity: /** @type {`sha256:${string}`} */ (rendererIdentity),
      command: TEX_RENDERER_COMMAND,
      args: dockerTexRendererArgs(image, rendererIdentity),
    },
    ...(timeout === undefined || !Number.isInteger(timeout) ? {} : { texRenderTimeoutMs: timeout }),
  };
}

/** A trivial figure the readiness probe renders through the real adapter. */
const PROBE_REQUEST = `${JSON.stringify({
  protocol: TEX_RENDERER_PROTOCOL,
  figures: [
    {
      index: 0,
      profile: "tikz",
      title: "AzeForge Web readiness",
      description: "Readiness probe figure. It is never served and never logged.",
      body: "\\draw (0,0) -- (1,1);",
    },
  ],
})}\n`;

/**
 * Prove the configured renderer is actually runnable before the service admits
 * work: the fixed command, the pinned image and the batch protocol are
 * exercised end to end, and the identity it echoes back must be the configured
 * one. A deployment that enables TeX but cannot render is not ready, rather
 * than a service that accepts a job it cannot complete.
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

  const outcome = spawn(
    TEX_RENDERER_COMMAND,
    dockerTexRendererArgs(image, rendererIdentity),
    {
      input: PROBE_REQUEST,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  if (outcome.error !== undefined && outcome.error !== null) {
    // spawnSync reports both "could not launch" and "the timeout expired"
    // through `error`; a hung renderer must not read as a missing binary.
    const code = /** @type {NodeJS.ErrnoException} */ (outcome.error).code;
    return { ok: false, detail: code === "ETIMEDOUT" ? "renderer-timeout" : "executable-unavailable" };
  }
  if (outcome.status !== 0) return { ok: false, detail: `renderer-exit-${outcome.status ?? "signal"}` };

  let response;
  try {
    response = JSON.parse(typeof outcome.stdout === "string" ? outcome.stdout : "");
  } catch {
    return { ok: false, detail: "renderer-response-invalid" };
  }
  if (response?.protocol !== TEX_RENDERER_PROTOCOL) return { ok: false, detail: "renderer-protocol-mismatch" };
  if (response?.rendererIdentity !== rendererIdentity) return { ok: false, detail: "renderer-identity-mismatch" };
  if (response?.results?.length !== 1 || response.results[0]?.status !== "ok") {
    return { ok: false, detail: "renderer-figure-failed" };
  }
  return { ok: true };
}

/** The knob names the worker reads, exposed for diagnostics and tests. */
export const TEX_RENDERER_ENV = Object.freeze({
  image: envNameFor("texRendererImage"),
  identity: envNameFor("texRendererIdentity"),
  timeoutMs: envNameFor("texRenderTimeoutMs"),
});
