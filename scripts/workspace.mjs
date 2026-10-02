#!/usr/bin/env node
/**
 * The authoring-workspace acceptance audit: the deterministic fixtures, the
 * required viewport captures, the automated WCAG 2.2 A/AA scans, the
 * cross-cutting contract measurements, and one keyboard-only pass over every
 * essential workflow — recorded as the evidence each specification acceptance
 * ID cites.
 *
 *   node scripts/workspace.mjs
 *   node scripts/workspace.mjs --base-url https://… --token … --no-evidence
 *
 * Without `--base-url` the audit starts the real service in this process with
 * the fixture worker of `scripts/workspace/worker.mjs` and a stubbed authoring
 * provider: the frontend, the HTTP surface, isolation, and Artifact delivery
 * are the real ones, while the compiler output is the specification's
 * deterministic fixture. Nothing here calls a language model.
 */

import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRecorder,
  evidenceStamp,
  parseArgs,
  stringOption,
  tokenDigest,
} from "./cli.mjs";
import { REPO } from "./pins.mjs";
import { openWorkspace, resolveBrowser, startBrowser } from "./workspace/browser.mjs";
import { CHECKS } from "./workspace/checks.mjs";
import { FIXTURE_IDS } from "./workspace/fixtures.mjs";
import { WORKFLOW_CHECK } from "./workspace/workflows.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_WORKER = join(HERE, "workspace", "worker.mjs");

/** Every acceptance ID of `docs/ui/authoring-workspace-redesign.md`. */
const SPEC_IDS = [
  "NAV-01", "NAV-02", "NAV-03",
  "CELL-01", "CELL-02", "CELL-03",
  "DRAFT-01", "DRAFT-02", "DRAFT-03", "DRAFT-04",
  "PREVIEW-01", "PREVIEW-02", "PREVIEW-03", "PREVIEW-04", "PREVIEW-05",
  "DOC-01", "DOC-02", "FORMAT-01", "EXPORT-01", "EXPORT-02", "SERVICE-01",
  "A11Y-01", "A11Y-02",
];

/**
 * IDs whose contract is owned by the reducer suite rather than a browser check:
 * they are stale-response guards that no browser scenario can observe.
 */
const TEST_BACKED = {
  "PREVIEW-02": "test/unit/workspace-state.test.mjs",
  "DRAFT-02": "test/unit/workspace-state.test.mjs",
  "DRAFT-03": "test/unit/workspace-state.test.mjs",
};

const USAGE = `AzeForge Web authoring-workspace acceptance audit

  node scripts/workspace.mjs                                  start the service and audit it
  node scripts/workspace.mjs --base-url <url> --token <token>  audit a running deployment

Options
  --base-url <url>        audit a running service instead of starting one
  --token <token>         deployment token (default: a generated one, or AZEWEB_ACCESS_TOKEN)
  --chrome <path>         browser binary (default: the compiler's pinned cache, then Chrome)
  --evidence-dir <dir>    where the record and captures go (default acceptance/workspace)
  --only <ids>            comma-separated check ids to run
  --no-evidence           print the report without recording it
  --help                  this text
`;

