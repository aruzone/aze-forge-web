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
  previewToast: element("preview-toast"),
  source: /** @type {HTMLTextAreaElement} */ (element("source", HTMLTextAreaElement)),
  sourceMeta: element("source-meta"),
  documentTitle: /** @type {HTMLInputElement} */ (element("document-title", HTMLInputElement)),
  documentAuthor: /** @type {HTMLTextAreaElement} */ (element("document-author", HTMLTextAreaElement)),
  documentDate: /** @type {HTMLInputElement} */ (element("document-date", HTMLInputElement)),
  documentMetadata: /** @type {HTMLTextAreaElement} */ (element("document-metadata", HTMLTextAreaElement)),
  cellSearch: /** @type {HTMLInputElement} */ (element("cell-search", HTMLInputElement)),
  cellCount: element("cell-count"),
  cellList: element("cell-list"),
  notebookCells: element("notebook-cells"),
  addCell: /** @type {HTMLButtonElement} */ (element("add-cell", HTMLButtonElement)),
  executionDock: element("execution-dock"),
  renderedOutput: element("rendered-output"),
  outputLabel: element("output-label"),
  authoringConsent: /** @type {HTMLInputElement} */ (element("authoring-consent", HTMLInputElement)),
  authoringStatus: element("authoring-status"),
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
 *   artifact: { format: string, bytes: ArrayBuffer, revision: string, theme: string } | null,
 *   frontMatter: { version: string, title: string, authors: string[], date: string, metadata: string },
 *   cells: { id: string, text: string }[], activeCellId: string | null, executedCellId: string | null,
 *   cellExecution: number, draftGeneration: number, cellSearch: string, draft: any, debounceTimer: ReturnType<typeof setTimeout> | undefined,
 *   previewToastTimer: ReturnType<typeof setTimeout> | undefined }} */
const state = {
  token: sessionStorage.getItem(TOKEN_KEY) ?? "",
  capabilities: null,
  examples: [],
  revision: 0,
  analyzeController: null,
  analyzeJobId: null,
  preview: { objectUrl: null, revision: null, theme: null },
  artifact: null,
  frontMatter: { version: "2", title: "", authors: [], date: "", metadata: "" },
  cells: [],
  activeCellId: null,
  executedCellId: null,
  cellExecution: 0,
  draftGeneration: 0,
  cellSearch: "",
  debounceTimer: undefined,
  previewToastTimer: undefined,
  draft: null,
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

// --------------------------------------------------------- notebook editing

/** @param {string} text */
function createCell(text = "") {
  return { id: crypto.randomUUID(), text };
}

/** @param {string} value @returns {string} */
function frontMatterValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}

/** @param {string} value */
function authorsFromFlow(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return trimmed.length === 0 ? [] : [frontMatterValue(trimmed)];
  }
  /** @type {string[]} */
  const authors = [];
  let start = 1;
  let quote = "";
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const character = trimmed[index];
    if (quote.length > 0) {
      if (quote === "\"" && character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character !== ",") continue;
    const author = frontMatterValue(trimmed.slice(start, index));
    if (author.length > 0) authors.push(author);
    start = index + 1;
  }
  const author = frontMatterValue(trimmed.slice(start, -1));
  if (author.length > 0) authors.push(author);
  return authors;
}

/** @param {string[]} lines */
function parseFrontMatter(lines) {
  /** @type {{ version: string, title: string, authors: string[], date: string, metadata: string }} */
  const frontMatter = { version: "2", title: "", authors: [], date: "", metadata: "" };
  /** @type {string[]} */
  const metadata = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (match === null) {
      metadata.push(line);
      continue;
    }

    const [, key, value = ""] = match;
    if (key === "author" && value.length === 0) {
      /** @type {string[]} */
      const authors = [];
      while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])) {
        index += 1;
        authors.push(frontMatterValue(lines[index].replace(/^\s*-\s+/, "")));
      }
      frontMatter.authors = authors;
      continue;
    }
    if (key === "azemark") frontMatter.version = frontMatterValue(value);
    else if (key === "title") frontMatter.title = frontMatterValue(value);
    else if (key === "author") frontMatter.authors = authorsFromFlow(value);
    else if (key === "date" || key === "x-date") frontMatter.date = frontMatterValue(value);
    else metadata.push(line);
  }

  frontMatter.metadata = metadata.join("\n").trim();
  return frontMatter;
}

