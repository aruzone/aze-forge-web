/**
 * AzeForge Web frontend.
 *
 * Editing, example selection, live diagnostics, sandboxed preview, Theme and
 * format controls, request scheduling and polling, stale-result rejection,
 * guarded fix application and downloads.
 *
 * Everything domain-specific — what a diagnostic means, what may be fixed,
 * what renders — belongs to the compiler. This module only displays compiler
 * results and converts the compiler's Source coordinates into editor indexing.
 */

import { indexForPosition } from "./coordinates.js";

const TOKEN_KEY = "azeweb.token";
const ANALYZE_DEBOUNCE_MS = 350;

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} [kind]
 * @returns {T}
 */
function element(id, kind) {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The frontend is missing #${id}.`);
  if (kind !== undefined && !(found instanceof kind)) throw new Error(`#${id} has the wrong element type.`);
  return /** @type {T} */ (found);
}

const els = {
  gate: element("gate"),
  gateForm: /** @type {HTMLFormElement} */ (element("gate-form", HTMLFormElement)),
  gateToken: /** @type {HTMLInputElement} */ (element("gate-token", HTMLInputElement)),
  gateError: element("gate-error"),
  workspace: element("workspace"),
  example: /** @type {HTMLSelectElement} */ (element("example", HTMLSelectElement)),
  theme: /** @type {HTMLSelectElement} */ (element("theme", HTMLSelectElement)),
  analyze: /** @type {HTMLButtonElement} */ (element("analyze", HTMLButtonElement)),
  format: /** @type {HTMLButtonElement} */ (element("format", HTMLButtonElement)),
  signout: /** @type {HTMLButtonElement} */ (element("signout", HTMLButtonElement)),
  activity: element("activity"),
  source: /** @type {HTMLTextAreaElement} */ (element("source", HTMLTextAreaElement)),
  sourceMeta: element("source-meta"),
  diagnosticsList: element("diagnostics-list"),
  diagnosticsSummary: element("diagnostics-summary"),
  preview: /** @type {HTMLIFrameElement} */ (element("preview", HTMLIFrameElement)),
  previewFrame: element("preview-frame"),
  previewPlaceholder: element("preview-placeholder"),
  previewStatus: element("preview-status"),
  downloadArtifact: /** @type {HTMLButtonElement} */ (element("download-artifact", HTMLButtonElement)),
  serviceMeta: element("service-meta"),
};

/**
 * @typedef {object} DiagnosticRange
 * @property {{ line: number, column: number, offset: number }} start
 * @property {{ line: number, column: number, offset: number }} end
 */

/**
 * @typedef {object} Diagnostic
 * @property {string} code
 * @property {string} severity
 * @property {string} message
 * @property {{ range?: DiagnosticRange }} [location]
 * @property {string} [suggestion]
 * @property {{ message: string, range: DiagnosticRange }[]} [relatedLocations]
 * @property {{ title: string, edits: { range: DiagnosticRange, expectedText: string,
 *             replacementText: string }[] }} [fix]
 */

/**
 * @typedef {object} ArtifactInfo
 * @property {string} format
 * @property {string} mimeType
 * @property {number} byteLength
 * @property {string} artifactHash
 * @property {{ theme?: { id: string, version: string } }} [metadata]
 */

/**
 * @typedef {object} Job
 * @property {string} jobId
 * @property {string} status
 * @property {string} operation
 * @property {string} revision
 * @property {string} submittedAt
 * @property {string | null} expiresAt
 * @property {number} pollAfterMs
 * @property {boolean} cacheHit
 * @property {{ code: string, message: string } | null} [failure]
 * @property {{ ok: boolean, semantic?: { valid: boolean, contentHash: string | null,
 *             document?: object }, diagnostics: Diagnostic[],
 *             proposal?: { kind: string, source: string, revision: string },
 *             artifact?: ArtifactInfo } | null} [result]
 */

/** @type {{ token: string, capabilities: any, examples: { id: string, name: string, source: string }[],
 *   revision: number, analyzeController: AbortController | null, analyzeJobId: string | null,
 *   preview: { objectUrl: string | null, revision: string | null, theme: string | null },
 *   artifact: { format: string, bytes: ArrayBuffer, revision: string } | null,
 *   debounceTimer: ReturnType<typeof setTimeout> | undefined }} */
