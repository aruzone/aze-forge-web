// @ts-check
import { createWorkspaceState, emptyDocument, transition } from "./workspace-state.js";
import { indexForPosition } from "./coordinates.js";

const TOKEN_KEY = "azeweb.token";
const PREVIEW_HEIGHT_KEY = "azeweb.previewHeight";

/** @template {HTMLElement} T @param {string} id @param {new () => T} [kind] @returns {T} */
function byId(id, kind) {
  const value = document.getElementById(id);
  if (value === null || (kind && !(value instanceof kind))) throw new Error(`Missing #${id}`);
  return /** @type {T} */ (value);
}

const el = {
  workspace: byId("workspace"), gate: byId("gate"),
  gateForm: /** @type {HTMLFormElement} */ (byId("gate-form")),
  gateToken: /** @type {HTMLInputElement} */ (byId("gate-token")), gateError: byId("gate-error"),
  title: /** @type {HTMLInputElement} */ (byId("document-title")),
  author: /** @type {HTMLTextAreaElement} */ (byId("document-author")),
  date: /** @type {HTMLInputElement} */ (byId("document-date")),
  metadata: /** @type {HTMLTextAreaElement} */ (byId("document-metadata")),
  details: /** @type {HTMLDetailsElement} */ (byId("document-details")),
  cells: byId("notebook-cells"), cellList: byId("cell-list"),
  search: /** @type {HTMLInputElement} */ (byId("cell-search")), searchResult: byId("search-result"),
  sourceMeta: byId("source-meta"), status: byId("workspace-status"),
  theme: /** @type {HTMLSelectElement} */ (byId("theme")),
  preview: /** @type {HTMLIFrameElement} */ (byId("preview")),
  expandedPreview: /** @type {HTMLIFrameElement} */ (byId("expanded-preview")),
  previewPlaceholder: byId("preview-placeholder"), previewState: byId("preview-state"),
  expandedPreviewState: byId("expanded-preview-state"), previewSection: byId("document-preview"),
  separator: byId("preview-separator"),
  refresh: /** @type {HTMLButtonElement} */ (byId("refresh-preview")),
  expand: /** @type {HTMLButtonElement} */ (byId("expand-preview")),
  previewDialog: /** @type {HTMLDialogElement} */ (byId("preview-dialog")),
  diagnostics: byId("diagnostics-panel"), diagnosticsList: byId("diagnostics-list"),
  diagnosticsSummary: byId("diagnostics-summary"), diagnosticsTitle: byId("diagnostics-title"),
  exportMenu: byId("export-menu"), exportToggle: byId("export-toggle"),
  moreMenu: byId("more-menu"), moreToggle: byId("more-toggle"),
  proposalDialog: /** @type {HTMLDialogElement} */ (byId("proposal-dialog")),
  formattedSource: /** @type {HTMLTextAreaElement} */ (byId("formatted-source")),
  proposalMessage: byId("proposal-message"),
  undoBar: byId("undo-bar"), drawerScrim: /** @type {HTMLButtonElement} */ (byId("drawer-scrim")),
  serviceDialog: /** @type {HTMLDialogElement} */ (byId("service-dialog")), serviceMeta: byId("service-meta"),
};

/** @typedef {import("./workspace-state.js").WorkspaceState} WorkspaceState */
/** @typedef {import("./workspace-state.js").WorkspaceEvent} WorkspaceEvent */
/** @typedef {import("./workspace-state.js").Cell} Cell */
/** @typedef {import("./workspace-state.js").CurrentDocument} CurrentDocument */

let token = sessionStorage.getItem(TOKEN_KEY) ?? "";
/** @type {any} */
let capabilities = null;
/** @type {WorkspaceState} */
let model = createWorkspaceState([]);
/** @type {AbortController | null} */
let generationController = null;
/** The blob URL currently displayed, tracked so a replaced Artifact can be revoked. */
/** @type {string | null} */
let displayedPreviewUrl = null;

/** @param {string} value */
const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
/** @param {string} message */
function announce(message) {
  el.status.textContent = "";
  requestAnimationFrame(() => { el.status.textContent = message; });
}
/** @param {WorkspaceEvent} event */
function dispatch(event) {
  model = transition(model, event);
  return model;
}

// ---------------------------------------------------------------------------
// Transport

