/**
 * Test harness: a real service instance, a stubbed job worker, real HTTP.
 *
 * The HTTP tests exercise the service's own policy — admission, isolation,
 * deadlines, cancellation, retention, envelopes — without paying for a browser.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/service/main.mjs";
import { loadConfig } from "../../src/service/config.mjs";
import { createLogger } from "../../src/service/log.mjs";

export const TEST_TOKEN = "t".repeat(40);
export const STUB_WORKER = fileURLToPath(new URL("../fixtures/stub-worker.mjs", import.meta.url));
export const WEB_ROOT = fileURLToPath(new URL("../../src/web", import.meta.url));

/** Facts shaped like `collectCompilerFacts()`, without loading the compiler. */
export function fakeCompilerFacts(overrides = {}) {
  const capabilities = {
    schema: "azeforge.capabilities/v1",
    schemaVersion: 1,
    tool: { name: "azeforge", version: "0.0.0-test" },
    formats: ["html", "svg", "png", "pdf"],
    themes: [
      { id: "academic", version: "1.0.0", title: "Academic", colorScheme: "light" },
      { id: "default", version: "1.0.0", title: "Default", colorScheme: "light" },
    ],
    engines: { browser: { name: "chrome-headless-shell", pinnedVersion: "0.0.0", availability: "available" } },
    ...overrides.capabilities,
  };
  return {
    capabilities,
    capabilityFingerprint: `sha256:${"0".repeat(64)}`,
    themes: new Set(capabilities.themes.map((theme) => theme.id)),
    formats: new Set(capabilities.formats),
    tool: capabilities.tool,
    versionReport: {
      schema: "azeforge.version/v1",
      source: { azemarkVersions: [2] },
      document: { schemaVersions: [2] },
      schemas: [{ id: "azeforge.diagnostics/v1", version: 1 }],
    },
    schemaIds: ["azeforge.diagnostics/v1"],
    ...overrides,
  };
}

/**
 * @param {{ env?: Record<string, string>, compilerFacts?: object,
 *           workerEntry?: string, lines?: string[] }} [options]
 */
export async function startTestService(options = {}) {
  const scratchDir = await mkdtemp(join(tmpdir(), "azeweb-test-"));
  const lines = options.lines ?? [];
  const config = loadConfig({
    AZEWEB_ACCESS_TOKEN: TEST_TOKEN,
    AZEWEB_HOST: "127.0.0.1",
    AZEWEB_PORT: "0",
    AZEWEB_SCRATCH_DIR: scratchDir,
    ...options.env,
  });

  const log = createLogger({
    level: "info",
    stream: { write: (line) => lines.push(line) },
  });

  const realWorker = options.realWorker === true;
  const application = await createApplication({
    config,
    log,
    workerEntry: realWorker ? undefined : options.workerEntry ?? STUB_WORKER,
    webRoot: WEB_ROOT,
    compilerFacts:
      options.compilerFacts ?? (realWorker ? undefined : fakeCompilerFacts()),
  });
  application.service.setReadiness({ ok: true, checks: [] });

  await new Promise((resolve) => application.service.server.listen(0, "127.0.0.1", resolve));
  const address = application.service.server.address();
  const base = `http://127.0.0.1:${address.port}`;

  return {
    base,
    config,
    application,
    scratchDir,
    logs: lines,
    async close() {
      await new Promise((resolve) => application.service.server.close(resolve));
      await application.close();
      await rm(scratchDir, { recursive: true, force: true });
    },
  };
}

/** Minimal JSON/text HTTP client. */
export async function call(base, method, path, { token = TEST_TOKEN, body, contentType, raw } = {}) {
  const headers = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (contentType !== undefined) headers["Content-Type"] = contentType;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: typeof body === "string" || body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw === true) {
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  }
  const text = await response.text();
  let json = null;
  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** Submit one job and poll until it reaches a terminal state. */
export async function runJob(base, request, { token = TEST_TOKEN, timeoutMs = 30_000 } = {}) {
  const accepted = await call(base, "POST", "/v1/jobs", { token, body: request, contentType: "application/json" });
  if (accepted.status !== 202) return { accepted, job: null };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const polled = await call(base, "GET", `/v1/jobs/${accepted.json.jobId}`, { token });
    const status = polled.json?.status;
    if (status !== "queued" && status !== "running" && status !== "cancelling") {
      return { accepted, job: polled.json, status: polled.status };
    }
    if (Date.now() > deadline) throw new Error(`job ${accepted.json.jobId} did not settle in time`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function analyzeRequest(text, revision = "rev-1") {
  return {
    protocolVersion: 1,
    requestId: `request-${revision}`,
    revision,
    operation: "analyze",
    source: { text, name: "document.aze.md" },
  };
}

export function compileRequest(text, format = "html", revision = "rev-1") {
  return {
    protocolVersion: 1,
    requestId: `request-${revision}`,
    revision,
    operation: "compile",
    format,
    source: { text, name: "document.aze.md" },
  };
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `predicate` holds, so tests never depend on a fixed sleep. */
export async function waitUntil(predicate, { timeoutMs = 5_000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("condition was never satisfied");
    await wait(intervalMs);
  }
}
