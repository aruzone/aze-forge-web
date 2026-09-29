// @ts-check
import { createWorkspaceState, hasMetadata, transition } from "./workspace-state.js";
import { STARTER_CELLS, starterDocument } from "./starter.js";
import { importSourceLimit, parseImportSource, splitCellSources } from "./document-import.js";
import { indexForPosition } from "./coordinates.js";
import { splitFrontMatter, stripFrontMatter } from "./front-matter.js";

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
  importInput: /** @type {HTMLInputElement} */ (byId("import-file")),
  proposalDialog: /** @type {HTMLDialogElement} */ (byId("proposal-dialog")),
  formattedSource: /** @type {HTMLTextAreaElement} */ (byId("formatted-source")),
  proposalMessage: byId("proposal-message"),
  undoBar: byId("undo-bar"), drawerScrim: /** @type {HTMLButtonElement} */ (byId("drawer-scrim")),
  serviceDialog: /** @type {HTMLDialogElement} */ (byId("service-dialog")), serviceMeta: byId("service-meta"),
  feedback: {
    title: byId("feedback-title"), author: byId("feedback-author"),
    date: byId("feedback-date"), metadata: byId("feedback-metadata"),
  },
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

/**
 * Split a complete AzeMark Source into the Current document and its Cell
 * sources. Front matter is document-level; Cell boundaries are top-level
 * headings, matching the design.
 * @param {string} source
 * @returns {{ document: CurrentDocument, sources: string[] }}
 */