/** @param {Record<string, string>} [extra] */
function headers(extra = {}) { return { Authorization: `Bearer ${token}`, ...extra }; }
/** @param {string} method @param {string} path @param {{ body?: string, contentType?: string, signal?: AbortSignal }} [options] */
async function request(method, path, options = {}) {
  const response = await fetch(path, {
    method,
    headers: headers(options.contentType ? { "Content-Type": options.contentType } : {}),
    body: options.body,
    signal: options.signal,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (response.status === 401) throw Object.assign(new Error("The access token was rejected."), { unauthorized: true });
  if (!response.ok) throw new Error(payload?.error?.message ?? `Request failed (${response.status}).`);
  return payload;
}
/** @param {object} body */
async function submitJob(body) { return request("POST", "/v1/jobs", { body: JSON.stringify(body), contentType: "application/json" }); }
/** @param {string} id @param {number} after @param {AbortSignal} [signal] */
async function pollJob(id, after, signal) {
  for (;;) {
    const job = await request("GET", `/v1/jobs/${id}`, { signal });
    if (!["queued", "running", "cancelling"].includes(job.status)) return job;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, after || 300);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }
}
/** @param {string} id */
async function artifact(id) {
  const response = await fetch(`/v1/jobs/${id}/artifact`, { headers: headers() });
  if (!response.ok) throw new Error(`Artifact fetch failed (${response.status}).`);
  return response.arrayBuffer();
}

// ---------------------------------------------------------------------------
// Document source

/** @param {string} raw */
function parseValue(raw) {
  if (raw.startsWith('"') || raw.startsWith("[")) {
    try { return JSON.parse(raw); } catch { /* fall through to quote stripping */ }
  }
  return raw.replace(/^['"]|['"]$/g, "");
}

/**
 * Split a complete AzeMark Source into the Current document and its Cell
 * sources. Cell boundaries are top-level headings, matching the design.
 * @param {string} source
 * @returns {{ document: CurrentDocument, sources: string[] }}
 */
function parseDocument(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const document = emptyDocument();
  let body = normalized;
  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---", 4);
    if (end >= 0) {
      const extra = [];
      for (const line of normalized.slice(4, end).split("\n")) {
        const match = /^([\w-]+):\s*(.*)$/.exec(line);
        if (!match) { extra.push(line); continue; }
        const raw = match[2];
        const value = parseValue(raw);
        if (match[1] === "azemark") document.version = String(value);
        else if (match[1] === "title") document.title = String(value);
        else if (match[1] === "author") document.authors = Array.isArray(value) ? value.map(String) : [String(value)];
        else if (match[1] === "date" || match[1] === "x-date") document.date = String(value);
        else extra.push(line);
      }
      document.metadata = extra.join("\n");
      body = normalized.slice(end + 4).replace(/^\n+/, "");
    }
  }
  const trimmed = body.trim();
  const sources = trimmed ? trimmed.split(/(?=^#{1,6}\s)/m).filter(Boolean) : [""];
  return { document, sources };
}

/** Assemble the Current document Source from the model. */
function assembledSource() {
  const { document, cells } = model;
  const lines = [
    "---",
    `azemark: ${document.version || "2"}`,
    ...(document.title.trim() ? [`title: ${JSON.stringify(document.title.trim())}`] : []),
    ...(document.authors.length ? [`author: ${JSON.stringify(document.authors)}`] : []),
    ...(document.date.trim() ? [`x-date: ${JSON.stringify(document.date.trim())}`] : []),
    ...(document.metadata.trim() ? [document.metadata.trim()] : []),
    "---",
  ];
  const body = cells.map((cell) => cell.source).filter((value) => value.trim()).join("\n\n");
  return `${lines.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

/** @param {{ source: string }} cell */
function label(cell) {
  const line = cell.source.split("\n").find((value) => value.trim())?.trim() ?? "";
  const heading = /^#{1,6}\s+(.+)$/.exec(line);
  const directive = /^::([\w-]+)/.exec(line);
  return (heading?.[1] ?? directive?.[1] ?? line.replace(/^[-*]\s+/, "")).slice(0, 72) || "Untitled Cell";
}
/** @param {{ source: string }} cell */
function kind(cell) {
  const directive = /^::[\w-]+/m.test(cell.source);
  const markdown = /(^|\n)(?!::)\S/.test(cell.source);
  return directive && markdown ? "Markdown + directive" : directive ? "Directive" : "Markdown";
}
function documentTitle() { return model.document.title.trim() || "Untitled document"; }

// ---------------------------------------------------------------------------
// Rendering

function updateChrome() {
  const name = documentTitle();
  for (const id of ["nav-document-title", "utility-title", "desktop-title", "preview-title"]) byId(id).textContent = name;
  byId("details-summary").textContent = [name, model.document.authors[0], model.document.date].filter(Boolean).join(" · ");
  byId("document-session").textContent = `This session · ${model.cells.length} ${model.cells.length === 1 ? "Cell" : "Cells"}`;
}

/** Source-changing document controls lock while a generation owns the document. */
function updateLockedControls() {
  const locked = model.mutationLocked;
  for (const field of /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */ ([el.title, el.author, el.date, el.metadata])) {
    field.disabled = locked;
  }
  /** @type {HTMLButtonElement} */ (byId("add-cell")).disabled = locked;
  /** @type {HTMLButtonElement} */ (byId("add-cell-bottom")).disabled = locked;
}

function renderDocument() {
  updateLockedControls();
  if (document.activeElement !== el.title) el.title.value = model.document.title;
  if (document.activeElement !== el.author) el.author.value = model.document.authors.join("\n");
  if (document.activeElement !== el.date) el.date.value = model.document.date;
  if (document.activeElement !== el.metadata) el.metadata.value = model.document.metadata;
  updateChrome();
}

function renderOutline() {
  const query = el.search.value.trim().toLocaleLowerCase();
  const matching = model.cells.filter((cell) =>
    `${label(cell)}\n${cell.source}\n${cell.pendingDescription}`.toLocaleLowerCase().includes(query));
  el.searchResult.textContent = query
    ? matching.length ? `${matching.length} matching ${matching.length === 1 ? "Cell" : "Cells"}` : "No matching Cells"
    : "";
  el.cellList.innerHTML = matching.map((cell) => {
    const index = model.cells.indexOf(cell);
    const descriptionMatch = query !== "" && cell.pendingDescription.toLocaleLowerCase().includes(query);
    return `<button type="button" data-cell-id="${cell.id}" tabindex="${cell.id === model.activeCellId ? "0" : "-1"}" aria-current="${cell.id === model.activeCellId}"><b>${String(index + 1).padStart(2, "0")}</b><span>${esc(label(cell))}<small>${esc(kind(cell))}${descriptionMatch ? " · Pending Description match" : ""}</small></span></button>`;
  }).join("");
}

/** @returns {{ cellId: string, role: string | null, action: string | null, start: number | null, end: number | null } | null} */
function focusSnapshot() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !el.cells.contains(active) || !active.dataset.cellId) return null;
  return {
    cellId: active.dataset.cellId,
    role: active.dataset.role ?? null,
    action: active.dataset.action ?? null,
    start: active instanceof HTMLTextAreaElement ? active.selectionStart : null,
    end: active instanceof HTMLTextAreaElement ? active.selectionEnd : null,
  };
}
/** @param {ReturnType<typeof focusSnapshot>} snapshot */
function restoreFocus(snapshot) {
  if (snapshot === null) return;
  let selector = `[data-cell-id="${snapshot.cellId}"]`;
  if (snapshot.role !== null) selector += `[data-role="${snapshot.role}"]`;
  else if (snapshot.action !== null) selector += `[data-action="${snapshot.action}"]`;
  const node = el.cells.querySelector(selector);
  if (!(node instanceof HTMLElement)) return;
  node.focus();
  if (snapshot.start !== null && node instanceof HTMLTextAreaElement) {
    node.setSelectionRange(snapshot.start, snapshot.end ?? snapshot.start);
  }
}

/** @param {"valid" | "invalid" | "stale"} status */
function proposalCopy(status) {
  return status === "valid"
    ? "Proposed Source is compiler-valid."
    : status === "invalid"
      ? "Proposed Source has compiler errors."
      : "Document changed; this proposal is out of date.";
}

/**
 * A Source or structural edit stales a surviving proposal without re-rendering
 * the editor (which would move focus), so the proposal panel is patched in place.
 */
function updateProposalState() {
  const proposal = model.proposal;
  for (const node of el.cells.querySelectorAll("[data-proposal-cell]")) {
    if (!(node instanceof HTMLElement)) continue;
    const status = proposal !== null && proposal.cellId === node.dataset.proposalCell ? proposal.status : null;
    if (status === null) continue;
    const heading = node.querySelector("h3");
    if (heading !== null) heading.textContent = `Draft Gate · ${status}`;
    const copy = node.querySelector("p");
    if (copy !== null) copy.textContent = proposalCopy(status);
    const apply = node.querySelector("[data-action=apply-proposal]");
    if (apply instanceof HTMLButtonElement) apply.disabled = status !== "valid";
  }
}

function renderCells() {
  const snapshot = focusSnapshot();
  el.cells.innerHTML = model.cells.map((cell, index) => {
    const proposal = model.proposal?.cellId === cell.id ? model.proposal : null;
    const generating = model.generation?.cellId === cell.id;
    const response = model.generationResponse?.cellId === cell.id ? model.generationResponse : null;
    const lock = model.mutationLocked ? "disabled" : "";
    const descriptionMode = cell.mode === "description";
    return `<article class="cell" id="cell-${cell.id}" data-cell-id="${cell.id}" data-active="${cell.id === model.activeCellId}">
  <header><div class="cell-heading"><span aria-hidden="true">⠿ ${String(index + 1).padStart(2, "0")}</span><strong>${esc(label(cell))}</strong></div><div class="cell-actions"><button type="button" data-action="move-up" data-cell-id="${cell.id}" ${index === 0 || model.mutationLocked ? "disabled" : ""}>↑ <span class="visually-hidden">Move up</span></button><button type="button" data-action="move-down" data-cell-id="${cell.id}" ${index === model.cells.length - 1 || model.mutationLocked ? "disabled" : ""}>↓ <span class="visually-hidden">Move down</span></button><button type="button" data-action="insert-before" data-cell-id="${cell.id}" ${lock}>＋↑ <span class="visually-hidden">Add before</span></button><button type="button" data-action="insert-after" data-cell-id="${cell.id}" ${lock}>＋↓ <span class="visually-hidden">Add after</span></button><button type="button" data-action="delete" data-cell-id="${cell.id}" ${lock}>× <span class="visually-hidden">Delete Cell</span></button></div></header>
  <div class="editor-tabs" role="tablist" aria-label="Cell editor mode"><button type="button" role="tab" aria-selected="${!descriptionMode}" data-action="mode-source" data-cell-id="${cell.id}">Source</button><button type="button" role="tab" aria-selected="${descriptionMode}" data-action="mode-description" data-cell-id="${cell.id}">Description</button><small data-role="size" data-cell-id="${cell.id}">${cell.source.length} chars</small></div>
  <div data-panel="source" ${descriptionMode ? "hidden" : ""}><textarea data-role="source" data-cell-id="${cell.id}" aria-label="Cell ${index + 1} AzeMark Source" spellcheck="false" ${model.mutationLocked ? "disabled" : ""}>${esc(cell.source)}</textarea></div>
  <div class="description-panel" data-panel="description" ${descriptionMode ? "" : "hidden"}><textarea data-role="description" data-cell-id="${cell.id}" aria-label="Cell ${index + 1} Description" placeholder="Describe the AzeMark Source to generate">${esc(cell.pendingDescription)}</textarea><div class="description-actions"><button type="button" data-action="back-source" data-cell-id="${cell.id}">Back to Source</button><button type="button" data-action="${generating ? "cancel-generation" : "generate"}" data-cell-id="${cell.id}" ${!generating && (model.proposal !== null || capabilities?.service?.authoring?.available !== true) ? "disabled" : ""}>${generating ? "Cancel generation" : "Generate AzeMark Source"}</button></div></div>
  ${proposal ? `<section class="proposal" data-proposal-cell="${cell.id}" aria-labelledby="proposal-${cell.id}"><h3 id="proposal-${cell.id}">Draft Gate · ${proposal.status}</h3><p>${proposalCopy(proposal.status)}</p><textarea readonly aria-label="Proposed AzeMark Source" spellcheck="false">${esc(proposal.source)}</textarea><footer><button type="button" data-action="discard-proposal" data-cell-id="${cell.id}">Discard</button><button type="button" data-action="apply-proposal" data-cell-id="${cell.id}" ${proposal.status !== "valid" ? "disabled" : ""}>Apply</button></footer></section>` : ""}
  ${response ? `<section class="proposal generation-response"><h3>${response.kind === "clarification" ? "Clarification needed" : response.kind === "refusal" ? "Request refused" : "Generation failed"}</h3><p>${esc(response.message)}</p><button type="button" data-action="${response.kind === "refusal" ? "dismiss-response" : "revise-description"}" data-cell-id="${cell.id}">${response.kind === "refusal" ? "Dismiss" : "Return to Description"}</button></section>` : ""}
</article>`;
  }).join("");
  renderOutline();
  updateChrome();
  updateLockedControls();
  renderSourceMeta();
  renderPreview();
  restoreFocus(snapshot);
}

function renderSourceMeta() {
  const bytes = new TextEncoder().encode(assembledSource()).length;
  el.sourceMeta.textContent = `Revision ${model.revision} · ${bytes} bytes`;
}

function renderPreview() {
  const preview = model.preview;
  el.previewState.textContent = preview.message;
  el.expandedPreviewState.textContent = preview.message;
  el.previewState.dataset.state = preview.status;
  el.refresh.disabled = preview.status === "refreshing";
  el.refresh.textContent = preview.status === "refreshing" ? "Refreshing…" : "Refresh preview";
  el.expand.disabled = preview.artifact === null;
  const available = preview.artifact !== null;
  el.preview.hidden = !available;
  el.previewPlaceholder.hidden = available;
  byId("view-preview-diagnostics").hidden = preview.status !== "blocked";
  el.preview.title = `Document preview — ${preview.status === "stale" ? "out of date" : preview.status}`;
  const url = preview.artifact?.url ?? null;
  if (url !== null) {
    if (el.preview.getAttribute("src") !== url) el.preview.src = url;
    if (el.expandedPreview.getAttribute("src") !== url) el.expandedPreview.src = url;
  }
  el.separator.setAttribute("aria-valuemin", String(minPreview()));
  el.separator.setAttribute("aria-valuemax", String(Math.round(maxPreview())));
  el.separator.setAttribute("aria-valuenow", String(Math.round(el.previewSection.getBoundingClientRect().height || 0)));
  if (preview.height !== null) el.previewSection.style.setProperty("--preview-height", `${preview.height}px`);
}

function renderDiagnostics() {
  const severityRank = /** @param {string} severity */ (severity) =>
    severity === "error" ? 0 : severity === "warning" ? 1 : severity === "info" ? 2 : 3;
  const diagnostics = [...model.diagnostics].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const analyze = model.operations.analyze;
  el.diagnosticsSummary.textContent = analyze?.status === "running"
    ? "Analyzing…"
    : analyze?.status === "failed"
      ? "Analysis failed"
      : diagnostics.length ? `${errors} error · ${warnings} warning` : "Valid";
  el.diagnosticsTitle.textContent = diagnostics.length ? `${diagnostics.length} diagnostics` : "No diagnostics";
  el.diagnosticsList.innerHTML = diagnostics.length
    ? diagnostics.map((diagnostic) => `<article class="diagnostic" data-severity="${esc(diagnostic.severity)}"><strong>${esc(diagnostic.severity)} · ${esc(diagnostic.code ?? "")}</strong><p>${esc(diagnostic.message)}</p>${diagnostic.location?.range ? `<button type="button" data-diagnostic="${model.diagnostics.indexOf(diagnostic)}">Line ${diagnostic.location.range.start.line}, column ${diagnostic.location.range.start.column}</button>` : ""}</article>`).join("")
    : "<p>No diagnostics.</p>";
}

// ---------------------------------------------------------------------------
// Focus and navigation

/** @param {string} id */
function focusEditor(id) {
  const cell = model.cells.find((candidate) => candidate.id === id);
  const role = cell?.mode === "description" ? "description" : "source";
  const node = document.querySelector(`[data-role=${role}][data-cell-id="${id}"]`);
  if (node instanceof HTMLElement) { node.scrollIntoView({ block: "center" }); node.focus(); }
}

/** @param {string} id */
function focusCell(id) {
  dispatch({ type: "cell.activate", cellId: id });
  renderOutline();
  focusEditor(id);
  if (matchMedia("(max-width:1199px)").matches) closeDrawer();
}

function closeDrawer() {
  el.workspace.dataset.navOpen = "false";
  el.drawerScrim.hidden = true;
  const nav = byId("document-navigation");
  nav.removeAttribute("role");
  nav.removeAttribute("aria-modal");
  const main = byId("main-workspace");
  main.inert = false;
  const rail = document.querySelector(".app-rail");
  if (rail instanceof HTMLElement) rail.inert = false;
  byId("open-document-nav").focus();
}
function openDrawer() {
  el.workspace.dataset.navOpen = "true";
  el.drawerScrim.hidden = false;
  const nav = byId("document-navigation");
  nav.setAttribute("role", "dialog");
  nav.setAttribute("aria-modal", "true");
  byId("main-workspace").inert = true;
  const rail = document.querySelector(".app-rail");
  if (rail instanceof HTMLElement) rail.inert = true;
  const target = el.search.value ? el.search : nav;
  target.setAttribute("tabindex", "-1");
  target.focus();
}

function openDiagnostics() {
  el.diagnostics.hidden = false;
  byId("diagnostics-toggle").setAttribute("aria-expanded", "true");
  byId("diagnostics-title").focus();
}
function closeDiagnostics() {
  el.diagnostics.hidden = true;
  byId("diagnostics-toggle").setAttribute("aria-expanded", "false");
  byId("diagnostics-toggle").focus();
}

/** @param {HTMLElement} menu @param {HTMLElement} trigger */
function toggleMenu(menu, trigger) {
  const open = menu.hidden;
  el.exportMenu.hidden = true;
  el.moreMenu.hidden = true;
  menu.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    const first = menu.querySelector("button:not(:disabled)");
    if (first instanceof HTMLElement) first.focus();
  }
}
/** @param {KeyboardEvent} event @param {HTMLElement} menu @param {HTMLElement} trigger */
function menuKeys(event, menu, trigger) {
  const items = /** @type {HTMLButtonElement[]} */ ([...menu.querySelectorAll("button:not(:disabled)")]);
  if (items.length === 0) return;
  const current = items.indexOf(/** @type {HTMLButtonElement} */ (event.target));
  let next = current;
  if (event.key === "ArrowDown") next = (current + 1) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (event.key === "Escape") {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
    event.preventDefault();
    return;
  } else return;
  event.preventDefault();
  items[next]?.focus();
}

// ---------------------------------------------------------------------------
// Operations

/** @param {HTMLIFrameElement} frame @param {string} url */
function loadFrame(frame, url) {
  return new Promise((resolve, reject) => {
    frame.addEventListener("load", () => resolve(undefined), { once: true });
    frame.addEventListener("error", () => reject(new Error("Preview Artifact could not be loaded.")), { once: true });
    frame.src = url;
  });
}

async function refreshPreview() {
  const requestId = crypto.randomUUID();
  dispatch({ type: "preview.start", requestId });
  renderPreview();
  announce("Refreshing preview");
  const revision = model.revision;
  const theme = model.theme;
  try {
    const accepted = await submitJob({
      protocolVersion: 1, requestId, revision: String(revision), operation: "compile", format: "html",
      ...(theme === "default" ? {} : { theme }),
      source: { text: assembledSource(), name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, accepted.pollAfterMs);
    if (model.preview.request?.requestId !== requestId) return;
    if (job.result?.ok !== true || !job.result.artifact) {
      dispatch({ type: "diagnostics.set", diagnostics: job.result?.diagnostics ?? [] });
      dispatch({ type: "preview.fail", requestId, message: "Preview blocked by Source errors", blocked: true });
      renderDiagnostics();
      renderPreview();
      announce("Preview blocked by Source errors");
      return;
    }
    const bytes = await artifact(job.jobId);
    if (model.preview.request?.requestId !== requestId) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: job.result.artifact.mimeType }));
    try {
      await loadFrame(el.preview, url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    if (model.preview.request?.requestId !== requestId) { URL.revokeObjectURL(url); return; }
    const previous = displayedPreviewUrl;
    dispatch({ type: "preview.resolve", requestId, artifact: { url, bytes: bytes.byteLength } });
    displayedPreviewUrl = url;
    if (previous !== null && previous !== url) URL.revokeObjectURL(previous);
    renderPreview();
    announce("Preview updated");
  } catch (error) {
    if (model.preview.request?.requestId !== requestId) return;
    dispatch({ type: "preview.fail", requestId, message: error instanceof Error ? error.message : "Preview failed", blocked: false });
    renderPreview();
    announce(model.preview.message);
  }
}

async function analyze() {
  const requestId = crypto.randomUUID();
  dispatch({ type: "analysis.start", requestId });
  renderDiagnostics();
  try {
    const accepted = await submitJob({
      protocolVersion: 1, requestId, revision: String(model.revision), operation: "analyze",
      source: { text: assembledSource(), name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, accepted.pollAfterMs);
    if (model.operations.analyze?.requestId !== requestId) return;
    dispatch({ type: "analysis.resolve", requestId, diagnostics: job.result?.diagnostics ?? [] });
    renderDiagnostics();
    announce(model.diagnostics.length ? "Analysis complete with diagnostics" : "Analysis complete: no diagnostics");
  } catch (error) {
    if (model.operations.analyze?.requestId !== requestId) return;
    dispatch({ type: "analysis.fail", requestId, message: error instanceof Error ? error.message : "Analysis failed" });
    renderDiagnostics();
    announce(model.operations.analyze?.message ?? "Analysis failed");
  }
}

/** @param {string} format */
async function exportFormat(format) {
  const requestId = crypto.randomUUID();
  dispatch({ type: "export.start", requestId, format });
  announce(`Exporting ${format.toUpperCase()}`);
  const revision = model.revision;
  const theme = model.theme;
  try {
    const accepted = await submitJob({
      protocolVersion: 1, requestId, revision: String(revision), operation: "compile", format,
      ...(theme === "default" ? {} : { theme }),
      source: { text: assembledSource(), name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, accepted.pollAfterMs);
    if (model.operations.export?.requestId !== requestId) return;
    if (job.result?.ok !== true || !job.result.artifact) {
      dispatch({ type: "diagnostics.set", diagnostics: job.result?.diagnostics ?? [] });
      dispatch({ type: "export.fail", requestId, message: "Export blocked by Source errors" });
      renderDiagnostics();
      openDiagnostics();
      announce("Export blocked by Source errors");
      return;
    }
    const bytes = await artifact(job.jobId);
    const url = URL.createObjectURL(new Blob([bytes], { type: job.result.artifact.mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `document.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    dispatch({ type: "export.resolve", requestId });
    announce(`${format.toUpperCase()} export complete`);
  } catch (error) {
    if (model.operations.export?.requestId !== requestId) return;
    dispatch({ type: "export.fail", requestId, message: error instanceof Error ? error.message : "Export failed" });
    announce(model.operations.export?.message ?? "Export failed");
  }
}

async function formatSource() {
  const requestId = crypto.randomUUID();
  dispatch({ type: "format.start", requestId });
  announce("Formatting Source");
  try {
    const accepted = await submitJob({
      protocolVersion: 1, requestId, revision: String(model.revision), operation: "format",
      source: { text: assembledSource(), name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, accepted.pollAfterMs);
    if (model.operations.format?.requestId !== requestId) return;
    if (job.result?.ok !== true || !job.result.proposal) {
      dispatch({ type: "diagnostics.set", diagnostics: job.result?.diagnostics ?? [] });
      dispatch({ type: "format.fail", requestId, message: "Source errors block formatting" });
      renderDiagnostics();
      openDiagnostics();
      return;
    }
    dispatch({ type: "format.resolve", requestId, source: job.result.proposal.source });
    const proposal = model.formatProposal;
    if (proposal === null) return;
    el.formattedSource.value = proposal.source;
    el.proposalMessage.textContent = "Review the compiler's Formatted Source. Applying replaces the Current document Source.";
    el.proposalDialog.showModal();
  } catch (error) {
    if (model.operations.format?.requestId !== requestId) return;
    dispatch({ type: "format.fail", requestId, message: error instanceof Error ? error.message : "Formatting failed" });
    announce(model.operations.format?.message ?? "Formatting failed");
  }
}

function applyFormatProposal() {
  const proposal = model.formatProposal;
  if (proposal === null || proposal.status !== "open" || proposal.capturedRevision !== model.revision) return;
  const parsed = parseDocument(proposal.source);
  if (parsed.sources.length !== model.cells.length) {
    el.proposalMessage.textContent = "Formatted Source cannot apply because it would change Cell boundaries.";
    return;
  }
  dispatch({ type: "document.replace", document: parsed.document, sources: parsed.sources });
  el.proposalDialog.close();
  renderDocument();
  renderCells();
  renderSourceMeta();
  renderDiagnostics();
  announce("Formatted Source applied");
  void analyze();
}

/** @param {string} cellId */
async function generate(cellId) {
  const cell = model.cells.find((candidate) => candidate.id === cellId);
  if (cell === undefined || !cell.pendingDescription.trim()) return;
  const requestId = crypto.randomUUID();
  dispatch({ type: "generation.start", cellId, requestId });
  generationController = new AbortController();
  renderCells();
  announce("Generating AzeMark Source");
  try {
    const draft = await request("POST", "/v1/authoring/drafts", {
      body: JSON.stringify({ protocolVersion: 1, requestId, description: cell.pendingDescription.trim() }),
      contentType: "application/json",
      signal: generationController.signal,
    });
    const outcome = /** @type {import("./workspace-state.js").GenerationOutcome} */ (
      draft.outcome === "source"
        ? { kind: "source", source: draft.source.text, valid: draft.analysis?.valid === true, diagnostics: draft.analysis?.diagnostics ?? [] }
        : draft.outcome === "clarification"
          ? { kind: "clarification", message: draft.question ?? "More detail is needed." }
          : { kind: "refusal", message: draft.message ?? "The request was refused." }
    );
    dispatch({ type: "generation.resolve", requestId, outcome });
    renderCells();
    announce(outcome.kind === "source" ? "Proposed Source is ready for review" : outcome.message);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (model.generation === null) return;
    dispatch({ type: "generation.resolve", requestId, outcome: { kind: "failure", message: error instanceof Error ? error.message : "Generation failed" } });
    renderCells();
    announce("Generation failed");
  } finally {
    generationController = null;
  }
}

// ---------------------------------------------------------------------------
// Preview sizing

function minPreview() { return matchMedia("(max-width:1199px)").matches ? 160 : 180; }
function maxPreview() { return innerHeight * (matchMedia("(max-width:1199px)").matches ? 0.5 : 0.6); }
/** @param {number} height */
function setPreviewHeight(height) {
  const clamped = Math.round(Math.min(maxPreview(), Math.max(minPreview(), height)));
  dispatch({ type: "preview.resize", height: clamped });
  el.previewSection.style.setProperty("--preview-height", `${clamped}px`);
  el.separator.setAttribute("aria-valuenow", String(clamped));
  sessionStorage.setItem(PREVIEW_HEIGHT_KEY, String(clamped));
}

// ---------------------------------------------------------------------------
// Wiring

function bind() {
  el.gateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    token = el.gateToken.value.trim();
    if (!token) return;
    sessionStorage.setItem(TOKEN_KEY, token);
    void enter();
  });
  byId("signout").addEventListener("click", () => { sessionStorage.removeItem(TOKEN_KEY); location.reload(); });

  for (const field of [el.title, el.author, el.date, el.metadata]) {
    field.addEventListener("input", () => {
      dispatch({ type: "document.edit", patch: {
        title: el.title.value,
        authors: el.author.value.split("\n").map((value) => value.trim()).filter(Boolean),
        date: el.date.value,
        metadata: el.metadata.value,
      } });
      renderSourceMeta();
      renderPreview();
      updateChrome();
      updateProposalState();
    });
  }

  el.search.addEventListener("input", renderOutline);
  el.cellList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-cell-id]") : null;
    if (button instanceof HTMLButtonElement && button.dataset.cellId) focusCell(button.dataset.cellId);
  });
  el.cellList.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) return;
    const buttons = /** @type {HTMLButtonElement[]} */ ([...el.cellList.querySelectorAll("button")]);
    const current = buttons.indexOf(/** @type {HTMLButtonElement} */ (event.target));
    let next = current;
    if (event.key === "ArrowDown") next = Math.min(current + 1, buttons.length - 1);
    if (event.key === "ArrowUp") next = Math.max(current - 1, 0);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (event.key === "Enter") { buttons[current]?.click(); return; }
    event.preventDefault();
    buttons[next]?.focus();
  });

  el.cells.addEventListener("input", (event) => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || !area.dataset.cellId) return;
    if (area.dataset.role === "source") {
      const before = model;
      dispatch({ type: "source.edit", cellId: area.dataset.cellId, source: area.value });
      if (model === before) return;
      const size = el.cells.querySelector(`[data-role=size][data-cell-id="${area.dataset.cellId}"]`);
      if (size instanceof HTMLElement) size.textContent = `${area.value.length} chars`;
      renderOutline();
      renderSourceMeta();
      renderPreview();
      updateProposalState();
    } else if (area.dataset.role === "description") {
      dispatch({ type: "description.edit", cellId: area.dataset.cellId, description: area.value });
      renderOutline();
    }
  });

  el.cells.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.cellId) {
      const changed = model.activeCellId !== target.dataset.cellId;
      dispatch({ type: "cell.activate", cellId: target.dataset.cellId });
      if (changed) renderOutline();
    }
  });

  el.cells.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
    if (!(button instanceof HTMLButtonElement) || !button.dataset.cellId) return;
    const id = button.dataset.cellId;
    const index = model.cells.findIndex((cell) => cell.id === id);
    switch (button.dataset.action) {
      case "mode-source":
      case "mode-description":
      case "back-source": {
        const mode = button.dataset.action === "mode-description" ? "description" : "source";
        dispatch({ type: "cell.activate", cellId: id });
        dispatch({ type: "editor.mode", cellId: id, mode });
        renderCells();
        focusEditor(id);
        break;
      }
      case "move-up":
        dispatch({ type: "cell.move", cellId: id, index: index - 1 });
        renderCells();
        focusEditor(id);
        announce(`Cell moved to position ${index}`);
        break;
      case "move-down":
        dispatch({ type: "cell.move", cellId: id, index: index + 1 });
        renderCells();
        focusEditor(id);
        announce(`Cell moved to position ${index + 2}`);
        break;
      case "insert-before":
        dispatch({ type: "cell.insert", cell: newCell(), index });
        renderCells();
        focusEditor(model.activeCellId ?? "");
        announce("Cell added");
        break;
      case "insert-after":
        dispatch({ type: "cell.insert", cell: newCell(), index: index + 1 });
        renderCells();
        focusEditor(model.activeCellId ?? "");
        announce("Cell added");
        break;
      case "delete": {
        dispatch({ type: "cell.delete", cellId: id });
        renderCells();
        el.undoBar.hidden = false;
        if (model.activeCellId !== null) focusEditor(model.activeCellId);
        else byId("add-cell-bottom").focus();
        announce("Cell deleted. Undo available.");
        break;
      }
      case "generate":
        void generate(id);
        break;
      case "cancel-generation":
        generationController?.abort();
        dispatch({ type: "generation.cancel" });
        renderCells();
        focusEditor(id);
        announce("Generation cancelled");
        break;
      case "apply-proposal":
        dispatch({ type: "proposal.apply" });
        renderCells();
        focusEditor(id);
        announce("Proposed Source applied");
        void analyze();
        break;
      case "discard-proposal":
        dispatch({ type: "proposal.discard" });
        renderCells();
        focusEditor(id);
        break;
      case "dismiss-response":
        dispatch({ type: "response.dismiss", cellId: id });
        renderCells();
        focusEditor(id);
        break;
      case "revise-description":
        dispatch({ type: "response.dismiss", cellId: id });
        dispatch({ type: "editor.mode", cellId: id, mode: "description" });
        renderCells();
        focusEditor(id);
        break;
    }
  });

  el.cells.addEventListener("keydown", (event) => {
    const tab = event.target;
    if (!(tab instanceof HTMLButtonElement) || tab.getAttribute("role") !== "tab") return;
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const tabs = /** @type {HTMLButtonElement[]} */ ([.../** @type {HTMLElement} */ (tab.closest("[role=tablist]")).querySelectorAll("[role=tab]")]);
    const position = tabs.indexOf(tab);
    const next = tabs[(position + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    event.preventDefault();
    next?.focus();
  });

  const addCell = () => {
    dispatch({ type: "cell.insert", cell: newCell(), index: model.cells.length });
    renderCells();
    focusEditor(model.activeCellId ?? "");
    announce("Cell added");
  };
  byId("add-cell").addEventListener("click", addCell);
  byId("add-cell-bottom").addEventListener("click", addCell);
  byId("undo-delete").addEventListener("click", () => {
    dispatch({ type: "cell.undoDelete" });
    renderCells();
    el.undoBar.hidden = true;
    if (model.activeCellId !== null) focusEditor(model.activeCellId);
    announce("Cell restored");
  });

  el.theme.addEventListener("change", () => {
    const before = model.theme;
    dispatch({ type: "theme.change", theme: el.theme.value || "default" });
    if (model.theme === before) return;
    renderPreview();
    announce("Preview out of date");
  });
  el.refresh.addEventListener("click", () => void refreshPreview());
  byId("expanded-refresh").addEventListener("click", () => void refreshPreview());
  el.expand.addEventListener("click", () => el.previewDialog.showModal());
  byId("close-preview-dialog").addEventListener("click", () => el.previewDialog.close());
  byId("view-preview-diagnostics").addEventListener("click", openDiagnostics);

  el.exportToggle.addEventListener("click", () => toggleMenu(el.exportMenu, el.exportToggle));
  el.moreToggle.addEventListener("click", () => toggleMenu(el.moreMenu, el.moreToggle));
  el.exportMenu.addEventListener("keydown", (event) => menuKeys(event, el.exportMenu, el.exportToggle));
  el.moreMenu.addEventListener("keydown", (event) => menuKeys(event, el.moreMenu, el.moreToggle));
  byId("analyze").addEventListener("click", () => { el.moreMenu.hidden = true; el.moreToggle.setAttribute("aria-expanded", "false"); void analyze(); });
  byId("format").addEventListener("click", () => { el.moreMenu.hidden = true; el.moreToggle.setAttribute("aria-expanded", "false"); void formatSource(); });
  el.exportMenu.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-format]") : null;
    if (button instanceof HTMLButtonElement && !button.disabled) {
      el.exportMenu.hidden = true;
      el.exportToggle.setAttribute("aria-expanded", "false");
      void exportFormat(button.dataset.format ?? "html");
    }
  });

  byId("diagnostics-toggle").addEventListener("click", () => el.diagnostics.hidden ? openDiagnostics() : closeDiagnostics());
  byId("close-diagnostics").addEventListener("click", closeDiagnostics);
  el.diagnosticsList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-diagnostic]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const range = model.diagnostics[Number(button.dataset.diagnostic)]?.location?.range;
    if (!range) return;
    const source = assembledSource();
    const startIndex = indexForPosition(source, range.start);
    const endIndex = indexForPosition(source, range.end);
    let offset = 0;
    for (const cell of model.cells) {
      const start = source.indexOf(cell.source, offset);
      if (start < 0) continue;
      const end = start + cell.source.length;
      if (startIndex >= start && startIndex <= end) {
        focusCell(cell.id);
        const area = document.querySelector(`[data-role=source][data-cell-id="${cell.id}"]`);
        if (area instanceof HTMLTextAreaElement) {
          area.setSelectionRange(Math.max(0, startIndex - start), Math.min(cell.source.length, endIndex - start));
        }
        break;
      }
      offset = end;
    }
  });

  byId("open-document-nav").addEventListener("click", openDrawer);
  byId("close-document-nav").addEventListener("click", closeDrawer);
  el.drawerScrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (el.workspace.dataset.navOpen !== "true") return;
    if (event.key === "Escape") { closeDrawer(); return; }
    if (event.key !== "Tab") return;
    const nav = byId("document-navigation");
    const focusable = [...nav.querySelectorAll("button:not(:disabled),input:not(:disabled)")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); if (last instanceof HTMLElement) last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); if (first instanceof HTMLElement) first.focus(); }
  });
  byId("current-document").addEventListener("click", () => {
    el.details.open = true;
    el.title.scrollIntoView({ block: "center" });
    el.title.focus();
  });

  byId("service-health").addEventListener("click", () => el.serviceDialog.showModal());
  byId("close-service").addEventListener("click", () => el.serviceDialog.close());
  byId("close-proposal").addEventListener("click", () => el.proposalDialog.close());
  byId("discard-format").addEventListener("click", () => { dispatch({ type: "format.discard" }); el.proposalDialog.close(); });
  byId("apply-format").addEventListener("click", applyFormatProposal);

  let startY = 0;
  let startHeight = 0;
  el.separator.addEventListener("pointerdown", (event) => {
    startY = event.clientY;
    startHeight = el.previewSection.getBoundingClientRect().height;
    el.separator.setPointerCapture(event.pointerId);
  });
  el.separator.addEventListener("pointermove", (event) => {
    if (!el.separator.hasPointerCapture(event.pointerId)) return;
    setPreviewHeight(startHeight + event.clientY - startY);
  });
  el.separator.addEventListener("pointerup", (event) => el.separator.releasePointerCapture(event.pointerId));
  el.separator.addEventListener("dblclick", () => setPreviewHeight(innerHeight * (matchMedia("(max-width:1199px)").matches ? 0.30 : 0.28)));
  el.separator.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 64 : 16;
    const current = el.previewSection.getBoundingClientRect().height;
    if (event.key === "ArrowUp") setPreviewHeight(current - step);
    else if (event.key === "ArrowDown") setPreviewHeight(current + step);
    else if (event.key === "Home") setPreviewHeight(minPreview());
    else if (event.key === "End") setPreviewHeight(maxPreview());
    else if (event.key === "Enter") setPreviewHeight(innerHeight * (matchMedia("(max-width:1199px)").matches ? 0.30 : 0.28));
    else return;
    event.preventDefault();
  });
}

