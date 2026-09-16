/**
 * The nine deployment acceptance checks of the alpha operating envelope
 * (section 14), in the order they are reported.
 *
 * Each check states its own verdict and the evidence it recorded through
 * `record()`. Evidence is collected as it is observed, so a check that fails
 * still reports everything it saw before it failed.
 */

import { KNOBS, MIB } from "../../src/service/limits.mjs";
import { CheckFailure, expect } from "../cli.mjs";
import {
  TERMINAL,
  capabilitiesOf,
  diagnosticCodes,
  diagnosticList,
  jobRequest,
  readJob,
  requireJson,
  runToTerminal,
  submit,
} from "../jobs.mjs";
import { containerLogs, probeProcesses, readContainerFile } from "../containers.mjs";
import { describe, errorCode, errorScope, poll, request, sha256 } from "../http.mjs";
import {
  FIGURE_ASSET_PATH,
  canarySource,
  figureDocument,
  minimalDocument,
  newCanary,
  readFigure,
  readGoldenReport,
  wedgeSource,
} from "./sources.mjs";

/**
 * @typedef {object} SmokePins
 * @property {string} compiler exact `@aruzone/aze-forge` version this repository depends on
 * @property {string} browser  the compiler's pinned chrome-headless-shell build id
 */

/**
 * What a check is given. `base`/`container` are the staged deployment; the
 * probe pair is the same image staged with a tight deadline and retention
 * window, so the checks that need to interrupt or expire something can.
 *
 * @typedef {object} SmokeContext
 * @property {string} base
 * @property {string} probeBase
 * @property {string} token
 * @property {string | null} container
 * @property {string | null} probeContainer
 * @property {number} wedgeDiagrams
 * @property {SmokePins} pins
 */

/** @typedef {(line: string) => void} RecordLine */

/**
 * @typedef {object} SmokeCheck
 * @property {string} id
 * @property {string} title
 * @property {(context: SmokeContext, record: RecordLine) => Promise<void>} run
 */

/** A failed expectation. The runner reports the message as the check's verdict. */
export { CheckFailure };

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {any} capabilities @param {string} id @param {string} scope */
function limitValue(capabilities, id, scope) {
  const limits = capabilities?.service?.limits ?? [];
  const found = limits.find((/** @type {any} */ limit) => limit.id === id && limit.scope === scope);
  if (found === undefined) throw new CheckFailure(`the deployment does not advertise the ${id} (${scope}) limit`);
  return found.value;
}

/** Advertised limit ids, and the envelope ceiling each one may not exceed. */
const CEILINGS = [
  { id: "source-bytes-per-job", scope: "job", knob: "maxSourceBytes" },
  { id: "job-body-bytes", scope: "request", knob: "maxJobBodyBytes" },
  { id: "asset-bytes", scope: "asset", knob: "maxAssetBytes" },
  { id: "total-asset-bytes", scope: "deployment", knob: "maxTotalAssetBytes" },
  { id: "assets-per-job", scope: "job", knob: "maxAssetsPerJob" },
  { id: "concurrent-jobs", scope: "deployment", knob: "maxRunningJobs" },
  { id: "queue-depth", scope: "deployment", knob: "queueDepth" },
  { id: "node-heap", scope: "process", knob: "nodeHeapMb", scale: MIB },
  { id: "job-submissions", scope: "per-token-per-minute", knob: "jobSubmissionsPerMinute" },
  { id: "asset-uploads", scope: "per-token-per-minute", knob: "assetUploadsPerMinute" },
  { id: "job-deadline", scope: "analyze|format", knob: "deadlineAnalyzeMs" },
  { id: "job-deadline", scope: "compile", knob: "deadlineCompileMs" },
  { id: "termination-grace", scope: "job", knob: "terminationGraceMs" },
  { id: "asset-handle-retention", scope: "asset", knob: "assetTtlMs" },
  { id: "result-retention", scope: "job", knob: "resultTtlMs" },
  { id: "retained-jobs", scope: "deployment", knob: "maxRetainedJobs" },
  { id: "cache-bytes", scope: "deployment", knob: "cacheMaxBytes" },
  { id: "cache-age", scope: "deployment", knob: "cacheMaxAgeMs" },
  { id: "scratch-bytes", scope: "deployment", knob: "scratchMaxBytes" },
];