const state = {
  token: sessionStorage.getItem(TOKEN_KEY) ?? "",
  capabilities: null,
  examples: [],
  revision: 0,
  analyzeController: null,
  analyzeJobId: null,
  preview: { objectUrl: null, revision: null, theme: null },
  artifact: null,
  debounceTimer: undefined,
};

// ------------------------------------------------------------------ transport

/** @param {Record<string, string>} [extra] */
function headers(extra = {}) {
  return { Authorization: `Bearer ${state.token}`, ...extra };
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: string, contentType?: string, signal?: AbortSignal }} [options]
 */
async function request(method, path, { body, contentType, signal } = {}) {
  /** @type {RequestInit} */
  const init = { method, headers: headers(contentType ? { "Content-Type": contentType } : {}), signal };
  if (body !== undefined) init.body = body;
  const response = await fetch(path, init);
  if (response.status === 401) throw requestFailure("The access token was rejected.", { unauthorized: true });
  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text.length === 0 ? null : safeJson(text);
  if (!response.ok) {
    throw requestFailure(payload?.error?.message ?? `Request failed (${response.status}).`, {
      serviceError: payload?.error ?? null,
      status: response.status,
    });
  }
  return payload;
}

/**
 * @param {string} message
 * @param {{ unauthorized?: boolean, serviceError?: { code: string } | null, status?: number }} [fields]
 */
function requestFailure(message, fields = {}) {
  const error = /** @type {Error & typeof fields} */ (new Error(message));
  if (fields.unauthorized !== undefined) error.unauthorized = fields.unauthorized;
  if (fields.serviceError !== undefined) error.serviceError = fields.serviceError;
  if (fields.status !== undefined) error.status = fields.status;
  return error;
}

/** @param {string} text @returns {any} */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {object} requestBody */
async function submitJob(requestBody) {
  return request("POST", "/v1/jobs", { body: JSON.stringify(requestBody), contentType: "application/json" });
}

/** @param {string} jobId */
async function cancelJob(jobId) {
  try {
    await request("POST", `/v1/jobs/${jobId}/cancel`);
  } catch {
    // Cancellation is advisory from the client's point of view: the job store
    // remains authoritative and reports its own state on the next poll.
  }
}

/**
 * @param {string} jobId
 * @param {{ signal?: AbortSignal, pollAfterMs: number }} options
 * @returns {Promise<Job>}
 */
async function pollJob(jobId, { signal, pollAfterMs }) {
  const interval = Number.isFinite(pollAfterMs) && pollAfterMs > 0 ? pollAfterMs : 2000;
  for (;;) {
    const job = await request("GET", `/v1/jobs/${jobId}`, { signal });
    if (job.status !== "queued" && job.status !== "running" && job.status !== "cancelling") return job;
    await sleep(interval, signal);
  }
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** @param {string} jobId @returns {Promise<ArrayBuffer>} */
async function fetchArtifact(jobId) {
  const response = await fetch(`/v1/jobs/${jobId}/artifact`, { headers: headers() });
  if (response.status === 401) throw new Error("The access token was rejected.");
  if (!response.ok) throw new Error(`Artifact download failed (${response.status}).`);
  return response.arrayBuffer();
}

// -------------------------------------------------------------- source state

function currentRevision() {
  return String(state.revision);
}

/** @param {string} text @param {{ fromUser?: boolean }} [options] */
function setSource(text, { fromUser = false } = {}) {
  els.source.value = text;
  state.revision += 1;
  updateSourceMeta();
  markPreviewStale();
  if (fromUser) scheduleAnalyze();
}

function updateSourceMeta() {
  const bytes = new TextEncoder().encode(els.source.value).length;
  els.sourceMeta.textContent = `revision ${currentRevision()} · ${bytes} bytes`;
}

/**
 * A preview represents the revision *and* the Theme it was rendered with. It
 * may be kept after a change, but only while it is visibly stale and never as
 * the current revision.
 */
function markPreviewStale() {
  if (state.preview.revision === null) return;
  const reasons = [];
  if (state.preview.revision !== currentRevision()) {
    reasons.push(`showing revision ${state.preview.revision}, the editor is at revision ${currentRevision()}`);
  }
  if (state.preview.theme !== selectedTheme()) {
    reasons.push(`rendered with theme ${state.preview.theme ?? "default"}, the toolbar selects ${selectedTheme()}`);
  }
  if (reasons.length === 0) return;
  setPreviewStatus(`Stale preview: ${reasons.join("; ")}.`, "stale");
}

function selectedTheme() {
  return els.theme.value === "" ? "default" : els.theme.value;
}

function scheduleAnalyze() {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    void analyze();
  }, ANALYZE_DEBOUNCE_MS);
}