/** @param {string} source */
function parseNotebookSource(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  /** @type {{ version: string, title: string, authors: string[], date: string, metadata: string }} */
  let frontMatter = { version: "2", title: "", authors: [], date: "", metadata: "" };
  let body = normalized;
  if (normalized.startsWith("---\n")) {
    const delimiter = normalized.indexOf("\n---", 4);
    if (delimiter !== -1) {
      frontMatter = parseFrontMatter(normalized.slice(4, delimiter).split("\n"));
      body = normalized.slice(delimiter + 4).replace(/^\n+/, "");
    }
  }

  const cells = body.trim().length === 0
    ? [createCell()]
    : body.trim().split(/(?=^#{1,6}\s)/m).filter((text) => text.trim().length > 0).map((text) => createCell(text.trim()));
  return { frontMatter, cells };
}

/** @param {string} value */
function yamlString(value) {
  return JSON.stringify(value);
}

/** @param {string} value */
function authorsFromInput(value) {
  return value.split("\n").map((author) => author.trim()).filter((author) => author.length > 0);
}

function sourceFromNotebook() {
  const { frontMatter } = state;
  const authors = frontMatter.authors.map((author) => author.trim()).filter((author) => author.length > 0);
  const lines = [
    "---",
    `azemark: ${frontMatter.version || "2"}`,
    ...(frontMatter.title.trim().length === 0 ? [] : [`title: ${yamlString(frontMatter.title.trim())}`]),
    ...(authors.length === 0 ? [] : authors.length === 1
      ? [`author: ${yamlString(authors[0])}`]
      : ["author:", ...authors.map((author) => `  - ${yamlString(author)}`)]),
    ...(frontMatter.date.trim().length === 0 ? [] : [`x-date: ${yamlString(frontMatter.date.trim())}`]),
    ...(frontMatter.metadata.trim().length === 0 ? [] : [frontMatter.metadata.trim()]),
    "---",
  ];
  const cells = state.cells.map((cell) => cell.text).filter((text) => text.trim().length > 0);
  return `${lines.join("\n")}\n${cells.length === 0 ? "" : `\n${cells.join("\n\n")}\n`}`;
}

function renderFrontMatter() {
  els.documentTitle.value = state.frontMatter.title;
  els.documentAuthor.value = state.frontMatter.authors.join("\n");
  els.documentDate.value = state.frontMatter.date;
  els.documentMetadata.value = state.frontMatter.metadata;
}

/** @param {{ id: string, text: string }} cell @param {number} index */
function cellLabel(cell, index) {
  const firstLine = cell.text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  const heading = /^#{1,6}\s+(.+)$/.exec(firstLine);
  const label = heading?.[1] ?? firstLine;
  return label.length === 0 ? `Empty cell ${index + 1}` : label.slice(0, 72);
}

/** @param {string} text @param {string} action @param {string} cellId @param {string} label */
function cellTool(text, action, cellId, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.action = action;
  button.dataset.cellId = cellId;
  return button;
}

/** @param {{ id: string, text: string }} cell @param {number} index */
function renderCell(cell, index) {
  const item = document.createElement("article");
  item.className = "notebook-cell";
  item.id = `cell-${cell.id}`;
  item.dataset.cellId = cell.id;
  item.dataset.active = String(state.activeCellId === cell.id);
  item.setAttribute("aria-label", `AzeMark cell ${index + 1}`);

  const gutter = document.createElement("div");
  gutter.className = "cell-gutter";
  const run = document.createElement("button");
  run.type = "button";
  run.className = "cell-run";
  run.textContent = "▶";
  run.title = `Run cell ${index + 1}`;
  run.setAttribute("aria-label", `Run cell ${index + 1}`);
  run.dataset.action = "run";
  run.dataset.cellId = cell.id;
  gutter.append(run);

  const body = document.createElement("div");
  body.className = "cell-body";
  const toolbar = document.createElement("div");
  toolbar.className = "cell-toolbar";
  const count = document.createElement("span");
  count.className = "execution-count";
  count.textContent = `Cell ${index + 1}`;
  const tools = document.createElement("span");
  tools.className = "cell-tools";
  tools.append(
    cellTool("⧉", "copy", cell.id, "Copy cell"),
    cellTool("↑", "move-up", cell.id, "Move cell up"),
    cellTool("↓", "move-down", cell.id, "Move cell down"),
    cellTool("+", "insert-after", cell.id, "Add cell below"),
  );
  const remove = cellTool("×", "delete", cell.id, "Delete cell");
  remove.disabled = state.cells.length === 1;
  tools.append(remove);
  toolbar.append(count, tools);

  const source = document.createElement("textarea");
  source.className = "cell-source";
  source.spellcheck = false;
  source.value = cell.text;
  source.dataset.role = "source";
  source.dataset.cellId = cell.id;
  source.setAttribute("aria-label", `AzeMark cell ${index + 1} source`);

  const authoring = document.createElement("div");
  authoring.className = "cell-authoring";
  const description = document.createElement("textarea");
  description.className = "cell-description";
  description.rows = 2;
  description.dataset.role = "description";
  description.dataset.cellId = cell.id;
  description.placeholder = "Describe AzeMark content to generate in this cell";
  description.setAttribute("aria-label", `Description for cell ${index + 1} generation`);
  const generate = document.createElement("button");
  generate.type = "button";
  generate.textContent = "Generate";
  generate.dataset.action = "generate";
  generate.dataset.cellId = cell.id;
  generate.disabled = state.capabilities?.service.authoring?.available !== true;
  authoring.append(description, generate);

  body.append(toolbar, source, authoring);
  if (state.draft?.cellId === cell.id) body.append(renderCellDraft(cell.id));

  const output = document.createElement("div");
  output.className = "cell-output";
  output.id = `cell-output-${cell.id}`;
  body.append(output);
  item.append(gutter, body);
  return item;
}

/** @param {string} cellId */
function renderCellDraft(cellId) {
  const draft = state.draft;
  const wrapper = document.createElement("div");
  wrapper.className = "cell-draft";
  const status = document.createElement("p");
  status.className = "cell-draft-status";
  status.textContent = draft.outcome === "source"
    ? draft.valid ? "Draft Gate: proposed AzeMark Source analyzed. Apply it to replace this cell." : "Proposed AzeMark Source has compiler diagnostics and cannot replace this cell."
    : draft.outcome === "clarification" ? `More detail is needed. ${draft.question}` : "This request is not available in this deployment.";
  wrapper.append(status);

  if (draft.outcome === "source") {
    const source = document.createElement("textarea");
    source.readOnly = true;
    source.spellcheck = false;
    source.value = draft.cells.map((/** @type {{ text: string }} */ cell) => cell.text).join("\n\n");
    source.setAttribute("aria-label", "Proposed AzeMark Source draft");
    wrapper.append(source);
    if (!draft.valid) {
      const diagnostics = document.createElement("pre");
      diagnostics.textContent = (draft.diagnostics ?? []).map((/** @type {{ message: string }} */ item) => item.message).join("\n");
      wrapper.append(diagnostics);
    }
  }

  const actions = document.createElement("div");
  actions.className = "cell-draft-actions";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply draft";
  apply.dataset.action = "apply-draft";
  apply.dataset.cellId = cellId;
  apply.disabled = draft.outcome !== "source" || !draft.valid;
  const discard = document.createElement("button");
  discard.type = "button";
  discard.textContent = "Discard";
  discard.dataset.action = "discard-draft";
  discard.dataset.cellId = cellId;
  actions.append(apply, discard);
  wrapper.append(actions);
  return wrapper;
}

function renderCellList() {
  const search = state.cellSearch.trim().toLocaleLowerCase();
  const frontMatterMatch = search.length === 0 ? undefined : [
    ["title", state.frontMatter.title],
    ["authors", state.frontMatter.authors.join("\n")],
    ["date", state.frontMatter.date],
    ["metadata", state.frontMatter.metadata],
  ].find(([, value]) => value.toLocaleLowerCase().includes(search));
  const matchesFrontMatter = frontMatterMatch !== undefined;
  const matching = state.cells.filter((cell, index) => {
    const searchable = `${cellLabel(cell, index)}\n${cell.text}`.toLocaleLowerCase();
    return search.length === 0 || searchable.includes(search);
  });
  const resultCount = matching.length + Number(matchesFrontMatter);
  els.cellCount.textContent = search.length === 0
    ? `${state.cells.length} ${state.cells.length === 1 ? "cell" : "cells"}`
    : `${resultCount} matching ${resultCount === 1 ? "item" : "items"}`;

  const fragment = document.createDocumentFragment();
  if (resultCount === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No matching content.";
    fragment.append(empty);
  }
  if (frontMatterMatch !== undefined) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.frontMatter = "true";
    button.dataset.frontMatterField = frontMatterMatch[0];
    const number = document.createElement("span");
    number.className = "cell-number";
    number.textContent = "Document";
    const name = document.createElement("span");
    name.className = "cell-name";
    name.textContent = `Front matter: ${{
      title: "Title",
      authors: "Authors",
      date: "Date",
      metadata: "Additional metadata",
    }[frontMatterMatch[0]]}`;
    button.append(number, name);
    fragment.append(button);
  }
  for (const cell of matching) {
    const index = state.cells.indexOf(cell);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cellId = cell.id;
    button.dataset.active = String(cell.id === state.activeCellId);
    const number = document.createElement("span");
    number.className = "cell-number";
    number.textContent = `Cell ${index + 1}`;
    const name = document.createElement("span");
    name.className = "cell-name";
    name.textContent = cellLabel(cell, index);
    button.append(number, name);
    fragment.append(button);
  }
  for (const item of document.querySelectorAll(".notebook-cell")) {
    if (!(item instanceof HTMLElement)) continue;
    item.dataset.active = String(item.dataset.cellId === state.activeCellId);
  }
  els.cellList.replaceChildren(fragment);
}

function renderNotebook() {
  els.executionDock.append(els.renderedOutput);
  renderFrontMatter();
  const cells = document.createDocumentFragment();
  state.cells.forEach((cell, index) => cells.append(renderCell(cell, index)));
  els.notebookCells.replaceChildren(cells);
  renderCellList();
  if (state.executedCellId !== null) moveRenderedOutputToCell(state.executedCellId);
}

/** @param {string} source */
function loadNotebookSource(source) {
  const notebook = parseNotebookSource(source);
  state.frontMatter = notebook.frontMatter;
  state.cells = notebook.cells;
  state.activeCellId = notebook.cells[0]?.id ?? null;
  state.executedCellId = null;
  state.draftGeneration += 1;
  state.draft = null;
  renderNotebook();
}

function syncSourceFromNotebook({ fromUser = false } = {}) {
  if (fromUser) invalidateDrafts();
  setSource(sourceFromNotebook(), { fromUser, fromNotebook: true });
}

function invalidateDrafts() {
  state.draftGeneration += 1;
  if (state.draft !== null) {
    state.draft = null;
    renderNotebook();
  }
  for (const button of document.querySelectorAll("button[data-action=\"generate\"]")) {
    if (button instanceof HTMLButtonElement) button.disabled = state.capabilities?.service.authoring?.available !== true;
  }
}

/** @param {string} cellId */
function moveRenderedOutputToCell(cellId) {
  const target = document.getElementById(`cell-output-${cellId}`);
  if (target !== null) target.append(els.renderedOutput);
}
/** @param {string} cellId */
function cellNumber(cellId) {
  const index = state.cells.findIndex((cell) => cell.id === cellId);
  return index === -1 ? null : index + 1;
}


/** @param {string} cellId */
function runCell(cellId) {
  const number = cellNumber(cellId);
  if (number === null) return;
  state.activeCellId = cellId;
  state.executedCellId = cellId;
  state.cellExecution += 1;
  els.outputLabel.textContent = `Running cell ${number}`;
  renderCellList();
  moveRenderedOutputToCell(cellId);
  void exportFormat("html", {
    previewLabel: `cell ${number}`,
    cellId,
    cellExecution: state.cellExecution,
  });
}

/** @param {string} cellId */
async function copyCell(cellId) {
  const cell = state.cells.find((candidate) => candidate.id === cellId);
  if (cell === undefined) return;
  if (navigator.clipboard === undefined) {
    setActivity("Clipboard access is unavailable.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(cell.text);
    setActivity(`Copied cell ${state.cells.indexOf(cell) + 1}`, "ok");
  } catch {
    setActivity("Could not copy this cell.", "error");
  }
}

/** @param {string} cellId @param {-1 | 1} direction */
function moveCell(cellId, direction) {
  const index = state.cells.findIndex((cell) => cell.id === cellId);
  const destination = index + direction;
  if (index === -1 || destination < 0 || destination >= state.cells.length) return;
  [state.cells[index], state.cells[destination]] = [state.cells[destination], state.cells[index]];
  state.activeCellId = cellId;
  syncSourceFromNotebook({ fromUser: true });
  renderNotebook();
}

/** @param {string} cellId */
function insertCellAfter(cellId) {
  const index = state.cells.findIndex((cell) => cell.id === cellId);
  if (index === -1) return;
  insertCell(index + 1);
}

/** @param {number} index */
function insertCell(index) {
  const cell = createCell();
  state.cells.splice(index, 0, cell);
  state.activeCellId = cell.id;
  syncSourceFromNotebook({ fromUser: true });
  renderNotebook();
  document.getElementById(`cell-${cell.id}`)?.querySelector("textarea")?.focus();
}

/** @param {string} cellId */
function deleteCell(cellId) {
  if (state.cells.length === 1) return;
  const index = state.cells.findIndex((cell) => cell.id === cellId);
  if (index === -1) return;
  state.cells.splice(index, 1);
  state.activeCellId = state.cells[Math.max(0, index - 1)]?.id ?? null;
  if (state.executedCellId === cellId) {
    state.executedCellId = null;
    state.cellExecution += 1;
  }
  if (state.draft?.cellId === cellId) state.draft = null;
  syncSourceFromNotebook({ fromUser: true });
  renderNotebook();
}

function addCell() {
  insertCell(state.cells.length);
}

/** @param {string} cellId */
async function generateDraft(cellId) {
  const description = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`textarea[data-role="description"][data-cell-id="${cellId}"]`));
  if (description === null || description.value.trim().length === 0) {
    els.authoringStatus.textContent = "Describe the content to generate in the cell.";
    description?.focus();
    return;
  }
  if (!els.authoringConsent.checked) {
    els.authoringStatus.textContent = "Acknowledge data transfer before generating a draft.";
    els.authoringConsent.focus();
    return;
  }
  const draftGeneration = ++state.draftGeneration;
  const button = /** @type {HTMLButtonElement | null} */ (document.querySelector(`button[data-action="generate"][data-cell-id="${cellId}"]`));
  if (button !== null) button.disabled = true;
  els.authoringStatus.textContent = "Generating cell draft…";
  try {
    const draft = await request("POST", "/v1/authoring/drafts", {
      body: JSON.stringify({ protocolVersion: 1, requestId: crypto.randomUUID(), description: description.value.trim() }),
      contentType: "application/json",
    });
    if (draftGeneration !== state.draftGeneration || !state.cells.some((cell) => cell.id === cellId)) return;
    const generated = draft.outcome === "source" ? parseNotebookSource(draft.source.text).cells : [];
    state.draft = {
      cellId,
      outcome: draft.outcome,
      question: draft.question,
      cells: generated,
      valid: draft.analysis?.valid === true,
      diagnostics: draft.analysis?.diagnostics ?? [],
    };
    els.authoringStatus.textContent = draft.outcome === "source" ? "Generated a cell draft. Review it before applying." : "The authoring service needs more information.";
    renderNotebook();
  } catch {
    if (draftGeneration === state.draftGeneration) {
      els.authoringStatus.textContent = "Draft generation is temporarily unavailable. The notebook is unchanged.";
    }
  } finally {
    const activeButton = /** @type {HTMLButtonElement | null} */ (document.querySelector(`button[data-action="generate"][data-cell-id="${cellId}"]`));
    if (activeButton !== null) activeButton.disabled = state.capabilities?.service.authoring?.available !== true;
  }
}