/** @type {SmokeCheck[]} */
export const CHECKS = [
  {
    id: "token-401",
    title: "Access boundary",
    async run(context, record) {
      for (const path of ["/healthz", "/readyz"]) {
        const anonymous = await request(context.base, { path, token: null });
        expect(anonymous.status === 200, `${path} must answer without a token; got ${anonymous.status}`);
        expect(
          anonymous.text.trim().length > 0 && !anonymous.text.includes("{"),
          `${path} must stay detail-free; got ${describe(anonymous)}`,
        );
        record(`${path} without a token → ${anonymous.status} ${anonymous.text.trim()}`);
      }

      const missing = await request(context.base, { path: "/v1/capabilities", token: null });
      expect(missing.status === 401, `a missing token must be refused with 401; got ${missing.status}`);
      expect(errorCode(missing) === "unauthorized", `expected unauthorized; got ${errorCode(missing)}`);
      record(`/v1/capabilities without a token → 401 ${errorCode(missing)}`);

      const wrong = await request(context.base, { path: "/v1/capabilities", token: "z".repeat(40) });
      expect(wrong.status === 401, `a wrong token must be refused with 401; got ${wrong.status}`);
      expect(errorCode(wrong) === "unauthorized", `expected unauthorized; got ${errorCode(wrong)}`);
      record("/v1/capabilities with a wrong token → 401 unauthorized");

      const authorized = await request(context.base, { path: "/v1/capabilities", token: context.token });
      expect(authorized.status === 200, `the deployment token must be accepted; got ${authorized.status}`);
      record("/v1/capabilities with the deployment token → 200");
    },
  },

  {
    id: "capabilities",
    title: "Capabilities, policy and effective limits",
    async run(context, record) {
      const capabilities = await capabilitiesOf(context.base, context.token);

      expect(
        capabilities.compatibility?.compilerRelease === context.pins.compiler,
        `the deployment reports compiler ${capabilities.compatibility?.compilerRelease}; this repository pins ` +
          `${context.pins.compiler}. Evidence would be collected against the wrong build.`,
      );
      record(`compiler release ${capabilities.compatibility.compilerRelease}`);

      expect(
        /^sha256:[0-9a-f]{64}$/.test(capabilities.compatibility?.capabilityFingerprint ?? ""),
        `the capability fingerprint is missing: ${capabilities.compatibility?.capabilityFingerprint}`,
      );
      record(`capability fingerprint ${capabilities.compatibility.capabilityFingerprint}`);
      expect(
        capabilities.protocol?.version === 1,
        `protocol version ${capabilities.protocol?.version} is not the expected 1`,
      );

      const browser = capabilities.compiler?.engines?.browser;
      expect(browser?.name === "chrome-headless-shell", `unexpected browser engine ${browser?.name}`);
      expect(
        browser?.pinnedVersion === context.pins.browser,
        `the deployment pins browser ${browser?.pinnedVersion}; the compiler pins ${context.pins.browser}`,
      );
      expect(
        browser?.availability === "available",
        `the pinned browser is not available (${browser?.availability}): ${browser?.reason ?? "no reason given"}`,
      );
      record(`${browser.name} ${browser.pinnedVersion} ${browser.availability}`);

      const policy = capabilities.service?.policy ?? {};
      expect(policy.rawMath === "unavailable", `raw math must be unavailable on the web route; got ${policy.rawMath}`);
      expect(policy.rawHtml === "denied", `raw HTML must be denied; got ${policy.rawHtml}`);
      expect(policy.remoteAssets === "denied", `remote assets must be denied; got ${policy.remoteAssets}`);
      expect(policy.persistence === "none", `persistence must be none; got ${policy.persistence}`);
      expect(policy.accounts === false, `accounts must be off; got ${policy.accounts}`);
      expect(
        capabilities.service?.unavailableOperations?.migrate !== undefined,
        "the migrate operation the pinned compiler cannot execute must be advertised as unavailable",
      );
      record(
        `policy rawMath=${policy.rawMath} rawHtml=${policy.rawHtml} remoteAssets=${policy.remoteAssets} ` +
          `persistence=${policy.persistence} accounts=${policy.accounts}`,
      );

      const formats = capabilities.compiler?.formats ?? [];
      for (const format of ["html", "svg", "png", "pdf"]) {
        expect(formats.includes(format), `the deployment does not advertise the ${format} format`);
      }
      record(`formats ${formats.join(", ")}`);

      for (const { id, scope, knob, scale = 1 } of CEILINGS) {
        const value = limitValue(capabilities, id, scope);
        const built = /** @type {any} */ (KNOBS)[knob];
        expect(
          value <= built.default * scale,
          `${id} (${scope}) is advertised as ${value}, above the built-in alpha ceiling of ${built.default * scale}`,
        );
        expect(
          value >= built.min * scale,
          `${id} (${scope}) is advertised as ${value}, below the built-in floor of ${built.min * scale}`,
        );
      }
      record(`all ${CEILINGS.length} advertised limits are within their built-in alpha ceilings`);

      const deadlines = capabilities.service?.deadlines ?? {};
      expect(
        deadlines.compileMs === limitValue(capabilities, "job-deadline", "compile"),
        "the advertised compile deadline and its published limit disagree",
      );
      expect(
        typeof deadlines.terminationGraceMs === "number" && deadlines.terminationGraceMs > 0,
        "the termination grace must be advertised",
      );
      const retention = capabilities.service?.retention ?? {};
      expect(typeof retention.terminalResultMs === "number", "result retention must be advertised");
      expect(typeof capabilities.service?.polling?.pollAfterMs === "number", "polling guidance must be advertised");
      record(
        `deadlines compile=${deadlines.compileMs}ms analyze=${deadlines.analyzeMs}ms ` +
          `grace=${deadlines.terminationGraceMs}ms result-retention=${retention.terminalResultMs}ms`,
      );
    },
  },

  {
    id: "golden-report",
    title: "Golden report: analyze, compile to four formats, verify every hash",
    async run(context, record) {
      const source = { text: await readGoldenReport(), name: "golden-report.aze.md" };

      const analyzed = await runToTerminal(context.base, context.token, jobRequest("analyze", source), {
        timeoutMs: 120_000,
      });
      expect(analyzed.status === "completed", `analyze settled as ${analyzed.status}`);
      expect(
        analyzed.result?.ok === true,
        `the golden report must analyze cleanly; diagnostics: ${diagnosticCodes(analyzed)}`,
      );
      expect(analyzed.result?.semantic?.valid === true, "the golden report must be a valid Document");
      record(`analyze → valid, contentHash ${analyzed.result.semantic.contentHash ?? "not computed"}`);

      /** @type {(string | null)[]} */
      const hashes = [];
      for (const format of ["html", "svg", "png", "pdf"]) {
        const compiled = await runToTerminal(context.base, context.token, jobRequest("compile", source, { format }), {
          timeoutMs: 300_000,
        });
        expect(compiled.status === "completed", `${format}: compile settled as ${compiled.status}`);
        const codes = diagnosticList(compiled);
        expect(
          compiled.result?.ok === true,
          `${format}: the golden report must compile; diagnostics: ${codes.join(", ") || "none"}` +
            (codes.includes("azeforge.renderer#adapter-missing")
              ? " — the pinned browser could not be launched inside the container; check that the image was built for the platform it runs on"
              : ""),
        );
        const artifact = compiled.result.artifact;
        expect(artifact !== undefined && artifact !== null, `${format}: no Artifact was published`);

        const download = await request(context.base, {
          path: artifact.downloadUrl,
          token: context.token,
          timeoutMs: 300_000,
        });
        expect(download.status === 200, `${format}: the Artifact download returned ${download.status}`);
        expect(
          download.headers.get("content-type") === artifact.mimeType,
          `${format}: the download is ${download.headers.get("content-type")}, not ${artifact.mimeType}`,
        );
        expect(
          download.bytes.byteLength === artifact.byteLength,
          `${format}: the download is ${download.bytes.byteLength} bytes, not the advertised ${artifact.byteLength}`,
        );
        expect(
          sha256(download.bytes) === artifact.artifactHash,
          `${format}: the downloaded bytes do not match the advertised ${artifact.artifactHash}`,
        );
        if (format === "html") {
          // The image bakes the fonts the compiler inlines; an Artifact without
          // them would mean the deployment is quietly rendering with fallbacks.
          expect(
            download.bytes.toString("utf8").includes("data:font/woff2;base64,"),
            "the html Artifact embeds no font: the baked font assets did not reach the render",
          );
        }
        hashes.push(compiled.result.semantic?.contentHash ?? null);
        record(`${format}: ${download.bytes.byteLength} bytes, ${artifact.artifactHash.slice(0, 22)}… verified`);
      }

      expect(
        new Set(hashes).size === 1 && hashes[0] !== null,
        `one Document must have one identity across formats; saw ${hashes.join(", ")}`,
      );
      record(`contentHash identical across all four formats: ${hashes[0]}`);
    },
  },

  {
    id: "asset-roundtrip",
    title: "Asset upload, job binding, render, handle revocation",
    async run(context, record) {
      const figure = await readFigure();
      const uploaded = await request(context.base, {
        method: "POST",
        path: "/v1/assets",
        token: context.token,
        body: new Uint8Array(figure),
        contentType: "image/svg+xml",
      });
      expect(uploaded.status === 201, `the asset upload returned ${uploaded.status}: ${describe(uploaded)}`);
      const uploadedJson = requireJson(uploaded);
      expect(
        uploadedJson.byteLength === figure.byteLength,
        `the upload reports ${uploadedJson.byteLength} bytes, not ${figure.byteLength}`,
      );
      const handle = uploadedJson.assetId;
      expect(typeof handle === "string" && handle.length > 0, "the upload did not return a handle");
      record(`uploaded ${figure.byteLength} bytes as ${uploadedJson.mediaType} → handle ${handle}`);

      const compiled = await runToTerminal(
        context.base,
        context.token,
        jobRequest("compile", { text: figureDocument(), name: "asset-round-trip.aze.md" }, {
          format: "html",
          assets: [{ path: FIGURE_ASSET_PATH, handle }],
        }),
        { timeoutMs: 120_000 },
      );
      expect(compiled.status === "completed", `the bound compile settled as ${compiled.status}`);
      expect(
        compiled.result?.ok === true,
        `the bound compile must render; diagnostics: ${diagnosticCodes(compiled)}`,
      );
      const artifact = compiled.result.artifact;
      expect(artifact !== undefined && artifact !== null, "the bound compile published no Artifact");
      expect(
        /^sha256:[0-9a-f]{64}$/.test(artifact.metadata?.assetManifestHash ?? ""),
        `the Artifact carries no asset manifest hash: ${artifact.metadata?.assetManifestHash}`,
      );

      const download = await request(context.base, {
        path: artifact.downloadUrl,
        token: context.token,
        timeoutMs: 120_000,
      });
      expect(download.status === 200, `the Artifact download returned ${download.status}`);
      expect(
        sha256(download.bytes) === artifact.artifactHash,
        "the downloaded bytes do not match the advertised byte-integrity hash",
      );
      expect(
        download.bytes.toString("utf8").includes("data:image/svg+xml;base64,"),
        "the bound image was not embedded in the Artifact",
      );
      record(
        `job bound ${FIGURE_ASSET_PATH} → Artifact ${artifact.byteLength} bytes, ` +
          `asset manifest ${artifact.metadata.assetManifestHash.slice(0, 22)}…`,
      );

      const revoked = await request(context.base, {
        method: "DELETE",
        path: `/v1/assets/${handle}`,
        token: context.token,
      });
      expect(revoked.status === 204, `revoking the handle returned ${revoked.status}: ${describe(revoked)}`);
      record(`DELETE /v1/assets/${handle} → 204`);

      const afterRevocation = await request(context.base, {
        method: "POST",
        path: "/v1/jobs",
        token: context.token,
        body: jobRequest("compile", { text: figureDocument(), name: "asset-round-trip.aze.md" }, {
          format: "html",
          assets: [{ path: FIGURE_ASSET_PATH, handle }],
        }),
        contentType: "application/json",
      });
      expect(
        afterRevocation.status === 404 && errorCode(afterRevocation) === "not-found",
        `a revoked handle must be indistinguishable from an unknown one; got ${afterRevocation.status} ` +
          `${errorCode(afterRevocation)}`,
      );
      record("binding the revoked handle → 404 not-found");
    },
  },

  {
    id: "cancel",
    title: "Cancellation of a running job",
    async run(context, record) {
      const accepted = await submit(
        context.base,
        context.token,
        jobRequest("compile", { text: wedgeSource(context.wedgeDiagrams), name: "cancel-wedge.aze.md" }, {
          format: "svg",
        }),
      );
      const jobId = accepted.jobId;
      record(`admitted wedge compile ${jobId} (${context.wedgeDiagrams} diagrams)`);

      const running = await poll(
        () => readJob(context.base, context.token, jobId),
        (job) => job.status === "running" || TERMINAL.has(job.status),
        { timeoutMs: 120_000, intervalMs: 200 },
      );

      if (running.status === "running" && context.container !== null) {
        const observed = await poll(
          async () => probeProcesses(/** @type {string} */ (context.container), "chrome-headless-shell"),
          (probe) => probe.count > 0,
          { timeoutMs: 30_000, intervalMs: 200 },
        );
        record(`observed ${observed.count} browser process(es) before cancelling: ${observed.pids.join(", ")}`);
      } else if (running.status === "running") {
        record("no container name was supplied; browser-process evidence is unavailable");
      } else {
        record(`the wedge settled as ${running.status} before it could be cancelled`);
      }

      const cancelled = await request(context.base, {
        method: "POST",
        path: `/v1/jobs/${jobId}/cancel`,
        token: context.token,
      });
      expect(cancelled.status === 200, `cancel returned ${cancelled.status}: ${describe(cancelled)}`);
      record(`POST /v1/jobs/${jobId}/cancel → ${requireJson(cancelled).status}`);

      const settled = await poll(
        () => readJob(context.base, context.token, jobId),
        (job) => TERMINAL.has(job.status),
        { timeoutMs: 120_000, intervalMs: 250 },
      );
      expect(
        settled.status === "cancelled",
        `a cancelled job must settle as cancelled; it settled as ${settled.status}`,
      );
      expect(settled.result === null, "a cancelled job must not publish a result");

      const artifact = await request(context.base, { path: `/v1/jobs/${jobId}/artifact`, token: context.token });
      expect(
        artifact.status === 404 && errorCode(artifact) === "not-found",
        `a cancelled job must publish no Artifact; the download returned ${artifact.status}`,
      );
      record(`cancelled job ${jobId}: terminal state cancelled, Artifact 404`);
    },
  },

  {
    id: "limits",
    title: "Size ceilings, admission limits and retention expiry",
    async run(context, record) {
      const capabilities = await capabilitiesOf(context.base, context.token);

      const assetCeiling = limitValue(capabilities, "asset-bytes", "asset");
      const oversized = Buffer.alloc(assetCeiling + 1, 0x41);
      const tooLarge = await request(context.base, {
        method: "POST",
        path: "/v1/assets",
        token: context.token,
        body: oversized,
        contentType: "application/octet-stream",
        timeoutMs: 120_000,
      });
      expect(
        tooLarge.status === 413 && errorCode(tooLarge) === "payload-too-large",
        `an upload above the advertised ${assetCeiling} byte asset ceiling returned ${tooLarge.status} ` +
          `${errorCode(tooLarge)}`,
      );
      record(`asset upload of ${oversized.byteLength} bytes (ceiling ${assetCeiling}) → 413`);

      const sourceCeiling = limitValue(capabilities, "source-bytes-per-job", "job");
      const oversizedSource = await request(context.base, {
        method: "POST",
        path: "/v1/jobs",
        token: context.token,
        body: jobRequest("analyze", { text: "a".repeat(sourceCeiling + 1), name: "oversized.aze.md" }),
        contentType: "application/json",
        timeoutMs: 120_000,
      });
      expect(
        oversizedSource.status === 413 && errorCode(oversizedSource) === "payload-too-large",
        `a Source above the advertised ${sourceCeiling} byte ceiling returned ${oversizedSource.status} ` +
          `${errorCode(oversizedSource)}`,
      );
      record(`Source of ${sourceCeiling + 1} bytes (ceiling ${sourceCeiling}) → 413`);

      const concurrent = limitValue(capabilities, "concurrent-jobs", "deployment");
      const queueDepth = limitValue(capabilities, "queue-depth", "deployment");
      const flood = concurrent + queueDepth + 1;
      /** @type {string[]} */
      const admitted = [];
      /** @type {import("../http.mjs").HttpResponse | null} */
      let refusal = null;
      for (let index = 0; index < flood; index += 1) {
        const response = await request(context.base, {
          method: "POST",
          path: "/v1/jobs",
          token: context.token,
          body: jobRequest("compile", { text: wedgeSource(6), name: `flood-${index}.aze.md` }, { format: "html" }),
          contentType: "application/json",
        });
        if (response.status === 202) {
          admitted.push(requireJson(response).jobId);
          continue;
        }
        refusal = response;
        break;
      }
      if (refusal === null) {
        throw new CheckFailure(
          `the deployment accepted all ${flood} jobs; ${concurrent} running + ${queueDepth} queued was not enforced`,
        );
      }
      expect(
        refusal.status === 429 && errorCode(refusal) === "admission-limit",
        `admission beyond the advertised capacity returned ${refusal.status} ${errorCode(refusal)}`,
      );
      expect(
        errorScope(refusal) === "queue-depth",
        `the refusal came from ${errorScope(refusal)}, not from admission capacity`,
      );
      expect(refusal.headers.get("retry-after") !== null, "an admission refusal must carry retry guidance");
      record(
        `admitted ${admitted.length} jobs (${concurrent} running, ${queueDepth} queued), the ${flood}th → 429 ` +
          `${errorScope(refusal)} retry-after=${refusal.headers.get("retry-after")}s`,
      );
      for (const jobId of admitted) {
        await request(context.base, { method: "POST", path: `/v1/jobs/${jobId}/cancel`, token: context.token });
      }
      record(`cancelled the ${admitted.length} admitted flood jobs`);

      if (context.probeContainer === null) {
        throw new CheckFailure("no probe container was supplied, so an expired result cannot be produced");
      }
      const probeCapabilities = await capabilitiesOf(context.probeBase, context.token);
      const resultTtlMs = probeCapabilities.service.retention.terminalResultMs;
      const expiring = await runToTerminal(
        context.probeBase,
        context.token,
        jobRequest("compile", { text: minimalDocument(), name: "retention-probe.aze.md" }, { format: "html" }),
        { timeoutMs: 120_000 },
      );
      expect(expiring.status === "completed", `the retention probe settled as ${expiring.status}`);
      const expiringArtifact = expiring.result?.artifact;
      expect(expiringArtifact !== undefined && expiringArtifact !== null, "the retention probe published no Artifact");

      const expiresAt = Date.parse(expiring.expiresAt);
      expect(Number.isFinite(expiresAt), `the terminal result advertises no expiry: ${expiring.expiresAt}`);
      await sleep(Math.max(0, expiresAt - Date.now()) + 750);

      const expired = await request(context.probeBase, {
        path: expiringArtifact.downloadUrl,
        token: context.token,
      });
      expect(
        expired.status === 404 && errorCode(expired) === "not-found",
        `an expired result must be indistinguishable from an unknown one; got ${expired.status} ` +
          `${errorCode(expired)}`,
      );
      record(
        `Artifact read ${((Date.now() - expiresAt) / 1000).toFixed(1)}s after its advertised expiry ` +
          `(retention ${resultTtlMs} ms) → 404 not-found`,
      );
    },
  },

  {
    id: "deadline-kill",
    title: "Deadline kill with no orphaned browser",
    async run(context, record) {
      if (context.probeContainer === null) {
        throw new CheckFailure("no probe container was supplied, so process-group evidence cannot be collected");
      }
      const probeContainer = context.probeContainer;
      const capabilities = await capabilitiesOf(context.probeBase, context.token);
      const deadlineMs = capabilities.service.deadlines.compileMs;
      const graceMs = capabilities.service.deadlines.terminationGraceMs;
      expect(
        deadlineMs <= 30_000,
        `the probe deployment advertises a ${deadlineMs} ms compile deadline; the deadline check needs one short ` +
          `enough to interrupt the wedge`,
      );
      record(`probe compile deadline ${deadlineMs} ms, termination grace ${graceMs} ms`);

      const before = probeProcesses(probeContainer, "chrome-headless-shell");
      record(`browser processes before the wedge: ${before.count}`);

      const accepted = await submit(
        context.probeBase,
        context.token,
        jobRequest("compile", { text: wedgeSource(context.wedgeDiagrams), name: "deadline-wedge.aze.md" }, {
          format: "svg",
        }),
      );
      const jobId = accepted.jobId;
      record(`admitted wedge compile ${jobId} (${context.wedgeDiagrams} diagrams)`);

      let peakBrowsers = before.count;
      let peakWorkers = 0;
      const settled = await poll(
        () => readJob(context.probeBase, context.token, jobId),
        (job) => TERMINAL.has(job.status),
        {
          timeoutMs: deadlineMs + graceMs + 120_000,
          intervalMs: 600,
          onPoll: () => {
            peakBrowsers = Math.max(peakBrowsers, probeProcesses(probeContainer, "chrome-headless-shell").count);
            peakWorkers = Math.max(peakWorkers, probeProcesses(probeContainer, "worker-entry.mjs").count);
          },
        },
      );

      expect(
        settled.status === "failed",
        `a job that outlives its deadline must fail; it settled as ${settled.status}`,
      );
      expect(
        settled.failure?.code === "job-timeout",
        `the deadline failure must carry the stable job-timeout code; got ${settled.failure?.code}`,
      );
      expect(
        peakBrowsers > 0,
        "the wedge never showed a browser process inside the container, so the orphan evidence would be vacuous",
      );
      expect(
        peakWorkers > 0,
        "the wedge never showed a worker process inside the container, so the orphan evidence would be vacuous",
      );
      record(`observed peak ${peakBrowsers} browser process(es) and ${peakWorkers} worker process(es) while running`);
      record(
        `terminated ${settled.status} ${settled.failure.code} (deadlineMs=${settled.failure.data?.deadlineMs ?? "n/a"})`,
      );

      await sleep(graceMs + 1_500);
      const browsers = probeProcesses(probeContainer, "chrome-headless-shell");
      const workers = probeProcesses(probeContainer, "worker-entry.mjs");
      expect(
        browsers.count === 0,
        `orphaned browser processes survived the process-group kill: ${browsers.pids.join(", ")}`,
      );
      expect(workers.count === 0, `orphaned worker processes survived: ${workers.pids.join(", ")}`);
      record("after termination plus grace: 0 browser processes, 0 worker processes");
    },
  },

  {
    id: "privacy-canary",
    title: "Privacy: no Source text or token in the container logs",
    async run(context, record) {
      if (context.container === null) {
        throw new CheckFailure("no container name was supplied, so the logs cannot be inspected");
      }
      const container = context.container;
      const canary = newCanary();
      const analyzed = await runToTerminal(
        context.base,
        context.token,
        jobRequest("analyze", { text: canarySource(canary), name: `${canary}.aze.md` }),
        { timeoutMs: 120_000 },
      );
      expect(analyzed.status === "completed", `the canary job settled as ${analyzed.status}`);
      const codes = (analyzed.result?.diagnostics ?? []).map((/** @type {any} */ diagnostic) => diagnostic.code);
      expect(
        codes.length > 0,
        "the canary Source was expected to produce diagnostics, so Source text really had to pass through a job",
      );
      record(`canary job completed with diagnostics: ${codes.join(", ")}`);
      record(`canary (which must never appear in a log line): ${canary}`);

      await sleep(1_000);
      const logs = containerLogs(container);
      expect(logs.length > 0, "the container produced no logs, so the absence of the canary would prove nothing");
      expect(!logs.includes(canary), "the canary Source text reached the container logs");
      expect(!logs.includes(context.token), "the access token reached the container logs");
      const lines = logs.split("\n").filter((line) => line.trim().length > 0).length;
      record(`${lines} log lines inspected: neither the canary nor the token appears`);
    },
  },

  {
    id: "image-manifest",
    title: "Image dependency manifest",
    async run(context, record) {
      if (context.container === null) {
        throw new CheckFailure("no container name was supplied, so the manifest cannot be read");
      }
      const manifest = JSON.parse(readContainerFile(context.container, "/app/image-manifest.json"));
      expect(manifest.schema === "azeforge.web.image-manifest/v1", `unexpected manifest schema ${manifest.schema}`);
      expect(
        typeof manifest.image?.base === "string" && manifest.image.base.includes("@sha256:"),
        `the base image is not pinned by digest: ${manifest.image?.base}`,
      );
      expect(
        manifest.compiler?.version === context.pins.compiler,
        `the image carries compiler ${manifest.compiler?.version}; this repository pins ${context.pins.compiler}`,
      );
      expect(
        typeof manifest.compiler?.integrity === "string" && manifest.compiler.integrity.startsWith("sha512-"),
        "the compiler pin carries no integrity digest",
      );
      expect(
        manifest.browser?.version === context.pins.browser,
        `the image bakes browser ${manifest.browser?.version}; the compiler pins ${context.pins.browser}`,
      );
      expect(
        /^sha256:[0-9a-f]{64}$/.test(manifest.browser?.sha256 ?? ""),
        "the baked browser executable carries no digest",
      );
      const runtimePlatform = String(manifest.runtime?.platform ?? "");
      const expectedArchive = /** @type {Record<string, string>} */ ({
        "linux-x64": "linux64",
        "linux-arm64": "linux-arm64",
        "darwin-arm64": "mac-arm64",
        "darwin-x64": "mac-x64",
        "win32-x64": "win64",
      })[runtimePlatform];
      expect(
        expectedArchive === undefined || String(manifest.browser?.archive ?? "").endsWith(expectedArchive),
        `the image runs on ${runtimePlatform} but bakes the ${manifest.browser?.archive} browser build, which that ` +
          `platform cannot execute`,
      );
      for (const font of ["@fontsource/inter", "@fontsource/jetbrains-mono"]) {
        const pinned = manifest.fonts?.[font];
        expect(
          typeof pinned?.version === "string" && pinned.version.length > 0,
          `${font} is not pinned in the image`,
        );
      }

      const capabilities = await capabilitiesOf(context.base, context.token);
      const supported = capabilities.compiler?.runtime?.node?.supported ?? [];
      const nodeMajor = Number(String(manifest.runtime?.node ?? "").replace(/^v/, "").split(".")[0]);
      expect(Number.isInteger(nodeMajor), `the manifest reports an unreadable Node version: ${manifest.runtime?.node}`);
      expect(
        supported.includes(nodeMajor),
        `the image runs Node ${nodeMajor}, outside the compiler's supported lines ${supported.join(", ")}`,
      );
      expect(
        capabilities.compiler?.runtime?.node?.canonical === nodeMajor,
        `the deployment reports Node ${capabilities.compiler?.runtime?.node?.canonical}, the image runs ${nodeMajor}`,
      );

      const dependencies = Object.entries(manifest.dependencies ?? {});
      expect(dependencies.length > 0, "the manifest lists no resolved dependencies");
      for (const [name, entry] of dependencies) {
        const pinned = /** @type {any} */ (entry);
        expect(typeof pinned.version === "string" && pinned.version.length > 0, `${name} has no exact version`);
        expect(/^\d+\.\d+\.\d+/.test(pinned.version), `${name} is pinned to a range, not a version: ${pinned.version}`);
      }

      record(`base ${manifest.image.base}`);
      record(
        `compiler ${manifest.compiler.package}@${manifest.compiler.version} ${manifest.compiler.integrity.slice(0, 24)}…`,
      );
      record(`browser ${manifest.browser.name} ${manifest.browser.version} ${manifest.browser.sha256.slice(0, 22)}…`);
      record(`browser archive ${manifest.browser.archive} (runtime ${manifest.runtime.platform})`);
      record(
        `fonts inter@${manifest.fonts["@fontsource/inter"].version} ` +
          `jetbrains-mono@${manifest.fonts["@fontsource/jetbrains-mono"].version}`,
      );
      record(`runtime node ${manifest.runtime.node} (${manifest.runtime.platform})`);
      record(`${dependencies.length} resolved dependencies, all exact pins`);
    },
  },
];