function stopAnalyze() {
  state.analyzeController?.abort();
  if (state.analyzeJobId !== null) void cancelJob(state.analyzeJobId);
  state.analyzeController = null;
  state.analyzeJobId = null;
}

/** @returns {Promise<void>} */
async function analyze() {
  const revision = currentRevision();
  const source = els.source.value;
  stopAnalyze();

  const controller = new AbortController();
  state.analyzeController = controller;
  setActivity("Analyzing…");

  try {
    const accepted = await submitJob({
      protocolVersion: 1,
      requestId: `analyze-${revision}`,
      revision,
      operation: "analyze",
      source: { text: source, name: "document.aze.md" },
    });
    if (controller.signal.aborted) {
      void cancelJob(accepted.jobId);
      return;
    }
    state.analyzeJobId = accepted.jobId;
    const job = await pollJob(accepted.jobId, { signal: controller.signal, pollAfterMs: accepted.pollAfterMs });
    if (job.revision !== currentRevision()) return;
    renderDiagnostics(job);
    setActivity(job.result?.ok === true ? "Analyzed" : "Source has errors", job.result?.ok === true ? "ok" : "error");
  } catch (error) {
    if (isAbort(error)) return;
    handleRequestFailure(asFailure(error), "Analyze failed");
  } finally {
    if (state.analyzeController === controller) {
      state.analyzeController = null;
      state.analyzeJobId = null;
    }
  }
}

// --------------------------------------------------------------- diagnostics

/** @param {Job} job */
function renderDiagnostics(job) {
  const diagnostics = job.result?.diagnostics ?? [];
  els.diagnosticsList.replaceChildren();

  if (diagnostics.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      job.result?.ok === true ? "No diagnostics." : "The compiler reported no diagnostics for this revision.";
    els.diagnosticsList.append(empty);
    els.diagnosticsSummary.textContent = "0";
    return;
  }

  /** @type {Record<string, number>} */
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] = (counts[diagnostic.severity] ?? 0) + 1;
    els.diagnosticsList.append(renderDiagnostic(diagnostic));
  }
  els.diagnosticsSummary.textContent = `${counts.error} error · ${counts.warning} warning · ${counts.info} info`;
}