/** @param {string} cellId */
function applyDraft(cellId) {
  if (state.draft?.cellId !== cellId || state.draft.outcome !== "source" || !state.draft.valid) return;
  const index = state.cells.findIndex((cell) => cell.id === cellId);
  if (index === -1) return;
  const generated = state.draft.cells;
  state.cells.splice(index, 1, ...generated);
  state.activeCellId = generated[0]?.id ?? null;
  state.draft = null;
  syncSourceFromNotebook({ fromUser: true });
  renderNotebook();
  void analyze();
}

/** @param {string} cellId */
function discardDraft(cellId) {
  if (state.draft?.cellId !== cellId) return;
  state.draft = null;
  els.authoringStatus.textContent = "Discarded the generated draft.";
  renderNotebook();
}

// -------------------------------------------------------------- source state

function currentRevision() {
  return String(state.revision);
}

/** @param {string} text @param {{ fromUser?: boolean, fromNotebook?: boolean }} [options] */
function setSource(text, { fromUser = false, fromNotebook = false } = {}) {
  els.source.value = text.replace(/\r\n?/g, "\n");
  state.revision += 1;
  updateSourceMeta();
  markPreviewStale();
  if (!fromNotebook) loadNotebookSource(els.source.value);
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
  const artifact = state.artifact;
  if (artifact !== null) {
    // The download control always says which revision and Theme it would
    // deliver, so a previous export is never mistaken for the current one.
    const reason =
      artifact.revision !== currentRevision()
        ? `editor is at revision ${currentRevision()}`
        : artifact.theme !== selectedTheme()
          ? `Theme changed to ${selectedTheme()}`
          : null;
    els.downloadArtifact.textContent =
      `Download ${artifact.format.toUpperCase()} · revision ${artifact.revision}` +
      (reason === null ? "" : ` · stale (${reason})`);
  }

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
  if (focusFrontMatterControl(startIndex)) return;
  let searchStart = 0;
  /** @type {{ cell: { id: string, text: string }, start: number } | null} */
  let target = null;
  for (const cell of state.cells) {
    const cellStart = els.source.value.indexOf(cell.text, searchStart);
    if (cellStart === -1) continue;
    const cellEnd = cellStart + cell.text.length;
    searchStart = cellEnd;
    if (startIndex < cellStart) {
      target = { cell, start: cellStart };
      break;
    }
    if (startIndex >= cellStart && startIndex < cellEnd) {
      target = { cell, start: cellStart };
      break;
    }
  }
  if (target === null) {
    setActivity("The diagnostic location is outside the editable cells.", "error");
    return;
  }
  state.activeCellId = target.cell.id;
  renderCellList();
  const editor = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`textarea[data-role="source"][data-cell-id="${target.cell.id}"]`));
  if (editor === null) return;
  const selectionStart = Math.min(Math.max(startIndex - target.start, 0), target.cell.text.length);
  const selectionEnd = Math.min(Math.max(endIndex - target.start, selectionStart), target.cell.text.length);
  editor.focus();
  editor.setSelectionRange(selectionStart, selectionEnd);
  editor.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** @param {number} sourceIndex */