const options = parseArgs(process.argv.slice(2), { booleans: [] });
if (options.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const startedAt = new Date();
const recorder = createRecorder();
const emit = recorder.emit;
const evidenceDir = stringOption(options, "evidence-dir") ?? join(REPO, "acceptance", "workspace");
const only = stringOption(options, "only")?.split(",").map((value) => value.trim()).filter(Boolean) ?? null;

/** The deterministic authoring outcomes the walkthrough expects. */
const AUTHORING_PROVIDER = {
  /** @param {string} description */
  async generate(description) {
    if (/clarify/i.test(description)) return { kind: "clarification", question: "Which audience should this target?" };
    if (/refuse/i.test(description)) return { kind: "refusal", reason: "This request is outside the supported catalogue.", code: "policy" };
    if (/fail/i.test(description)) throw new Error("Audit stub: provider unavailable.");
    // A description asking for slowness lets the audit observe the mutation lock
    // and the Cancel affordance while the request is genuinely in flight.
    if (/slow/i.test(description)) await new Promise((resolve) => setTimeout(resolve, 2_000));
    // A native typed Block, which is what the draft contract accepts.
    return { kind: "source", title: "Generated draft", blockType: "equation", text: "x = 1" };
  },
};

/** @type {{ stop: () => Promise<void>, base: string, token: string, fixtureWorker: boolean } | null} */
let service = null;
let scratchDir = null;

if (typeof options["base-url"] === "string") {
  service = {
    base: options["base-url"],
    token: stringOption(options, "token") ?? process.env.AZEWEB_ACCESS_TOKEN ?? "",
    fixtureWorker: false,
    async stop() {},
  };
} else {
  const { createApplication } = await import("../src/service/main.mjs");
  const { loadConfig } = await import("../src/service/config.mjs");
  const { createLogger } = await import("../src/service/log.mjs");
  const token = stringOption(options, "token") ?? randomBytes(24).toString("hex");
  scratchDir = await mkdtemp(join(tmpdir(), "azeweb-workspace-"));
  const config = loadConfig({
    AZEWEB_ACCESS_TOKEN: token,
    AZEWEB_HOST: "127.0.0.1",
    AZEWEB_PORT: "0",
    AZEWEB_SCRATCH_DIR: scratchDir,
    // Advertise the authoring capability; the stub provider serves the call.
    AZEWEB_AUTHORING_API_KEY: "audit-stub-key",
  });
  const application = await createApplication({
    config,
    // The service's own metadata log goes to stderr so the report stays the record.
    log: createLogger({ level: process.env.AZEWEB_AUDIT_LOG ?? "warn", stream: { write: (line) => process.stderr.write(line) } }),
    workerEntry: FIXTURE_WORKER,
    authoringProvider: AUTHORING_PROVIDER,
  });
  const readiness = await application.runReadiness();
  const address = await new Promise((resolve) => {
    application.service.server.listen(0, "127.0.0.1", () => resolve(application.service.server.address()));
  });
  const port = typeof address === "object" && address !== null ? address.port : 0;
  service = {
    base: `http://127.0.0.1:${port}`,
    token,
    fixtureWorker: true,
    async stop() {
      await new Promise((resolve) => application.service.server.close(resolve));
      await application.close();
    },
  };
  if (readiness.ok !== true) {
    emit(`the service is not ready: ${JSON.stringify(readiness.checks ?? readiness)}`);
    await service.stop();
    await rm(scratchDir, { recursive: true, force: true });
    process.exit(1);
  }
  emit(`service     ${service.base} (in-process, fixture worker, stubbed authoring provider)`);
  emit(`readiness   ok (compiler facts, pinned browser, scratch storage, trivial compile)`);
}

const browserPath = await resolveBrowser(stringOption(options, "chrome"));
const browser = await startBrowser(browserPath);

/** A quiet-period download watcher over a per-run directory. */
/** @param {import("puppeteer-core").Page} page */
async function downloads(page) {
  const dir = await mkdtemp(join(tmpdir(), "azeweb-downloads-"));
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
  return {
    /** @param {number} [quietMs] */
    async waitFor(quietMs = 1_500) {
      const deadline = Date.now() + 30_000;
      let last = -1;
      let stableSince = Date.now();
      for (;;) {
        const files = (await readdir(dir)).filter((name) => !name.endsWith(".crdownload"));
        if (files.length !== last) {
          last = files.length;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= quietMs && files.length > 0) {
          return files;
        }
        if (Date.now() > deadline) return files;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    async close() {
      await client.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const ctx = {
  base: service.base,
  token: service.token,
  /** @param {{ width: number, height: number }} size */
  open: (size) => openWorkspace(browser, { base: service.base, token: service.token, ...size }),
  /** @param {import("puppeteer-core").Page} page @param {string} name */
  async capture(page, name) {
    await mkdir(evidenceDir, { recursive: true });
    const path = join(evidenceDir, `${name}.png`);
    await page.screenshot({ path });
    return relative(REPO, path);
  },
  downloads,
  /** @param {string} line */
  log: emit,
};

/** @type {{ id: string, title: string, ids: string[], ok: boolean, detail: string | null, evidence: string[] }[]} */
const results = [];
const checks = [...CHECKS, WORKFLOW_CHECK].filter((check) => only === null || only.includes(check.id));

emit("");
emit("AzeForge Web authoring-workspace acceptance audit");
emit(`  started     ${startedAt.toISOString()}`);
emit(`  target      ${service.base}${service.fixtureWorker ? " (started by this audit)" : ""}`);
emit(`  browser     ${browserPath}`);
emit(`  token       sha256:${tokenDigest(service.token)}… (hashed; never printed)`);
emit(`  fixtures    ${FIXTURE_IDS.join(", ")}`);
emit(`  checks      ${checks.map((check) => check.id).join(", ")}`);
emit("");

for (const [index, check] of checks.entries()) {
  const evidence = [];
  let ok = true;
  let detail = null;
  try {
    for (const line of await check.run(ctx)) {
      evidence.push(line);
    }
  } catch (error) {
    ok = false;
    detail = error instanceof Error ? error.message : String(error);
    evidence.push(`failure: ${detail}`);
  }
  results.push({ id: check.id, title: check.title, ids: check.ids, ok, detail, evidence });
  emit(`[${index + 1}/${checks.length}] ${check.id} · ${check.title} — ${ok ? "pass" : "FAIL"}`);
  for (const line of evidence) emit(`    · ${line}`);
  emit("");
}

// Every acceptance ID must be observed by a browser check or the reducer suite.
const observed = new Map();
for (const result of results) {
  if (!result.ok) continue;
  for (const id of result.ids) {
    observed.set(id, [...(observed.get(id) ?? []), result.id]);
  }
}
// DRAFT-02/03 and PREVIEW-02 are reducer guards; the browser walk cites their
// workflows, the suite owns the stale-response rule itself.
for (const [id, owner] of Object.entries(TEST_BACKED)) {
  if (!observed.has(id)) observed.set(id, [owner]);
}
const uncovered = SPEC_IDS.filter((id) => !observed.has(id));
emit(`acceptance IDs observed: ${observed.size}/${SPEC_IDS.length}`);
for (const id of SPEC_IDS) {
  const owners = observed.get(id);
  emit(`  ${id.padEnd(11)} ${owners === undefined ? "UNOBSERVED" : owners.join(", ")}`);
}
emit("");

const gaps = [
  "Safari keyboard and rendering: `safaridriver` refuses a session until \"Allow remote automation\" is enabled by hand in Safari Settings, so no Safari pass was run.",
  "VoiceOver with Safari: requires an interactive assistive-technology session; not run.",
  "NVDA on Windows: no Windows host available; not run.",
];
for (const gap of gaps) emit(`gap: ${gap}`);

const failed = results.filter((result) => !result.ok).length;
const passed = results.length - failed;
emit("");
emit(`  passed      ${passed}/${results.length}`);
emit(`  failed      ${failed}`);
if (uncovered.length > 0) emit(`  unobserved  ${uncovered.join(", ")}`);

const report = `${recorder.lines.join("\n")}\n`;
if (options.evidence !== false) {
  const stamp = evidenceStamp(startedAt);
  const ok = failed === 0 && uncovered.length === 0;
  const base = join(evidenceDir, `${stamp}-${ok ? "pass" : "fail"}`);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(`${base}.txt`, report);
  await writeFile(
    `${base}.json`,
    `${JSON.stringify({
      schema: "azeforge.web.workspace-audit-evidence/v1",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      target: { base: service.base, started: service.fixtureWorker },
      browser: browserPath,
      fixtures: FIXTURE_IDS,
      testBacked: TEST_BACKED,
      checks: results,
      acceptanceIds: SPEC_IDS.map((id) => ({ id, observedBy: observed.get(id) ?? null })),
      gaps,
      passed,
      failed,
      unobserved: uncovered,
    }, null, 2)}\n`,
  );
  emit(`  evidence    ${relative(REPO, base)}.txt`);
  emit(`  evidence    ${relative(REPO, base)}.json`);
}

await browser.close();
await service.stop();
if (scratchDir !== null) await rm(scratchDir, { recursive: true, force: true });
process.exit(failed === 0 && uncovered.length === 0 ? 0 : 1);
