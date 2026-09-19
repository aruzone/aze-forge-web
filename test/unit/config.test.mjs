import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, deadlineForOperation, loadConfig, overriddenKnobs } from "../../src/service/config.mjs";
import { KNOBS, MIB, envNameFor, publishedLimits } from "../../src/service/limits.mjs";

const TOKEN = "k".repeat(32);
const minimal = { AZEWEB_ACCESS_TOKEN: TOKEN };

test("applies the envelope defaults when nothing is configured", () => {
  const config = loadConfig(minimal);
  assert.equal(config.maxRunningJobs, 2);
  assert.equal(config.queueDepth, 8);
  assert.equal(config.maxSourceBytes, 1 * MIB);
  assert.equal(config.deadlineCompileMs, 300_000);
  assert.equal(config.deadlineAnalyzeMs, 60_000);
  assert.equal(config.assetTtlMs, 24 * 60 * 60 * 1000);
  assert.equal(config.resultTtlMs, 60 * 60 * 1000);
  assert.equal(overriddenKnobs(config).length, 0);
});

test("accepts a lower value for every ceilinged knob", () => {
  const config = loadConfig({
    ...minimal,
    AZEWEB_MAX_SOURCE_BYTES: "2048",
    AZEWEB_DEADLINE_COMPILE_MS: "1000",
    AZEWEB_QUEUE_DEPTH: "0",
  });
  assert.equal(config.maxSourceBytes, 2048);
  assert.equal(config.deadlineCompileMs, 1000);
  assert.equal(config.queueDepth, 0);
  assert.deepEqual(overriddenKnobs(config), [
    "AZEWEB_DEADLINE_COMPILE_MS",
    "AZEWEB_MAX_SOURCE_BYTES",
    "AZEWEB_QUEUE_DEPTH",
  ]);
});

test("refuses a configured value above the built-in ceiling instead of clamping", () => {
  assert.throws(
    () => loadConfig({ ...minimal, AZEWEB_MAX_SOURCE_BYTES: String(2 * MIB) }),
    (error) => error instanceof ConfigurationError && /never raise it/.test(error.message),
  );
  assert.throws(() => loadConfig({ ...minimal, AZEWEB_MAX_RUNNING_JOBS: "4" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...minimal, AZEWEB_RESULT_TTL_MS: String(7 * 24 * 3600_000) }), ConfigurationError);
});

test("every documented default is also its ceiling", () => {
  // The README states the rule; this keeps the knob table honest about it.
  // Address and identity settings are not limits: a port may be any free port,
  // and the scratch directory and token are not quantities to bound.
  const notLimits = new Set(["port", "host", "scratchDir", "accessToken"]);
  for (const [key, knob] of Object.entries(KNOBS)) {
    if (notLimits.has(key) || knob.kind === "string" || knob.default === undefined) continue;
    assert.equal(knob.max, knob.default, `${key} must not be raisable above its default`);
  }
});

test("requires a token of at least 32 characters", () => {
  assert.throws(() => loadConfig({}), (error) => error instanceof ConfigurationError && /AZEWEB_ACCESS_TOKEN is required/.test(error.message));
  assert.throws(
    () => loadConfig({ AZEWEB_ACCESS_TOKEN: "short" }),
    (error) => error instanceof ConfigurationError && /at least 32 characters/.test(error.message),
  );
  assert.throws(() => loadConfig({ AZEWEB_ACCESS_TOKEN: `has space ${"x".repeat(30)}` }), ConfigurationError);
});

test("rejects unknown settings rather than ignoring them", () => {
  assert.throws(
    () => loadConfig({ ...minimal, AZEWEB_MAX_SOURCE_BYTE: "5" }),
    (error) => error instanceof ConfigurationError && /not a recognized/.test(error.message),
  );
});

test("rejects non-integer values", () => {
  assert.throws(
    () => loadConfig({ ...minimal, AZEWEB_PORT: "eight thousand" }),
    (error) => error instanceof ConfigurationError && /must be an integer/.test(error.message),
  );
});

test("reports every problem at once", () => {
  try {
    loadConfig({ AZEWEB_PORT: "x", AZEWEB_UNKNOWN_THING: "1" });
    assert.fail("expected a ConfigurationError");
  } catch (error) {
    assert.equal(error.problems.length, 3);
  }
});

