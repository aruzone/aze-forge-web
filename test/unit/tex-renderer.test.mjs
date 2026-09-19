/**
 * The trusted TeX renderer adapter this deployment builds.
 *
 * The argv and the identity are a security boundary, not an implementation
 * detail: author Source never contributes an executable, an argument or a
 * limit, and the worker only ever receives the adapter the operator configured.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  dockerTexRendererArgs,
  probeTexRenderer,
  texRendererCompilerOptions,
  texRendererEnabled,
  texRendererEnvironment,
  TEX_RENDERER_COMMAND,
  TEX_RENDERER_PROTOCOL,
} from "../../src/service/tex-renderer.mjs";

const IMAGE = `kkumaresan/aze-forge-tex-renderer@sha256:${"a".repeat(64)}`;
const IDENTITY = `sha256:${"b".repeat(64)}`;

test("the fixed argv is the reviewed sandbox policy, with the image as the only variable", () => {
  const args = dockerTexRendererArgs(IMAGE, IDENTITY);
  assert.equal(TEX_RENDERER_COMMAND, "docker");
  assert.deepEqual(args.slice(0, 3), ["run", "--rm", "--interactive"]);
  assert.equal(args.at(-1), IMAGE, "the image is the last argv entry");
  assert.equal(args.at(-2), `AZEFORGE_TEX_RENDERER_IDENTITY=${IDENTITY}`);
  for (const flag of ["--network", "--read-only", "--cap-drop", "--security-opt", "--pids-limit", "--memory", "--cpus", "--platform"]) {
    assert.ok(args.includes(flag), `${flag} is part of the fixed policy`);
  }
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--tmpfs") + 1], "/tmp:rw,noexec,nosuid,size=64m");
  assert.equal(args[args.indexOf("--memory") + 1], "512m");
  assert.equal(args[args.indexOf("--cpus") + 1], "1");
  assert.ok(args.includes("no-new-privileges"));
  assert.ok(!args.some((arg) => arg.includes("no-sandbox")), "the renderer is never run unsandboxed");
});

test("the renderer configuration is either a pair or nothing at all", () => {
  assert.equal(texRendererEnabled({}), false);
  assert.equal(texRendererEnabled({ texRendererImage: IMAGE }), false);
  assert.deepEqual(texRendererEnvironment({ texRenderTimeoutMs: 15_000 }), {});
  assert.deepEqual(texRendererCompilerOptions({}), {}, "no renderer means the plain compiler");
});

test("the configured pair reaches the worker and becomes the compiler's adapter", () => {
  const config = { texRendererImage: IMAGE, texRendererIdentity: IDENTITY, texRenderTimeoutMs: 9_000 };
  const env = texRendererEnvironment(config);
  const options = texRendererCompilerOptions(env);
  assert.equal(options.texRenderTimeoutMs, 9_000);
  assert.deepEqual(options.texRenderer, {
    rendererIdentity: IDENTITY,
    command: TEX_RENDERER_COMMAND,
    args: dockerTexRendererArgs(IMAGE, IDENTITY),
  });
});

/** A spawn that answers with one canned adapter response. */
function respondingSpawn({ status = 0, stdout = "", error = null } = {}) {
  return () => ({ status, stdout, stderr: "", error: /** @type {any} */ (error) });
}

const OK_RESPONSE = `${JSON.stringify({
  protocol: TEX_RENDERER_PROTOCOL,
  rendererIdentity: IDENTITY,
  results: [{ index: 0, status: "ok", svg: "<svg/>" }],
})}`;

test("the readiness probe exercises the real adapter and demands the configured identity back", () => {
  const config = { texRendererImage: IMAGE, texRendererIdentity: IDENTITY, texRenderTimeoutMs: 15_000 };
  assert.deepEqual(probeTexRenderer({ config, spawn: respondingSpawn({ stdout: OK_RESPONSE }) }), { ok: true });

  const mismatched = JSON.parse(OK_RESPONSE);
  mismatched.rendererIdentity = `sha256:${"c".repeat(64)}`;
  assert.equal(
    probeTexRenderer({ config, spawn: respondingSpawn({ stdout: JSON.stringify(mismatched) }) }).detail,
    "renderer-identity-mismatch",
  );
  assert.equal(
    probeTexRenderer({ config, spawn: respondingSpawn({ stdout: JSON.stringify({ protocol: "other", rendererIdentity: IDENTITY, results: [] }) }) }).detail,
    "renderer-protocol-mismatch",
  );
  assert.equal(probeTexRenderer({ config, spawn: respondingSpawn({ status: 1 }) }).detail, "renderer-exit-1");
  assert.equal(probeTexRenderer({ config, spawn: respondingSpawn({ stdout: "not json" }) }).detail, "renderer-response-invalid");
  assert.equal(
    probeTexRenderer({ config, spawn: respondingSpawn({ error: new Error("spawn docker ENOENT") }) }).detail,
    "executable-unavailable",
  );
  const timedOut = Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" });
  assert.equal(
    probeTexRenderer({ config, spawn: respondingSpawn({ error: timedOut }) }).detail,
    "renderer-timeout",
    "a hung renderer is not reported as a missing executable",
  );
  assert.deepEqual(probeTexRenderer({ config: { texRenderTimeoutMs: 15_000 } }), {
    ok: false,
    detail: "not-configured",
  });
});

test("a probe failure is a failed figure, not a passed one", () => {
  const config = { texRendererImage: IMAGE, texRendererIdentity: IDENTITY, texRenderTimeoutMs: 15_000 };
  const failed = {
    protocol: TEX_RENDERER_PROTOCOL,
    rendererIdentity: IDENTITY,
    results: [{ index: 0, status: "error", diagnostic: { code: "compile-failed", message: "x" } }],
  };
  assert.equal(probeTexRenderer({ config, spawn: respondingSpawn({ stdout: JSON.stringify(failed) }) }).detail, "renderer-figure-failed");
});