function focusFrontMatterControl(sourceIndex) {
  const source = els.source.value;
  const closingDelimiter = source.indexOf("\n---");
  if (closingDelimiter === -1 || sourceIndex > closingDelimiter + 3) return false;
  const key = source
    .slice(0, sourceIndex + 1)
    .split("\n")
    .reverse()
    .map((line) => /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line)?.[1])
    .find((value) => value !== undefined);
  const control = key === "title"
    ? els.documentTitle
    : key === "author"
      ? els.documentAuthor
      : key === "date" || key === "x-date"
        ? els.documentDate
        : els.documentMetadata;
  control.focus();
  return true;
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
/** @param {string | undefined} cellId @param {number | undefined} cellExecution */
function isCurrentCellExecution(cellId, cellExecution) {
  return cellExecution === undefined || (
    cellExecution === state.cellExecution &&
    cellId !== undefined &&
    state.cells.some((cell) => cell.id === cellId)
  );
}


/**
 * @param {string} format
 * @param {{ previewLabel?: string, cellId?: string, cellExecution?: number }} [options]
 * @returns {Promise<void>}
 */
async function exportFormat(format, { previewLabel, cellId, cellExecution } = {}) {
  const revision = currentRevision();
  const source = els.source.value;
  const theme = els.theme.value;
  const previewTheme = selectedTheme();
  showToast(`Compiling ${format.toUpperCase()}…`, "progress");
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

    if (job.revision !== currentRevision() || previewTheme !== selectedTheme()) {
      showToast(`Discarded a stale ${format.toUpperCase()} result from revision ${job.revision}.`, "error");
      return;
    }
    if (!isCurrentCellExecution(cellId, cellExecution)) return;

    if (job.status !== "completed") {
      showToast(job.failure?.message ?? `${format.toUpperCase()} export failed.`, "error");
      return;
    }

    renderDiagnostics(job);
    if (job.result?.ok !== true || !job.result.artifact) {
      showToast(`${format.toUpperCase()} export failed; see diagnostics.`, "error");
      return;
    }

    const bytes = await fetchArtifact(job.jobId);
    if (!isCurrentCellExecution(cellId, cellExecution) || previewTheme !== selectedTheme()) return;
    // Exports and previews are for the revision *and* Theme that were submitted.
    state.artifact = { format, bytes, revision: job.revision, theme: previewTheme };
    els.downloadArtifact.hidden = false;
    markPreviewStale();

    if (format === "html") {
      showPreview(job, bytes, previewLabel, cellId, previewTheme);
      const action = previewLabel === undefined ? "Preview updated" : `Preview refreshed for ${previewLabel}`;
      showToast(`${action} (revision ${job.revision})`);
    } else {
      downloadArtifact(format, bytes);
      showToast(`${format.toUpperCase()} downloaded (revision ${job.revision})`);
    }
  } catch (error) {
    if (isAbort(error) || !isCurrentCellExecution(cellId, cellExecution)) return;
    handleRequestFailure(asFailure(error), `${format.toUpperCase()} export failed`, showToast);
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

/** @param {Job} job @param {ArrayBuffer} bytes @param {string | undefined} previewLabel @param {string | undefined} cellId @param {string} previewTheme */
function showPreview(job, bytes, previewLabel, cellId, previewTheme) {
  const number = cellId === undefined ? null : cellNumber(cellId);
  if (cellId !== undefined && number === null) return;
  const artifact = /** @type {ArtifactInfo} */ (job.result?.artifact);
  const blob = new Blob([bytes], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  if (state.preview.objectUrl !== null) URL.revokeObjectURL(state.preview.objectUrl);
  state.preview = { objectUrl: url, revision: job.revision, theme: previewTheme };
  els.preview.src = url;
  els.preview.hidden = false;
  els.previewPlaceholder.hidden = true;
  if (cellId !== undefined && number !== null) {
    state.executedCellId = cellId;
    moveRenderedOutputToCell(cellId);
    els.outputLabel.textContent = `Rendered from cell ${number}`;
  }
  const metadata = artifact.metadata ?? {};
  const revision = number === null
    ? previewLabel === undefined
      ? `Revision ${job.revision}`
      : `Example: ${previewLabel} · revision ${job.revision}`
    : `Cell ${number} · revision ${job.revision}`;
  setPreviewStatus(
    `${revision} · ${bytes.byteLength} bytes · ${shortHash(artifact.artifactHash)}${
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

/** @param {string} text @param {"ok" | "progress" | "error"} [tone] */
function showToast(text, tone = "ok") {
  if (state.previewToastTimer !== undefined) clearTimeout(state.previewToastTimer);
  els.previewToast.textContent = text;
  els.previewToast.dataset.tone = tone;
  els.previewToast.hidden = false;
  if (tone === "progress") return;
  state.previewToastTimer = setTimeout(() => {
    els.previewToast.hidden = true;
    state.previewToastTimer = undefined;
  }, 3_000);
}

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
 * @param {(text: string, tone?: "ok" | "progress" | "error") => void} [reporter]
 */
function handleRequestFailure(error, prefix, reporter = setActivity) {
  if (error.unauthorized) {
    showGate("The access token was rejected.");
    reporter("Not authorized", "error");
    return;
  }
  const code = error.serviceError?.code;
  reporter(code === undefined ? `${prefix}: ${error.message}` : `${prefix}: ${error.message} (${code})`, "error");
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
  const authoring = capabilities.service.authoring;
  if (authoring?.available !== true) {
    els.authoringStatus.textContent = "This request is not available in this deployment.";
  }
  renderNotebook();

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
  // Selecting an example is an explicit replacement, so refresh the HTML
  // preview rather than leaving the previous document visibly stale.
  void exportFormat("html", { previewLabel: example.name });
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

  const syncFrontMatter = () => {
    syncSourceFromNotebook({ fromUser: true });
    renderCellList();
  };
  els.documentTitle.addEventListener("input", () => {
    state.frontMatter.title = els.documentTitle.value;
    syncFrontMatter();
  });
  els.documentAuthor.addEventListener("input", () => {
    state.frontMatter.authors = authorsFromInput(els.documentAuthor.value);
    syncFrontMatter();
  });
  els.documentDate.addEventListener("input", () => {
    state.frontMatter.date = els.documentDate.value;
    syncFrontMatter();
  });
  els.documentMetadata.addEventListener("input", () => {
    state.frontMatter.metadata = els.documentMetadata.value;
    syncFrontMatter();
  });
  els.cellSearch.addEventListener("input", () => {
    state.cellSearch = els.cellSearch.value;
    renderCellList();
  });
  els.cellList.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const button = event.target.closest("button[data-cell-id], button[data-front-matter]");
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.frontMatter === "true") {
      state.activeCellId = null;
      renderCellList();
      const control = button.dataset.frontMatterField === "authors"
        ? els.documentAuthor
        : button.dataset.frontMatterField === "date"
          ? els.documentDate
          : button.dataset.frontMatterField === "metadata"
            ? els.documentMetadata
            : els.documentTitle;
      control.scrollIntoView({ block: "center", behavior: "smooth" });
      control.focus();
      return;
    }
    const cellId = button.dataset.cellId;
    if (cellId === undefined) return;
    state.activeCellId = cellId;
    renderCellList();
    const cell = document.getElementById(`cell-${cellId}`);
    cell?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    /** @type {HTMLTextAreaElement | null} */ (cell?.querySelector(".cell-source"))?.focus();
  });
  els.notebookCells.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.dataset.role !== "source") return;
    const cell = state.cells.find((candidate) => candidate.id === target.dataset.cellId);
    if (cell === undefined) return;
    cell.text = target.value;
    state.activeCellId = cell.id;
    syncSourceFromNotebook({ fromUser: true });
    renderCellList();
  });
  els.notebookCells.addEventListener("focusin", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || event.target.dataset.role !== "source") return;
    state.activeCellId = event.target.dataset.cellId ?? null;
    renderCellList();
  });
  els.notebookCells.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const button = event.target.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const cellId = button.dataset.cellId;
    if (cellId === undefined) return;
    switch (button.dataset.action) {
      case "run":
        runCell(cellId);
        break;
      case "copy":
        void copyCell(cellId);
        break;
      case "move-up":
        moveCell(cellId, -1);
        break;
      case "move-down":
        moveCell(cellId, 1);
        break;
      case "insert-after":
        insertCellAfter(cellId);
        break;
      case "delete":
        deleteCell(cellId);
        break;
      case "generate":
        void generateDraft(cellId);
        break;
      case "apply-draft":
        applyDraft(cellId);
        break;
      case "discard-draft":
        discardDraft(cellId);
        break;
    }
  });
  els.addCell.addEventListener("click", addCell);
  els.analyze.addEventListener("click", () => void analyze());
  els.format.addEventListener("click", () => void formatSource());
  els.example.addEventListener("change", () => loadExample(els.example.value));
  els.theme.addEventListener("change", markPreviewStale);
  els.downloadArtifact.addEventListener("click", () => {
    const artifact = state.artifact;
    if (artifact === null) return;
    downloadArtifact(artifact.format, artifact.bytes);
    setActivity(
      `${artifact.format.toUpperCase()} downloaded (revision ${artifact.revision})`,
      artifact.revision === currentRevision() ? "ok" : "error",
    );
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