function parseDocument(source) {
  const { document, body } = splitFrontMatter(source);
  return { document, sources: splitCellSources(body) };
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

// AzeMark opens a directive envelope with four colons; the name is the rest of
// that line. Mirrored from the compiler's own fence grammar.
const DIRECTIVE_OPEN = /^ {0,3}::::[ \t]*([^ \t:]*)[ \t]*$/;
const DIRECTIVE_FENCE = /^ {0,3}::::/;
const DIRECTIVE_CLOSE = /^ {0,3}::::[ \t]*$/;

/** @param {{ source: string }} cell */
function label(cell) {
  const line = cell.source.split("\n").find((value) => value.trim())?.trim() ?? "";
  const heading = /^#{1,6}\s+(.+)$/.exec(line);
  const directive = DIRECTIVE_OPEN.exec(line) ?? DIRECTIVE_FENCE.exec(line);
  return (heading?.[1] ?? directive?.[1] ?? line.replace(/^[-*]\s+/, "")).slice(0, 72) || "Untitled cell";
}
/**
 * The content kind of one Cell: directive envelopes contribute nothing, so a
 * Cell holding only an envelope is a directive and one with prose outside it is
 * both.
 * @param {{ source: string }} cell
 */
function kind(cell) {
  let directive = false;
  let inside = false;
  let prose = false;
  for (const line of cell.source.split("\n")) {
    if (!inside && DIRECTIVE_FENCE.test(line)) {
      directive = true;
      inside = !DIRECTIVE_CLOSE.test(line);
      continue;
    }
    if (inside) {
      if (DIRECTIVE_CLOSE.test(line)) inside = false;
      continue;
    }
    if (line.trim() !== "") prose = true;
  }
  return directive && prose ? "Markdown + directive" : directive ? "Directive" : "Markdown";
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

/**
 * Document details is one disclosure, not a form in the canvas: it opens for
 * metadata that is still empty, and stays collapsed once the document carries
 * meaningful metadata. Metadata diagnostics force it open as they arrive.
 */
function syncDetailsDisclosure() {
  if (!hasMetadata(model.document)) el.details.open = true;
}

/** Source-changing document controls lock while a generation owns the document. */
function updateLockedControls() {
  const locked = model.mutationLocked;
  for (const field of /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */ ([el.title, el.author, el.date, el.metadata])) {
    field.disabled = locked;
  }
  /** @type {HTMLButtonElement} */ (byId("add-cell")).disabled = locked;
  /** @type {HTMLButtonElement} */ (byId("add-cell-bottom")).disabled = locked;
  /** @type {HTMLButtonElement} */ (byId("import-document")).disabled = locked;
  /** @type {HTMLButtonElement} */ (byId("new-document")).disabled = locked;
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
    ? matching.length ? `${matching.length} matching ${matching.length === 1 ? "Cell" : "Cells"}` : "No matching cells"
    : "";
  // One roving tab stop: the active Cell when it is listed, otherwise the first match.
  const tabbable = matching.some((cell) => cell.id === model.activeCellId) ? model.activeCellId : matching[0]?.id ?? null;
  el.cellList.innerHTML = matching.map((cell) => {
    const index = model.cells.indexOf(cell);
    const text = label(cell);
    const origin = query === ""
      ? ""
      : cell.pendingDescription.toLocaleLowerCase().includes(query) ? " · Pending Description match"
        : cell.source.toLocaleLowerCase().includes(query) ? " · Source match"
          : text.toLocaleLowerCase().includes(query) ? " · Label match"
            : "";
    return `<button type="button" data-cell-id="${cell.id}" tabindex="${cell.id === tabbable ? "0" : "-1"}" aria-current="${cell.id === model.activeCellId}"><b>${String(index + 1).padStart(2, "0")}</b><span>${esc(text)}<small>${esc(kind(cell))}${origin}</small></span></button>`;
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
  else if (snapshot.action !== null) {
    // Generate becomes Cancel generation on the same Cell; keep focus there.
    const action = snapshot.action === "generate" ? '[data-action="generate"],[data-action="cancel-generation"]' : `[data-action="${snapshot.action}"]`;
    selector += action;
  }
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

/** @param {import("./workspace-state.js").Diagnostic} diagnostic */
function diagnosticHeadline(diagnostic) {
  return `<strong>${esc(diagnostic.severity)} · ${esc(diagnostic.code ?? "")}</strong>`;
}

/**
 * The compiler's own reason a proposal cannot be applied, so the author can act
 * on it instead of guessing. Document diagnostics stay authoritative for a
 * proposal that is valid.
 * @param {import("./workspace-state.js").Proposal} proposal
 */
function proposalReasons(proposal) {
  if (proposal.status === "valid" || proposal.diagnostics.length === 0) return "";
  const items = proposal.diagnostics.map((diagnostic) =>
    `<li data-severity="${esc(diagnostic.severity)}">${diagnosticHeadline(diagnostic)} ${esc(diagnostic.message)}</li>`).join("");
  return `<ul class="proposal-diagnostics">${items}</ul>`;
}

/**
 * A Description edit does not re-render the Cell (that would move the caret out
 * of the field), so the Generate affordance is re-evaluated here: it is enabled
 * only with a non-empty Description, no open proposal, and an available
 * authoring capability.
 * @param {string} cellId
 */
function updateGenerateAction(cellId) {
  const cell = model.cells.find((candidate) => candidate.id === cellId);
  const button = el.cells.querySelector(`[data-action="generate"][data-cell-id="${cellId}"]`);
  if (cell === undefined || !(button instanceof HTMLButtonElement)) return;
  button.disabled = cell.pendingDescription.trim() === ""
    || model.proposal !== null
    || capabilities?.service?.authoring?.available !== true;
}

/**
 * A Source or structural edit stales a surviving proposal without re-rendering
 * the editor (which would move focus), so the proposal panel is patched in place.
 */
function updateProposalState() {
  const proposal = model.proposal;
  for (const node of el.cells.querySelectorAll("[data-proposal-cell]")) {
    if (!(node instanceof HTMLElement)) continue;
    const owned = proposal !== null && proposal.cellId === node.dataset.proposalCell ? proposal : null;
    if (owned === null) continue;
    const heading = node.querySelector("h3");
    if (heading !== null) heading.textContent = `Draft Gate · ${owned.status}`;
    const copy = node.querySelector("p");
    if (copy !== null) copy.textContent = proposalCopy(owned.status);
    const reasons = node.querySelector("[data-role=proposal-reasons]");
    if (reasons instanceof HTMLElement) reasons.innerHTML = proposalReasons(owned);
    const apply = node.querySelector("[data-action=apply-proposal]");
    if (apply instanceof HTMLButtonElement) apply.disabled = owned.status !== "valid";
  }
}

/**
 * Commit one Cell Source edit and refresh only what depends on it, so a Source
 * change never rebuilds the editor under the caret.
 * @param {HTMLTextAreaElement} area @param {string} source
 * @returns {boolean} whether the model changed
 */
function commitSourceEdit(area, source) {
  const cellId = area.dataset.cellId;
  if (cellId === undefined) return false;
  const before = model;
  dispatch({ type: "source.edit", cellId, source });
  if (model === before) return false;
  if (area.value !== source) area.value = source;
  const size = el.cells.querySelector(`[data-role=size][data-cell-id="${cellId}"]`);
  if (size instanceof HTMLElement) size.textContent = `${source.length} chars`;
  // The outline is re-rendered below, but the editor is not (it would move the
  // caret), so the Cell's own heading carries the new derived label here.
  const edited = model.cells.find((cell) => cell.id === cellId);
  const heading = el.cells.querySelector(`.cell[data-cell-id="${cellId}"] .cell-heading strong`);
  if (edited !== undefined && heading instanceof HTMLElement) heading.textContent = label(edited);
  renderOutline();
  renderSourceMeta();
  renderPreview();
  updateProposalState();
  return true;
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
  <div class="editor-tabs" role="tablist" aria-label="Cell editor mode"><button type="button" role="tab" id="cell-${cell.id}-source-tab" aria-controls="cell-${cell.id}-source-panel" aria-selected="${!descriptionMode}" data-action="mode-source" data-cell-id="${cell.id}">Source</button><button type="button" role="tab" id="cell-${cell.id}-description-tab" aria-controls="cell-${cell.id}-description-panel" aria-selected="${descriptionMode}" data-action="mode-description" data-cell-id="${cell.id}">Description</button><small data-role="size" data-cell-id="${cell.id}">${cell.source.length} chars</small></div>
  <div id="cell-${cell.id}-source-panel" role="tabpanel" aria-labelledby="cell-${cell.id}-source-tab" data-panel="source" ${descriptionMode ? "hidden" : ""}><textarea data-role="source" data-cell-id="${cell.id}" aria-label="Cell ${index + 1} AzeMark Source" spellcheck="false" ${model.mutationLocked ? "disabled" : ""}>${esc(cell.source)}</textarea></div>
  <div id="cell-${cell.id}-description-panel" role="tabpanel" aria-labelledby="cell-${cell.id}-description-tab" class="description-panel" data-panel="description" ${descriptionMode ? "" : "hidden"}><textarea data-role="description" data-cell-id="${cell.id}" aria-label="Cell ${index + 1} Description" placeholder="Describe the AzeMark Source to generate">${esc(cell.pendingDescription)}</textarea><div class="description-actions"><button type="button" data-action="back-source" data-cell-id="${cell.id}">Back to Source</button><button type="button" data-action="${generating ? "cancel-generation" : "generate"}" data-cell-id="${cell.id}" ${!generating && (model.proposal !== null || cell.pendingDescription.trim() === "" || capabilities?.service?.authoring?.available !== true) ? "disabled" : ""}>${generating ? "Cancel generation" : "Generate AzeMark Source"}</button></div></div>
  ${proposal ? `<section class="proposal" data-proposal-cell="${cell.id}" aria-labelledby="proposal-${cell.id}"><h3 id="proposal-${cell.id}" tabindex="-1">Draft Gate · ${proposal.status}</h3><p id="proposal-${cell.id}-reason">${proposalCopy(proposal.status)}</p><div><button type="button" data-action="review-proposal" data-cell-id="${cell.id}">Review proposed Source</button></div><div data-role="proposal-reasons">${proposalReasons(proposal)}</div><textarea readonly aria-label="Proposed AzeMark Source" spellcheck="false">${esc(proposal.source)}</textarea><footer><button type="button" data-action="discard-proposal" data-cell-id="${cell.id}">Discard</button><button type="button" data-action="apply-proposal" data-cell-id="${cell.id}" ${proposal.status !== "valid" ? "disabled" : ""} ${proposal.status !== "valid" ? `aria-describedby="proposal-${cell.id}-reason"` : ""}>Apply</button></footer></section>` : ""}
  ${response ? `<section class="proposal generation-response"><h3>${response.kind === "clarification" ? "Clarification needed" : response.kind === "refusal" ? "Request refused" : "Generation failed"}</h3><p>${esc(response.message)}</p><button type="button" data-action="${response.kind === "refusal" ? "dismiss-response" : "revise-description"}" data-cell-id="${cell.id}">${response.kind === "refusal" ? "Dismiss" : response.kind === "clarification" ? "Revise Description" : "Return to Description"}</button></section>` : ""}
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
  const expandedRefresh = /** @type {HTMLButtonElement} */ (byId("expanded-refresh"));
  expandedRefresh.disabled = preview.status === "refreshing";
  // Expand is enabled only with a loaded Artifact; the button stays rendered
  // (not removed) so the toolbar shape is stable, but activation is blocked.
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

function renderOperations() {
  const analyze = model.operations.analyze;
  const format = model.operations.format;
  const analyzeButton = /** @type {HTMLButtonElement} */ (byId("analyze"));
  const formatButton = /** @type {HTMLButtonElement} */ (byId("format"));
  analyzeButton.disabled = analyze?.status === "running";
  analyzeButton.textContent = analyze?.status === "running" ? "Analyzing…" : analyze?.status === "failed" ? "Analyze — failed" : "Analyze";
  formatButton.disabled = format?.status === "running";
  formatButton.textContent = format?.status === "running" ? "Formatting…" : format?.status === "failed" ? "Format — failed" : "Format…";
  renderExportItems();
}

/**
 * Export progress and failure stay with the chosen item: at most one
 * in-flight or failed item, the rest show their capability state.
 */
function renderExportItems() {
  const running = model.operations.export?.status === "running" ? model.operations.export : null;
  const failed = model.operations.export?.status === "failed" ? model.operations.export : null;
  for (const item of el.exportMenu.querySelectorAll("button[data-format]")) {
    if (!(item instanceof HTMLButtonElement)) continue;
    const format = item.dataset.format ?? "";
    // The Source download needs no compiler round-trip, so it is always on.
    if (format === EXPORT_SOURCE_FORMAT) {
      item.disabled = running !== null;
      item.textContent = EXPORT_LABELS[format] ?? format.toUpperCase();
      continue;
    }
    const formats = /** @type {any} */ (capabilities?.compiler?.formats);
    const supported = Array.isArray(formats) && formats.some((/** @type {any} */ entry) => (entry?.id ?? entry) === format);
    const active = running?.format === format || failed?.format === format;
    item.disabled = running !== null || (!supported && !active);
    const label = EXPORT_LABELS[format] ?? format.toUpperCase();
    item.textContent = running?.format === format
      ? `${label} — exporting…`
      : failed?.format === format
        ? `${label} — failed`
        : supported ? label : `${label} — unavailable`;
  }
}

/** Severity, then Source order. */
function orderedDiagnostics() {
  const source = assembledSource();
  const rank = /** @param {string} severity */ (severity) =>
    severity === "error" ? 0 : severity === "warning" ? 1 : severity === "info" ? 2 : 3;
  const offset = /** @param {import("./workspace-state.js").Diagnostic} diagnostic */ (diagnostic) =>
    diagnostic.location?.range?.start ? indexForPosition(source, diagnostic.location.range.start) : Number.MAX_SAFE_INTEGER;
  return [...model.diagnostics].sort((a, b) => rank(a.severity) - rank(b.severity) || offset(a) - offset(b));
}

/** @param {string} message @returns {"title" | "author" | "date" | "metadata"} */
function metadataFieldFor(message) {
  return /title/i.test(message) ? "title" : /author/i.test(message) ? "author" : /date/i.test(message) ? "date" : "metadata";
}

/** @type {Record<"title" | "author" | "date" | "metadata", HTMLInputElement | HTMLTextAreaElement>} */
const metadataInputs = { title: el.title, author: el.author, date: el.date, metadata: el.metadata };

/** Metadata diagnostics expand Document details and surface field-local feedback. */
function renderMetadataFeedback() {
  const source = assembledSource();
  const { bodyStart } = splitFrontMatter(source);
  const invalid = /** @type {Set<"title" | "author" | "date" | "metadata">} */ (new Set());
  for (const diagnostic of model.diagnostics) {
    const start = diagnostic.location?.range?.start;
    if (!start) continue;
    if (indexForPosition(source, start) >= bodyStart) continue;
    invalid.add(metadataFieldFor(diagnostic.message));
  }
  /** @type {Record<string, HTMLElement>} */
  const fields = el.feedback;
  for (const node of Object.values(fields)) { node.hidden = true; node.textContent = ""; }
  for (const [name, input] of Object.entries(metadataInputs)) {
    const field = /** @type {"title" | "author" | "date" | "metadata"} */ (name);
    const failed = invalid.has(field);
    input.setAttribute("aria-invalid", String(failed));
    if (failed) input.setAttribute("aria-describedby", el.feedback[field].id);
    else input.removeAttribute("aria-describedby");
  }
  for (const diagnostic of model.diagnostics) {
    const start = diagnostic.location?.range?.start;
    if (!start) continue;
    if (indexForPosition(source, start) >= bodyStart) continue;
    const node = fields[metadataFieldFor(diagnostic.message)];
    if (node.hidden) node.textContent = `${diagnostic.severity}: ${diagnostic.message}`;
    node.hidden = false;
  }
  if (invalid.size > 0) el.details.open = true;
  return [...invalid];
}

function renderDiagnostics() {
  const diagnostics = orderedDiagnostics();
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
    ? diagnostics.map((diagnostic) => `<article class="diagnostic" data-severity="${esc(diagnostic.severity)}">${diagnosticHeadline(diagnostic)}<p>${esc(diagnostic.message)}</p>${diagnostic.location?.range ? `<button type="button" data-diagnostic="${model.diagnostics.indexOf(diagnostic)}">Line ${diagnostic.location.range.start.line}, column ${diagnostic.location.range.start.column}</button>` : ""}</article>`).join("")
    : "<p>No diagnostics.</p>";
  renderMetadataFeedback();
  renderOperations();
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
function focusAppliedSourceStart(id) {
  const node = el.cells.querySelector(`[data-role="source"][data-cell-id="${id}"]`);
  if (!(node instanceof HTMLTextAreaElement)) { focusEditor(id); return; }
  node.scrollIntoView({ block: "center" });
  node.focus();
  node.setSelectionRange(0, 0);
}

/** @param {string} id */
function focusCellHeading(id) {
  const node = document.querySelector(`#notebook-cells .cell[data-cell-id="${id}"] .cell-heading strong`);
  if (node instanceof HTMLElement) {
    if (node.tabIndex < 0) node.tabIndex = -1;
    node.scrollIntoView({ block: "center" });
    node.focus();
  } else focusEditor(id);
}

/** @param {string} id */
function focusCell(id) {
  dispatch({ type: "cell.activate", cellId: id });
  renderOutline();
  if (matchMedia("(max-width:1199px)").matches && el.workspace.dataset.navOpen === "true") closeDrawer(false);
  focusEditor(id);
}

function closeDrawerRestoreOnly() {
  el.workspace.dataset.navOpen = "false";
  el.drawerScrim.hidden = true;
  const nav = byId("document-navigation");
  nav.removeAttribute("role");
  nav.removeAttribute("aria-modal");
  const main = byId("main-workspace");
  main.inert = false;
  const rail = document.querySelector(".app-rail");
  if (rail instanceof HTMLElement) rail.inert = false;
}
/** @param {boolean} [restoreFocus] */
function closeDrawer(restoreFocus = true) {
  closeDrawerRestoreOnly();
  if (restoreFocus) byId("open-document-nav").focus();
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
  if (el.search.value) el.search.focus();
  else byId("document-nav-title").focus();
}

/**
 * The dock is non-modal. An author opening it lands on its heading; a dock
 * opened because an asynchronous result arrived (analysis, blocked export)
 * leaves focus where the author was, because no result may take focus.
 * @param {{ focus?: boolean }} [options]
 */
function openDiagnostics({ focus = true } = {}) {
  el.diagnostics.hidden = false;
  byId("diagnostics-toggle").setAttribute("aria-expanded", "true");
  sessionStorage.setItem("azeweb.diagnosticsOpen", "true");
  if (focus) byId("diagnostics-title").focus();
}
function closeDiagnostics() {
  el.diagnostics.hidden = true;
  byId("diagnostics-toggle").setAttribute("aria-expanded", "false");
  sessionStorage.setItem("azeweb.diagnosticsOpen", "false");
  byId("diagnostics-toggle").focus();
}

/** Rail health mirrors degraded or actionable capability states; details stay in the dialog. */
function updateHealth() {
  const button = byId("service-health");
  const authoring = capabilities?.service?.authoring;
  const unavailable = authoring?.available === false;
  const supported = capabilities?.compatibility?.supported;
  const label = capabilities === null
    ? "Service details: connecting"
    : supported === false
      ? "Service details: upgrade required"
      : unavailable
        ? "Service details: degraded"
        : "Service details: healthy";
  const visual = /** @type {HTMLElement|null} */ (button.querySelector('[aria-hidden="true"]'));
  if (visual !== null) visual.textContent = label.includes("healthy") ? "●" : "▲";
  button.setAttribute("aria-label", label);
  button.dataset.health = label.includes("healthy") ? "healthy" : label.includes("connecting") ? "connecting" : "degraded";
}
/**
 * Progressive disclosure for connectivity and capability details: one line
 * while healthy, the actionable subset when something needs attention.
 */
function renderServiceDetails() {
  if (capabilities === null) {
    el.serviceMeta.textContent = "Connecting…";
    return;
  }
  const lines = [
    `Compiler ${capabilities.compatibility.compilerRelease}. Protocol ${capabilities.protocol.version}.`,
    `Authoring ${capabilities.service.authoring?.available ? "available" : "unavailable"}.`,
  ];
  const tex = capabilities.service?.renderers?.tex;
  if (tex !== undefined && tex.available !== true) lines.push(tex.remedy ?? "TeX renderer unavailable.");
  for (const [operation, reason] of Object.entries(capabilities.service?.unavailableOperations ?? {})) {
    lines.push(`${operation}: ${reason}`);
  }
  el.serviceMeta.textContent = lines.join(" ");
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
/** Closing a menu by choosing an item returns focus to its trigger. @param {HTMLElement} menu @param {HTMLElement} trigger */
function closeMenu(menu, trigger) {
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  trigger.focus();
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

/**
 * A sandboxed blob navigation can complete without dispatching `load`, so the
 * frame's document URL and readyState are the source of truth, with `error` and
 * a deadline as the failure paths.
 * @param {HTMLIFrameElement} frame @param {string} url
 */
function loadFrame(frame, url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (/** @type {(value?: Error) => void} */ callback, /** @type {Error | undefined} */ value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(deadline);
      frame.removeEventListener("load", onLoad);
      frame.removeEventListener("error", onError);
      callback(value);
    };
    const onLoad = () => finish(resolve, undefined);
    const onError = () => finish(reject, new Error("Preview Artifact could not be loaded."));
    const timer = setInterval(() => {
      const document_ = frame.contentDocument;
      if (document_ !== null && document_.URL === url && document_.readyState === "complete") finish(resolve, undefined);
    }, 30);
    const deadline = setTimeout(() => finish(reject, new Error("Preview Artifact did not load.")), 10_000);
    frame.addEventListener("load", onLoad);
    frame.addEventListener("error", onError);
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
    // The Document preview is always the compiler's HTML rendering, so the blob
    // is typed text/html for the iframe regardless of what the job reports.
    const url = URL.createObjectURL(new Blob([bytes], { type: "text/html" }));
    try {
      await loadFrame(el.preview, url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    if (model.preview.request?.requestId !== requestId) { URL.revokeObjectURL(url); return; }
    const previous = model.preview.artifact?.url ?? null;
    dispatch({ type: "preview.resolve", requestId, artifact: { url, bytes: bytes.byteLength } });
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

/**
 * @param {{ reveal?: boolean }} [options] `reveal` opens the dock when the
 * author asked for the analysis; background analyses only update the summary.
 */
async function analyze({ reveal = false } = {}) {
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
    // Errors are revealed when the author asked for the analysis, but the dock
    // never takes focus: the initiating surface keeps it, and a background
    // analysis moves nothing at all.
    if (reveal && model.diagnostics.some((diagnostic) => diagnostic.severity === "error")) openDiagnostics({ focus: false });
    announce(model.diagnostics.length ? "Analysis complete with diagnostics" : "Analysis complete: no diagnostics");
  } catch (error) {
    if (model.operations.analyze?.requestId !== requestId) return;
    dispatch({ type: "analysis.fail", requestId, message: error instanceof Error ? error.message : "Analysis failed" });
    renderDiagnostics();
    announce(model.operations.analyze?.message ?? "Analysis failed");
  }
}
/** Compiler-rendered download formats, in menu order; Source is the local-only item after them. */
const EXPORT_FORMATS = ["html", "svg", "png", "pdf"];
const EXPORT_SOURCE_FORMAT = "source";
/** @type {Record<string, string>} */
const EXPORT_LABELS = { html: "HTML", svg: "SVG", png: "PNG", pdf: "PDF", source: "SOURCE (.aze.md)" };
/** Download the assembled Current document Source as a `.aze.md` file. */
function exportSource() {
  const text = assembledSource();
  const name = `${documentTitle().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document"}.aze.md`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown; charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  announce("Source exported as .aze.md");
}
/** @param {string} format */
async function exportFormat(format) {
  const requestId = crypto.randomUUID();
  dispatch({ type: "export.start", requestId, format });
  renderOperations();
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
    if (revision !== model.revision || theme !== model.theme) {
      // The compiled bytes no longer describe the Current document.
      dispatch({ type: "export.resolve", requestId });
      renderOperations();
      announce("Document changed; export discarded");
      return;
    }
    if (job.result?.ok !== true || !job.result.artifact) {
      dispatch({ type: "diagnostics.set", diagnostics: job.result?.diagnostics ?? [] });
      dispatch({ type: "export.fail", requestId, message: "Export blocked by Source errors" });
      renderDiagnostics();
      openDiagnostics({ focus: false });
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
    renderOperations();
    announce(`${format.toUpperCase()} export complete`);
  } catch (error) {
    if (model.operations.export?.requestId !== requestId) return;
    dispatch({ type: "export.fail", requestId, message: error instanceof Error ? error.message : "Export failed" });
    renderOperations();
    announce(model.operations.export?.message ?? "Export failed");
  }
}

async function formatSource() {
  const requestId = crypto.randomUUID();
  dispatch({ type: "format.start", requestId });
  renderOperations();
  announce("Formatting Source");
  const revision = model.revision;
  try {
    const accepted = await submitJob({
      protocolVersion: 1, requestId, revision: String(revision), operation: "format",
      source: { text: assembledSource(), name: "document.aze.md" },
    });
    const job = await pollJob(accepted.jobId, accepted.pollAfterMs);
    if (model.operations.format?.requestId !== requestId) return;
    if (revision !== model.revision) {
      dispatch({ type: "format.fail", requestId, message: "Document changed; formatting discarded" });
      renderOperations();
      announce("Document changed; formatting discarded");
      return;
    }
    if (job.result?.ok !== true || !job.result.proposal) {
      dispatch({ type: "diagnostics.set", diagnostics: job.result?.diagnostics ?? [] });
      dispatch({ type: "format.fail", requestId, message: "Source errors block formatting" });
      renderDiagnostics();
      openDiagnostics({ focus: false });
      announce("Source errors block formatting");
      return;
    }
    dispatch({ type: "format.resolve", requestId, source: job.result.proposal.source });
    renderOperations();
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
  const first = model.cells[0]?.id;
  if (first !== undefined) focusAppliedSourceStart(first);
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
        // A draft is a complete document; its front matter belongs to the
        // Current document, so only the body may become a Cell's Source.
        ? { kind: "source", source: stripFrontMatter(draft.source.text).source, valid: draft.analysis?.valid === true, diagnostics: draft.analysis?.diagnostics ?? [] }
        : draft.outcome === "clarification"
          ? { kind: "clarification", message: draft.question || "More detail is needed." }
          : { kind: "refusal", message: draft.reason || draft.message || "The request was refused." }
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

  el.search.addEventListener("input", () => {
    renderOutline();
    // The visible count is not a second live region: it is announced through
    // the workspace's one polite region.
    announce(el.search.value.trim() === "" ? "Search cleared" : el.searchResult.textContent ?? "");
  });
  el.search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || el.search.value === "") return;
    el.search.value = "";
    renderOutline();
    announce("Search cleared");
  });
  el.cellList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-cell-id]") : null;
    if (button instanceof HTMLButtonElement && button.dataset.cellId) focusCell(button.dataset.cellId);
  });
  el.cellList.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.search.value !== "") {
      event.preventDefault();
      el.search.value = "";
      renderOutline();
      const current = el.cellList.querySelector('button[tabindex="0"]');
      if (current instanceof HTMLElement) current.focus();
      else el.search.focus();
      announce("Search cleared");
      return;
    }
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
    for (const button of buttons) button.tabIndex = -1;
    if (buttons[next]) { buttons[next].tabIndex = 0; buttons[next].focus(); }
  });

  el.cells.addEventListener("input", (event) => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || !area.dataset.cellId) return;
    if (area.dataset.role === "source") {
      commitSourceEdit(area, area.value);
    } else if (area.dataset.role === "description") {
      dispatch({ type: "description.edit", cellId: area.dataset.cellId, description: area.value });
      renderOutline();
      updateGenerateAction(area.dataset.cellId);
    }
  });

  // A pasted front-matter block stays in the Current document, not the Cell.
  el.cells.addEventListener("focusout", (event) => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || area.dataset.role !== "source" || !area.dataset.cellId) return;
    if (model.mutationLocked) return;
    const { source, removed } = stripFrontMatter(area.value);
    if (!removed) return;
    if (commitSourceEdit(area, source)) {
      announce("Front matter removed from the Cell; document metadata is edited in Document details.");
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
        focusAppliedSourceStart(id);
        announce("Proposed Source applied");
        void analyze();
        break;
      case "review-proposal": {
        const heading = el.cells.querySelector(`[data-proposal-cell="${id}"] h3`);
        if (heading instanceof HTMLElement) {
          heading.scrollIntoView({ block: "center" });
          heading.focus();
        }
        break;
      }
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
    const cellId = tab.dataset.cellId;
    if (cellId === undefined) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const tabs = /** @type {HTMLButtonElement[]} */ ([.../** @type {HTMLElement} */ (tab.closest('[role="tablist"]')).querySelectorAll('[role="tab"]')]);
      const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      if (next) next.focus();
      return;
    }
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Home" && event.key !== "End") return;
    /** @type {import("./workspace-state.js").EditorMode | null} */
    let mode = null;
    if (event.key === "End") mode = "description";
    else if (event.key === "Home") mode = "source";
    else mode = tab.dataset.action === "mode-description" ? "description" : "source";
    event.preventDefault();
    dispatch({ type: "cell.activate", cellId });
    dispatch({ type: "editor.mode", cellId, mode });
    renderCells();
    const next = el.cells.querySelector(`button[data-action=mode-${mode}][data-cell-id="${cellId}"]`);
    if (next instanceof HTMLElement) next.focus();
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
    focusCellHeading(model.activeCellId ?? "");
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
  el.expand.addEventListener("click", () => {
    if (el.previewDialog.open || model.preview.artifact === null) return;
    el.previewDialog.showModal();
  });
  const closePreviewDialog = () => {
    if (el.previewDialog.open) el.previewDialog.close();
    else el.refresh.focus();
  };
  byId("close-preview-dialog").addEventListener("click", closePreviewDialog);
  el.previewDialog.addEventListener("close", () => el.refresh.focus());
  el.previewDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreviewDialog();
  });
  byId("view-preview-diagnostics").addEventListener("click", () => openDiagnostics());

  el.exportToggle.addEventListener("click", () => toggleMenu(el.exportMenu, el.exportToggle));
  el.moreToggle.addEventListener("click", () => toggleMenu(el.moreMenu, el.moreToggle));
  el.exportMenu.addEventListener("keydown", (event) => menuKeys(event, el.exportMenu, el.exportToggle));
  el.moreMenu.addEventListener("keydown", (event) => menuKeys(event, el.moreMenu, el.moreToggle));
  byId("analyze").addEventListener("click", () => { closeMenu(el.moreMenu, el.moreToggle); void analyze({ reveal: true }); });
  byId("format").addEventListener("click", () => { closeMenu(el.moreMenu, el.moreToggle); void formatSource(); });
  byId("import-document").addEventListener("click", () => { closeMenu(el.moreMenu, el.moreToggle); el.importInput.click(); });
  byId("new-document").addEventListener("click", () => { closeMenu(el.moreMenu, el.moreToggle); newDocument(); });
  el.importInput.addEventListener("change", () => {
    const file = el.importInput.files?.[0] ?? null;
    el.importInput.value = "";
    if (file !== null) void importDocument(file);
  });
  el.exportMenu.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-format]") : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    closeMenu(el.exportMenu, el.exportToggle);
    if (button.dataset.format === EXPORT_SOURCE_FORMAT) exportSource();
    else void exportFormat(button.dataset.format ?? "html");
  });

  byId("diagnostics-toggle").addEventListener("click", () => el.diagnostics.hidden ? openDiagnostics() : closeDiagnostics());
  byId("close-diagnostics").addEventListener("click", closeDiagnostics);
  el.diagnostics.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeDiagnostics();
  });
  el.diagnosticsList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-diagnostic]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const diagnostic = model.diagnostics[Number(button.dataset.diagnostic)];
    const range = diagnostic?.location?.range;
    if (!range) return;
    const source = assembledSource();
    const startIndex = indexForPosition(source, range.start);
    const endIndex = indexForPosition(source, range.end);
    if (startIndex < splitFrontMatter(source).bodyStart) {
      el.details.open = true;
      metadataInputs[metadataFieldFor(diagnostic.message)].focus();
      return;
    }
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
  for (const link of document.querySelectorAll(".skip-link")) {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("href") !== "#document-navigation" || !matchMedia("(max-width:1199px)").matches) return;
      // The navigation is an off-canvas drawer at this width: skipping to it
      // means opening it, which is where the focus contract already lands.
      event.preventDefault();
      openDrawer();
    });
  }
  byId("close-document-nav").addEventListener("click", () => closeDrawer());
  el.drawerScrim.addEventListener("click", () => closeDrawer());
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
  byId("discard-format").addEventListener("click", () => { dispatch({ type: "format.discard" }); renderOperations(); el.proposalDialog.close(); });
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

