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
  sourceHasTexBlock,
  texRendererCompilerOptions,
  texRendererEnabled,
  texRendererEnvironment,
  TEX_RENDERER_COMMAND,
} from "../../src/service/tex-renderer.mjs";

const IMAGE = `kkumaresan/aze-forge-tex-renderer@sha256:${"a".repeat(64)}`;
const IDENTITY = `sha256:${"b".repeat(64)}`;
const CONTAINER = "azeweb-tex-1a2b3c4d-1234-4abc-8def-123456789abc";


test("the fixed argv is the reviewed sandbox policy, with the image and generated container name as the only variables", () => {
  const args = dockerTexRendererArgs(IMAGE, IDENTITY, CONTAINER);
  assert.equal(TEX_RENDERER_COMMAND, "docker");
  assert.deepEqual(args.slice(0, 3), ["run", "--rm", "--interactive"]);
  assert.equal(args.at(-1), IMAGE, "the image is the last argv entry");
  assert.equal(args.at(-2), CONTAINER);
  assert.equal(args.at(-3), "--name");
  assert.equal(args.at(-4), `AZEFORGE_TEX_RENDERER_IDENTITY=${IDENTITY}`);
  for (const flag of ["--network", "--pull", "--read-only", "--cap-drop", "--security-opt", "--pids-limit", "--memory", "--cpus", "--platform"]) {
    assert.ok(args.includes(flag), `${flag} is part of the fixed policy`);
  }
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--pull") + 1], "never", "a missing image must fail locally, never pull");
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
  const options = texRendererCompilerOptions(env, CONTAINER);
  assert.equal(options.texRenderTimeoutMs, 9_000);
  assert.deepEqual(options.texRenderer, {
    rendererIdentity: IDENTITY,
    command: TEX_RENDERER_COMMAND,
    args: dockerTexRendererArgs(IMAGE, IDENTITY, CONTAINER),
  });
});

test("only parsed TeX Blocks require the renderer preflight", () => {
  assert.equal(sourceHasTexBlock("A document without TeX.\n"), false);
  assert.equal(
    sourceHasTexBlock("---\nazemark: 2\n---\n\n:::: tex\nid: line\ntitle: Line\ndescription: A line.\nprofile: tikz\n----\n\\draw (0,0) -- (1,1);\n::::\n"),
    true,
  );
  assert.equal(sourceHasTexBlock("```text\n:::: tex\n```\n"), false, "code text is not a TeX Block");
});

/** A spawn that answers with a canned Docker outcome. */
function respondingSpawn({ status = 0, stdout = "", error = null } = {}) {
  return () => ({ status, stdout, stderr: "", error: /** @type {any} */ (error) });
}

test("the readiness probe checks the configured image without starting a renderer", () => {
  const config = { texRendererImage: IMAGE, texRendererIdentity: IDENTITY, texRenderTimeoutMs: 15_000 };
  /** @type {string[] | undefined} */
  let invocation;
  const inspected = probeTexRenderer({
    config,
    spawn: (command, args) => {
      invocation = [command, ...args];
      return { status: 0, stdout: "", stderr: "", error: null };
    },
  });
  assert.deepEqual(inspected, { ok: true });
  assert.deepEqual(invocation, ["docker", "image", "inspect", IMAGE]);

  assert.equal(probeTexRenderer({ config, spawn: respondingSpawn({ status: 1 }) }).detail, "renderer-image-unavailable");
  assert.equal(
    probeTexRenderer({ config, spawn: respondingSpawn({ error: new Error("spawn docker ENOENT") }) }).detail,
    "executable-unavailable",
  );
  const timedOut = Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" });
  assert.equal(
    probeTexRenderer({ config, spawn: respondingSpawn({ error: timedOut }) }).detail,
    "renderer-timeout",
    "a hung image check is not reported as a missing binary",
  );
  assert.deepEqual(probeTexRenderer({ config: { texRenderTimeoutMs: 15_000 } }), {
    ok: false,
    detail: "not-configured",
  });
});
