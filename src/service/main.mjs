/**
 * AzeForge Web service entrypoint.
 *
 * Wiring only: configuration → compiler facts → stores → HTTP surface. Nothing
 * here compiles; jobs run in isolated child processes.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetStore } from "./assets.mjs";
import { AccessBoundary } from "./auth.mjs";
import { ArtifactCache } from "./cache.mjs";
import { collectCompilerFacts } from "./compiler-facts.mjs";
import { ConfigurationError, loadConfig, overriddenKnobs } from "./config.mjs";
import { JobExecutor } from "./executor.mjs";
import { JobManager } from "./jobs.mjs";
import { createLogger } from "./log.mjs";
import { runStartupChecks } from "./readiness.mjs";
import { buildSchemaRegistry, unservableSchemaIds } from "./schemas.mjs";
import { createService } from "./server.mjs";
import { loadWebAssets } from "./static.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WORKER_ENTRY = join(HERE, "worker-entry.mjs");
export const WEB_ROOT = join(HERE, "..", "web");
const READINESS_RETRY_MS = 30_000;

/**
 * Build every collaborator without listening. Tests drive this directly.
 *
 * @param {{ config: import("./config.mjs").Config, log?: import("./types.mjs").AzeLogger,
 *           now?: () => number, workerEntry?: string, nodePath?: string,
 *           checkTimeoutMs?: number, compilerFacts?: import("./types.mjs").AzeCompilerFacts,
 *           webRoot?: string }} input
 * @returns {Promise<any>}
 */
export async function createApplication({
  config,
  log = createLogger(),
  now = Date.now,
  workerEntry = WORKER_ENTRY,
  nodePath = process.execPath,
  checkTimeoutMs = 60_000,
  compilerFacts: providedFacts,
  webRoot = WEB_ROOT,
}) {
  await mkdir(config.scratchDir, { recursive: true });

  const compilerFacts = providedFacts ?? (await collectCompilerFacts());
  const documentSchemaIds = /** @type {{ document: { schemaVersions: number[] } }} */ (compilerFacts.versionReport).document.schemaVersions;
  const schemaRegistry = buildSchemaRegistry({
    diagnosticSchemaId: "azeforge.diagnostics/v1",
    documentSchemaIds,
  });
  for (const schemaId of unservableSchemaIds(compilerFacts.schemaIds, schemaRegistry)) {
    log.warn("schema-advertised-but-not-published", { schemaId });
  }

  const assets = new AssetStore({
    scratchDir: config.scratchDir,
    maxAssetBytes: config.maxAssetBytes,
    maxTotalAssetBytes: config.maxTotalAssetBytes,
    assetTtlMs: config.assetTtlMs,
  });
  await assets.init();
  const cache = new ArtifactCache({
    scratchDir: config.scratchDir,
    maxBytes: config.cacheMaxBytes,
    maxAgeMs: config.cacheMaxAgeMs,
  });
  await cache.init();
  const executor = new JobExecutor({ workerEntry, nodePath, graceMs: config.terminationGraceMs });
  const jobs = new JobManager({ config, assets, cache, executor, compilerFacts, log, now });
  await jobs.init();

  const service = createService({
    config,
    log,
    accessBoundary: new AccessBoundary(config.accessToken),
    compilerFacts,
    schemaRegistry,
    assets,
    jobs,
    webAssets: await loadWebAssets(webRoot),
    now,
  });

  const runReadiness = () => {
    const result = runStartupChecks({
      config,
      compilerFacts,
      workerEntry,
      nodePath,
      timeoutMs: checkTimeoutMs,
    });
    service.setReadiness(result);
    return result;
  };

  return {
    config,
    log,
    service,
    jobs,
    assets,
    cache,
    compilerFacts,
    schemaRegistry,
    runReadiness,
    async close() {
      await jobs.close();
    },
  };
}

/** @param {Record<string, string | undefined>} [env] */
export async function main(env = process.env) {
  const log = createLogger();

  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // Configuration problems never become HTTP responses: the process refuses
      // to start. Only the variable names are reported, never their values.
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const application = await createApplication({ config, log });
  let readiness = application.runReadiness();

  await new Promise((resolve) => {
    application.service.server.listen(config.port, config.host, resolve);
  });
  const address = application.service.server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  log.info("service-started", {
    port,
    host: config.host,
    compilerRelease: application.compilerFacts.tool.version,
    capabilityFingerprint: application.compilerFacts.capabilityFingerprint,
    overriddenSettings: overriddenKnobs(config),
    ready: readiness.ok,
  });
  for (const check of readiness.checks) {
    if (!check.ok) log.error("startup-check-failed", { check: check.name, detail: check.detail });
  }

  const retry = setInterval(() => {
    if (readiness.ok) return;
    readiness = application.runReadiness();
    if (readiness.ok) log.info("service-ready", {});
  }, READINESS_RETRY_MS);
  retry.unref?.();

  /** @param {string} signal */
  const shutdown = (signal) => {
    log.info("service-stopping", { signal });
    clearInterval(retry);
    application.service.server.close(() => {
      void application.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), config.terminationGraceMs + 1_000).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
}