/** @param {string} source */
function cellForSource(source) {
  return { id: crypto.randomUUID(), source, lastAppliedSource: source, pendingDescription: "", mode: /** @type {"source"} */ ("source") };
}

/** One Cell per capability-tour entry, with stable per-load identities. */
function starterCells() {
  return STARTER_CELLS.map(cellForSource);
}

/**
 * Clear the Current document back to a single empty Cell, so the author can
 * start a fresh document. The Title in Document details is kept; the tour
 * stays reachable by reloading the page.
 */
function newDocument() {
  if (model.mutationLocked) return;
  if (!window.confirm("Start a new document? This clears every Cell and keeps only the current title.")) return;
  const fresh = newCell();
  fresh.source = "# Untitled\n";
  fresh.lastAppliedSource = fresh.source;
  dispatch({ type: "document.reset", document: { ...model.document, authors: [], date: "", metadata: "" }, cells: [fresh] });
  renderDocument();
  renderCells();
  renderDiagnostics();
  announce("New document started with one empty Cell");
  focusEditor(fresh.id);
}

/**
 * Replace the Current document with an imported `.aze.md` file. The body is
 * split on top-level headings, so an exported document round-trips to the
 * same Cells; a heading-free body stays one Cell. The file is read only
 * after the author confirms, then validated locally and compiler-analyzed,
 * with errors revealed through the diagnostics dock.
 * @param {File} file
 */