function newCell() {
  return { id: crypto.randomUUID(), source: "", lastAppliedSource: "", pendingDescription: "", mode: /** @type {"source"} */ ("source") };
}

function renderAll() {
  renderDocument();
  renderCells();
  renderSourceMeta();
  renderDiagnostics();
  renderPreview();
}

async function enter() {
  try {
    capabilities = await request("GET", "/v1/capabilities");
    el.theme.innerHTML = capabilities.compiler.themes
      .map((/** @type {any} */ theme) => `<option value="${esc(theme.id)}">${esc(theme.title)}</option>`).join("");
    el.exportMenu.innerHTML = ["html", "svg", "png", "pdf"].map((format) => {
      const supported = capabilities.compiler.formats.some((/** @type {any} */ entry) => (entry.id ?? entry) === format);
      return `<button role="menuitem" type="button" data-format="${format}" ${supported ? "" : "disabled"}>${format.toUpperCase()}${supported ? "" : " — unavailable"}</button>`;
    }).join("");
    el.serviceMeta.textContent = `Compiler ${capabilities.compatibility.compilerRelease}. Protocol ${capabilities.protocol.version}. Authoring ${capabilities.service.authoring?.available ? "available" : "unavailable"}.`;
    const examples = await (await fetch("/examples.json")).json();
    const parsed = parseDocument(examples[0]?.source ?? "---\nazemark: 2\n---\n");
    model = createWorkspaceState(
      parsed.sources.map((source) => ({ id: crypto.randomUUID(), source, lastAppliedSource: source, pendingDescription: "", mode: /** @type {"source"} */ ("source") })),
      el.theme.value || "default",
      parsed.document,
    );
    const stored = Number(sessionStorage.getItem(PREVIEW_HEIGHT_KEY));
    if (Number.isFinite(stored) && stored > 0) dispatch({ type: "preview.resize", height: stored });
    el.gate.hidden = true;
    el.workspace.hidden = false;
    renderAll();
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    el.gate.hidden = false;
    el.gateError.textContent = error instanceof Error ? error.message : "Could not open workspace";
    el.gateToken.focus();
  }
}

bind();
if (token) void enter();
else el.gateToken.focus();