test("every knob maps to a distinct environment variable", () => {
  const names = Object.keys(KNOBS).map(envNameFor);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((name) => name.startsWith("AZEWEB_")));
});

test("published limits are the effective configuration, with id, unit and scope", () => {
  const config = loadConfig({ ...minimal, AZEWEB_MAX_SOURCE_BYTES: "1024" });
  const limits = publishedLimits(config);
  const source = limits.find((limit) => limit.id === "source-bytes-per-job");
  assert.deepEqual({ ...source }, { id: "source-bytes-per-job", unit: "bytes", scope: "job", value: 1024 });
  assert.ok(limits.every((limit) => limit.id && limit.unit && limit.scope && typeof limit.value === "number"));
});

const RENDERER_IMAGE = `kkumaresan/aze-forge-tex-renderer@sha256:${"a".repeat(64)}`;
const RENDERER_IDENTITY = `sha256:${"b".repeat(64)}`;

test("TeX stays disabled unless the renderer is configured as an immutable pair", () => {
  const disabled = loadConfig(minimal);
  assert.equal(disabled.texRendererImage, undefined);
  assert.equal(disabled.texRenderTimeoutMs, 15_000);
  assert.equal(publishedLimits(disabled).some((limit) => limit.id === "tex-render-timeout"), false);

  const enabled = loadConfig({
    ...minimal,
    AZEWEB_TEX_RENDERER_IMAGE: RENDERER_IMAGE,
    AZEWEB_TEX_RENDERER_IDENTITY: RENDERER_IDENTITY,
  });
  assert.equal(enabled.texRendererImage, RENDERER_IMAGE);
  assert.equal(enabled.texRendererIdentity, RENDERER_IDENTITY);
  assert.equal(publishedLimits(enabled).find((limit) => limit.id === "tex-render-timeout")?.value, 15_000);
});

test("half a renderer configuration is a startup error, not a runtime surprise", () => {
  assert.throws(
    () => loadConfig({ ...minimal, AZEWEB_TEX_RENDERER_IMAGE: RENDERER_IMAGE }),
    (error) => error instanceof ConfigurationError && /must be supplied together/.test(error.message),
  );
  assert.throws(
    () => loadConfig({ ...minimal, AZEWEB_TEX_RENDERER_IDENTITY: RENDERER_IDENTITY }),
    ConfigurationError,
  );
});

test("a mutable or malformed renderer reference never enables TeX", () => {
  for (const image of ["aze-forge-tex-renderer:local", "repo/image@sha256:short", "sha256:xyz"]) {
    assert.throws(
      () =>
        loadConfig({
          ...minimal,
          AZEWEB_TEX_RENDERER_IMAGE: image,
          AZEWEB_TEX_RENDERER_IDENTITY: RENDERER_IDENTITY,
        }),
      (error) => error instanceof ConfigurationError && /immutable renderer image/.test(error.message),
      image,
    );
  }
  assert.throws(
    () =>
      loadConfig({
        ...minimal,
        AZEWEB_TEX_RENDERER_IMAGE: RENDERER_IMAGE,
        AZEWEB_TEX_RENDERER_IDENTITY: "sha256:not-a-digest",
      }),
    (error) => error instanceof ConfigurationError && /release manifest/.test(error.message),
  );
});

test("the TeX batch deadline can only be lowered", () => {
  const rendered = { AZEWEB_TEX_RENDERER_IMAGE: RENDERER_IMAGE, AZEWEB_TEX_RENDERER_IDENTITY: RENDERER_IDENTITY };
  assert.throws(
    () => loadConfig({ ...minimal, ...rendered, AZEWEB_TEX_RENDER_TIMEOUT_MS: "15001" }),
    ConfigurationError,
  );
  assert.equal(loadConfig({ ...minimal, ...rendered, AZEWEB_TEX_RENDER_TIMEOUT_MS: "5000" }).texRenderTimeoutMs, 5_000);
});

test("compile gets the long deadline and the Source-only operations the short one", () => {
  const config = loadConfig(minimal);
  assert.equal(deadlineForOperation(config, "compile"), config.deadlineCompileMs);
  assert.equal(deadlineForOperation(config, "analyze"), config.deadlineAnalyzeMs);
  assert.equal(deadlineForOperation(config, "format"), config.deadlineAnalyzeMs);
});