async function importDocument(file) {
  if (model.mutationLocked) return;
  const limit = importSourceLimit(capabilities);
  if (file.size > limit) {
    announce(`"${file.name}" is above the import limit (${limit} bytes).`);
    return;
  }
  if (!window.confirm(`Replace the Current document with "${file.name}"?`)) return;
  let text;
  try {
    text = await file.text();
  } catch {
    announce(`Could not read "${file.name}".`);
    return;
  }
  let parsed;
  try {
    parsed = parseImportSource(text, { fileName: file.name, maxBytes: limit });
  } catch (error) {
    announce(error instanceof Error ? error.message : "Could not import the file.");
    return;
  }
  const cells = parsed.sources.map(cellForSource);
  dispatch({ type: "document.reset", document: parsed.document, cells });
  renderDocument();
  renderCells();
  announce(`Imported "${file.name}" as ${cells.length === 1 ? "one Cell" : `${cells.length} Cells`}`);
  const first = model.cells[0]?.id;
  if (first !== undefined) focusCellHeading(first);
  void analyze({ reveal: true });
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
    el.exportMenu.innerHTML = [...EXPORT_FORMATS, EXPORT_SOURCE_FORMAT].map((format) =>
      `<button role="menuitem" type="button" data-format="${format}">${EXPORT_LABELS[format]}</button>`).join("");
    renderServiceDetails();
    updateHealth();
    // The default document is the capability tour: one Cell per family, with
    // the smallest compiling snippet lifted from the reference library.
    model = createWorkspaceState(starterCells(), el.theme.value || "default", starterDocument());
    const stored = Number(sessionStorage.getItem(PREVIEW_HEIGHT_KEY));
    if (Number.isFinite(stored) && stored > 0) dispatch({ type: "preview.resize", height: stored });
    el.gate.hidden = true;
    el.workspace.hidden = false;
    renderAll();
    syncDetailsDisclosure();
    if (sessionStorage.getItem("azeweb.diagnosticsOpen") === "true") openDiagnostics();
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