/** @param {Diagnostic} diagnostic @returns {HTMLElement} */
function renderDiagnostic(diagnostic) {
  const card = document.createElement("article");
  card.className = "diagnostic";
  card.dataset.severity = diagnostic.severity;

  const head = document.createElement("div");
  head.className = "diagnostic-head";
  const severity = document.createElement("span");
  severity.className = "severity";
  severity.textContent = diagnostic.severity;
  const code = document.createElement("code");
  code.textContent = diagnostic.code;
  head.append(severity, code);
  card.append(head);

  const message = document.createElement("p");
  message.className = "message";
  message.textContent = diagnostic.message;
  card.append(message);

  const range = diagnostic.location?.range;
  if (range !== undefined) {
    const location = document.createElement("p");
    location.className = "location";
    const link = document.createElement("button");
    link.type = "button";
    link.textContent = `line ${range.start.line}, column ${range.start.column}`;
    link.addEventListener("click", () => revealRange(range.start, range.end));
    location.append(link);
    card.append(location);
  }

  if (diagnostic.suggestion !== undefined) {
    const suggestion = document.createElement("p");
    suggestion.className = "suggestion";
    suggestion.textContent = diagnostic.suggestion;
    card.append(suggestion);
  }

  for (const related of diagnostic.relatedLocations ?? []) {
    const item = document.createElement("p");
    item.className = "related";
    item.textContent = `${related.message} (line ${related.range.start.line})`;
    card.append(item);
  }

  const fix = diagnostic.fix;
  if (fix !== undefined) {
    const wrapper = document.createElement("div");
    wrapper.className = "fix";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Apply fix: ${fix.title}`;
    button.addEventListener("click", () => applyFix(fix));
    wrapper.append(button);
    card.append(wrapper);
  }

  return card;
}

/** @param {{ line: number, column: number, offset: number }} start
 * @param {{ line: number, column: number, offset: number } | undefined} end */
function revealRange(start, end) {
  const startIndex = indexForPosition(els.source.value, start);
  const endIndex = indexForPosition(els.source.value, end ?? start);
  els.source.focus();
  els.source.setSelectionRange(startIndex, Math.max(startIndex, endIndex));
}

/**
 * The compiler reports 1-based Unicode-code-point columns and 0-based UTF-8
 * byte offsets; a textarea indexes UTF-16 code units. See ./coordinates.js.
 *
 * A fix is applied only when every edit's guarded text still matches the
 * current Source exactly; otherwise nothing changes and the author
 * re-analyzes. Fixes never rewrite the buffer in the background.
 */
/** @param {{ edits: { range: DiagnosticRange, expectedText: string,
 *             replacementText: string }[] }} fix */
function applyFix(fix) {
  const source = els.source.value;
  const edits = fix.edits
    .map((edit) => ({
      start: indexForPosition(source, edit.range.start),
      end: indexForPosition(source, edit.range.end),
      expectedText: edit.expectedText,
      replacementText: edit.replacementText,
    }))
    .sort((a, b) => b.start - a.start);

  for (const edit of edits) {
    if (source.slice(edit.start, edit.end) !== edit.expectedText) {
      setActivity("Fix no longer matches the current Source; re-analyze to refresh it.", "error");
      return;
    }
  }

  let updated = source;
  for (const edit of edits) {
    updated = `${updated.slice(0, edit.start)}${edit.replacementText}${updated.slice(edit.end)}`;
  }
  setSource(updated);
  void analyze();
  setActivity("Fix applied", "ok");
}

// ------------------------------------------------------------------- exports

/** @param {string} format @returns {Promise<void>} */
async function exportFormat(format) {
  const revision = currentRevision();
  const source = els.source.value;
  const theme = els.theme.value;
  const key = format;
  setActivity(`Compiling ${format.toUpperCase()}…`);
  setExporting(format, true);

  try {
    const accepted = await submitJob({
      protocolVersion: 1,
      requestId: `compile-${format}-${revision}`,
      revision,
      operation: "compile",
      format,
      ...(theme ? { theme } : {}),
      source: { text: source, name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, { pollAfterMs: accepted.pollAfterMs });

    if (job.revision !== currentRevision()) {
      setActivity(`Discarded a stale ${format.toUpperCase()} result from revision ${job.revision}.`, "error");
      return;
    }

    if (job.status !== "completed") {
      setActivity(job.failure?.message ?? `${format.toUpperCase()} export failed.`, "error");
      return;
    }

    renderDiagnostics(job);
    if (job.result?.ok !== true || !job.result.artifact) {
      setActivity(`${format.toUpperCase()} export failed; see diagnostics.`, "error");
      return;
    }

    const bytes = await fetchArtifact(job.jobId);
    // Exports and previews are for the revision *and* Theme that were submitted.
    state.artifact = { format, bytes, revision: job.revision };
    els.downloadArtifact.hidden = false;
    els.downloadArtifact.textContent = `Download ${format.toUpperCase()}`;

    if (format === "html") {
      showPreview(job, bytes);
      setActivity(`Preview updated (revision ${job.revision})`, "ok");
    } else {
      downloadArtifact(format, bytes);
      setActivity(`${format.toUpperCase()} downloaded (revision ${job.revision})`, "ok");
    }
  } catch (error) {
    if (isAbort(error)) return;
    handleRequestFailure(asFailure(error), `${format.toUpperCase()} export failed`);
  } finally {
    setExporting(format, false);
  }
}

/** @param {string} format @param {boolean} busy */
function setExporting(format, busy) {
  for (const button of document.querySelectorAll("[data-format]")) {
    const control = /** @type {HTMLButtonElement} */ (button);
    if (control.dataset.format === format) control.disabled = busy;
  }
}

/** @param {Job} job @param {ArrayBuffer} bytes */
function showPreview(job, bytes) {
  const artifact = /** @type {ArtifactInfo} */ (job.result?.artifact);
  const blob = new Blob([bytes], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  if (state.preview.objectUrl !== null) URL.revokeObjectURL(state.preview.objectUrl);
  state.preview = { objectUrl: url, revision: job.revision, theme: selectedTheme() };
  els.preview.src = url;
  els.preview.hidden = false;
  els.previewPlaceholder.hidden = true;
  const metadata = artifact.metadata ?? {};
  setPreviewStatus(
    `Revision ${job.revision} · ${bytes.byteLength} bytes · ${shortHash(artifact.artifactHash)}${
      job.cacheHit ? " · cache hit" : ""
    }${metadata.theme === undefined ? "" : ` · theme ${metadata.theme.id} ${metadata.theme.version}`}`,
  );
}

/** @param {string} format @param {ArrayBuffer} bytes */
function downloadArtifact(format, bytes) {
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `artifact.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** @param {string} text @param {string} [tone] */
function setPreviewStatus(text, tone = "") {
  els.previewStatus.textContent = text;
  if (tone === "") delete els.previewStatus.dataset.tone;
  else els.previewStatus.dataset.tone = tone;
}

/** @param {unknown} hash @returns {string} */
function shortHash(hash) {
  return typeof hash === "string" && hash.length > 20 ? `${hash.slice(0, 15)}…` : String(hash ?? "");
}

// ------------------------------------------------------------------ lifecycle

/** @param {string} text @param {string} [tone] */
function setActivity(text, tone = "") {
  els.activity.textContent = text;
  if (tone === "") delete els.activity.dataset.tone;
  else els.activity.dataset.tone = tone;
}

/** @param {Error & { unauthorized?: boolean, serviceError?: { code: string } | null }} error
 * @param {string} prefix */
/** @param {unknown} error @returns {error is DOMException & { name: "AbortError" }} */
function isAbort(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** @param {unknown} error */
function asFailure(error) {
  return /** @type {Error & { unauthorized?: boolean, serviceError?: { code: string } | null }} */ (
    error instanceof Error ? error : new Error(String(error))
  );
}

/**
 * @param {Error & { unauthorized?: boolean, serviceError?: { code: string } | null }} error
 * @param {string} prefix
 */
function handleRequestFailure(error, prefix) {
  if (error.unauthorized) {
    showGate("The access token was rejected.");
    setActivity("Not authorized", "error");
    return;
  }
  const code = error.serviceError?.code;
  setActivity(code === undefined ? `${prefix}: ${error.message}` : `${prefix}: ${error.message} (${code})`, "error");
}

/** @returns {Promise<void>} */
async function loadCapabilities() {
  const capabilities = await request("GET", "/v1/capabilities");
  state.capabilities = capabilities;

  els.theme.replaceChildren();
  for (const theme of capabilities.compiler.themes) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = `${theme.title} (${theme.colorScheme})`;
    els.theme.append(option);
  }

  els.serviceMeta.textContent = [
    `compiler ${capabilities.compatibility.compilerRelease}`,
    `protocol ${capabilities.protocol.version}`,
    `capability fingerprint ${shortHash(capabilities.compatibility.capabilityFingerprint)}`,
    `raw math ${capabilities.service.policy.rawMath}`,
    `source ≤ ${formatBytes(limitValue(capabilities, "source-bytes-per-job"))}`,
    `compile deadline ${Math.round(capabilities.service.deadlines.compileMs / 1000)}s`,
  ].join(" · ");

  const unavailable = Object.keys(capabilities.service.unavailableOperations ?? {});
  if (unavailable.length > 0) {
    els.serviceMeta.textContent += ` · unavailable: ${unavailable.join(", ")}`;
  }
}

/** @param {any} capabilities @param {string} id @returns {number} */
function limitValue(capabilities, id) {
  return capabilities.service.limits.find((/** @type {{ id: string }} */ limit) => limit.id === id)?.value ?? 0;
}

/** @param {number} bytes @returns {string} */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

/** @returns {Promise<void>} */
async function loadExamples() {
  const response = await fetch("/examples.json");
  if (!response.ok) throw new Error("Examples are unavailable.");
  state.examples = await response.json();
  els.example.replaceChildren();
  for (const example of state.examples) {
    const option = document.createElement("option");
    option.value = example.id;
    option.textContent = example.name;
    els.example.append(option);
  }
}

/** @param {string} id */
function loadExample(id) {
  const example = state.examples.find((entry) => entry.id === id) ?? state.examples[0];
  if (example === undefined) return;
  setSource(example.source);
  void analyze();
}

/** @param {string} [message] */
function showGate(message = "") {
  els.gate.hidden = false;
  els.workspace.hidden = true;
  els.gateError.textContent = message;
  els.gateToken.focus();
}

/** @returns {Promise<void>} */
async function enterWorkspace() {
  els.gate.hidden = true;
  els.workspace.hidden = false;
  els.signout.hidden = false;
  await loadCapabilities();
  if (state.examples.length === 0) await loadExamples();
  if (els.source.value.length === 0) loadExample(state.examples[0]?.id);
}

function bindEvents() {
  els.gateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = els.gateToken.value.trim();
    if (token.length === 0) return;
    state.token = token;
    sessionStorage.setItem(TOKEN_KEY, token);
    enterWorkspace().catch((error) => {
      sessionStorage.removeItem(TOKEN_KEY);
      state.token = "";
      const failure = asFailure(error);
      showGate(failure.unauthorized === true ? "The access token was rejected." : failure.message);
    });
  });

  els.signout.addEventListener("click", () => {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = "";
    location.reload();
  });

  els.source.addEventListener("input", () => setSource(els.source.value, { fromUser: true }));
  els.analyze.addEventListener("click", () => void analyze());
  els.format.addEventListener("click", () => void formatSource());
  els.example.addEventListener("change", () => loadExample(els.example.value));
  els.theme.addEventListener("change", markPreviewStale);
  els.downloadArtifact.addEventListener("click", () => {
    const artifact = state.artifact;
    if (artifact === null) return;
    downloadArtifact(artifact.format, artifact.bytes);
    setActivity(`${artifact.format.toUpperCase()} downloaded (revision ${artifact.revision})`, "ok");
  });

  for (const button of document.querySelectorAll("[data-format]")) {
    const control = /** @type {HTMLButtonElement} */ (button);
    control.addEventListener("click", () => void exportFormat(control.dataset.format ?? "html"));
  }

  els.analyze.disabled = false;
}

/** @returns {Promise<void>} */
async function formatSource() {
  const revision = currentRevision();
  const source = els.source.value;
  setActivity("Formatting…");
  try {
    const accepted = await submitJob({
      protocolVersion: 1,
      requestId: `format-${revision}`,
      revision,
      operation: "format",
      source: { text: source, name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, { pollAfterMs: accepted.pollAfterMs });
    if (job.revision !== currentRevision()) return;
    if (job.result?.ok !== true || !job.result.proposal) {
      setActivity("The compiler refused to format this revision; see diagnostics.", "error");
      renderDiagnostics(job);
      return;
    }
    setSource(job.result.proposal.source);
    void analyze();
    setActivity("Formatting applied", "ok");
  } catch (error) {
    handleRequestFailure(asFailure(error), "Format failed");
  }
}

async function start() {
  bindEvents();
  if (state.token.length === 0) {
    showGate();
    return;
  }
  try {
    await enterWorkspace();
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = "";
    const failure = asFailure(error);
    showGate(failure.unauthorized === true ? "The access token was rejected." : failure.message);
  }
}

void start();
