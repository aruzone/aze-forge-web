// @ts-check

/**
 * The typed authoring workspace model (decision #15, spec state matrix).
 *
 * Every workflow mutation goes through `transition`; the DOM never owns
 * workflow state. Transitions are pure and stale-safe: a result that no longer
 * matches the request, revision, Theme, or owner it was issued for cannot
 * mutate current state.
 */

/** @typedef {{ version: string, title: string, authors: string[], date: string, metadata: string }} CurrentDocument */
/** @typedef {"source" | "description"} EditorMode */
/** @typedef {{ id: string, source: string, lastAppliedSource: string, pendingDescription: string, mode: EditorMode }} Cell */
/** @typedef {{ severity: string, code?: string, message: string, location?: { range?: { start: { line: number, column: number, offset?: number }, end: { line: number, column: number, offset?: number } } } }} Diagnostic */
/** @typedef {{ url: string, bytes: number }} PreviewArtifact */
/** @typedef {{ requestId: string, cellId: string, description: string, revision: number, requestGeneration: number }} Generation */
/** @typedef {{ cellId: string, source: string, capturedRevision: number, status: "valid" | "invalid" | "stale", diagnostics: Diagnostic[] }} Proposal */
/** @typedef {{ source: string, capturedRevision: number, status: "open" | "stale" }} FormatProposal */
/** @typedef {{ requestId: string, revision: number, theme: string } | null} PreviewRequest */
/** @typedef {{ artifact: PreviewArtifact | null, artifactRevision: number | null, artifactTheme: string | null, request: PreviewRequest, status: "empty" | "refreshing" | "current" | "stale" | "blocked" | "failed", message: string, height: number | null }} Preview */
/** @typedef {{ requestId: string, revision: number, status: "running" | "failed", message: string, format?: string }} Operation */
/** @typedef {{ analyze: Operation | null, format: Operation | null, export: Operation | null }} Operations */
/** @typedef {{ cells: Cell[], document: CurrentDocument, revision: number, theme: string, activeCellId: string | null, generation: Generation | null, generationResponse: { cellId: string, kind: "clarification" | "refusal" | "failure", message: string } | null, requestGeneration: number, mutationLocked: boolean, proposal: Proposal | null, formatProposal: FormatProposal | null, diagnostics: Diagnostic[], diagnosticsRevision: number | null, preview: Preview, operations: Operations, deletedCell: { cell: Cell, index: number } | null }} WorkspaceState */
/** @typedef {{ kind: "source", source: string, valid: boolean, diagnostics: Diagnostic[] } | { kind: "clarification" | "refusal" | "failure", message: string }} GenerationOutcome */

/**
 * @typedef {(
 *   { type: "description.edit", cellId: string, description: string } |
 *   { type: "source.edit", cellId: string, source: string } |
 *   { type: "editor.mode", cellId: string, mode: EditorMode } |
 *   { type: "cell.activate", cellId: string } |
 *   { type: "document.edit", patch: Partial<CurrentDocument> } |
 *   { type: "document.replace", document: CurrentDocument, sources: string[] } |
 *   { type: "document.reset", document: CurrentDocument, cells: Cell[] } |
 *   { type: "generation.start", cellId: string, requestId: string } |
 *   { type: "generation.cancel" } |
 *   { type: "generation.resolve", requestId: string, outcome: GenerationOutcome } |
 *   { type: "response.dismiss", cellId?: string } |
 *   { type: "proposal.apply" } |
 *   { type: "proposal.discard" } |
 *   { type: "theme.change", theme: string } |
 *   { type: "preview.start", requestId: string } |
 *   { type: "preview.resolve", requestId: string, artifact: PreviewArtifact } |
 *   { type: "preview.fail", requestId: string, message: string, blocked?: boolean } |
 *   { type: "preview.resize", height: number | null } |
 *   { type: "analysis.start", requestId: string } |
 *   { type: "analysis.resolve", requestId: string, diagnostics: Diagnostic[] } |
 *   { type: "analysis.fail", requestId: string, message: string } |
 *   { type: "diagnostics.set", diagnostics: Diagnostic[] } |
 *   { type: "format.start", requestId: string } |
 *   { type: "format.resolve", requestId: string, source: string } |
 *   { type: "format.fail", requestId: string, message: string } |
 *   { type: "format.discard" } |
 *   { type: "export.start", requestId: string, format: string } |
 *   { type: "export.resolve", requestId: string } |
 *   { type: "export.fail", requestId: string, message: string } |
 *   { type: "cell.insert", cell: Cell, index: number } |
 *   { type: "cell.move", cellId: string, index: number } |
 *   { type: "cell.delete", cellId: string } |
 *   { type: "cell.undoDelete" }
 * )} WorkspaceEvent
 */

/** @returns {CurrentDocument} */
export function emptyDocument() {
  return { version: "2", title: "", authors: [], date: "", metadata: "" };
}

/**
 * Whether the Current document carries metadata worth showing: Document details
 * starts expanded for a document that does not, and collapsed once it does.
 * @param {CurrentDocument} document
 */
export function hasMetadata(document) {
  return document.title.trim() !== ""
    || document.authors.length > 0
    || document.date.trim() !== ""
    || document.metadata.trim() !== "";
}

/**
 * @param {Cell[]} cells
 * @param {string} [theme]
 * @param {CurrentDocument} [document]
 * @returns {WorkspaceState}
 */
export function createWorkspaceState(cells, theme = "default", document = emptyDocument()) {
  return {
    cells: cells.map((cell) => ({ ...cell, mode: cell.mode ?? "source" })),
    document: { ...document, authors: [...document.authors] },
    revision: 0,
    theme,
    activeCellId: cells[0]?.id ?? null,
    generation: null,
    generationResponse: null,
    requestGeneration: 0,
    mutationLocked: false,
    proposal: null,
    formatProposal: null,
    diagnostics: [],
    diagnosticsRevision: null,
    preview: {
      artifact: null,
      artifactRevision: null,
      artifactTheme: null,
      request: null,
      status: "empty",
      message: "Preview not generated",
      height: null,
    },
    operations: { analyze: null, format: null, export: null },
    deletedCell: null,
  };
}

/** @param {WorkspaceState} state @returns {Preview} */
function stalePreview(state) {
  if (state.preview.artifact === null) {
    return { ...state.preview, request: null, status: "empty", message: "Preview not generated" };
  }
  return { ...state.preview, request: null, status: "stale", message: "Preview out of date" };
}

/** A Source or structural mutation: revision advances, proposals and the preview go stale. */
/** @param {WorkspaceState} state @param {Cell[]} cells @returns {WorkspaceState} */
function withMutation(state, cells) {
  return {
    ...state,
    cells,
    revision: state.revision + 1,
    proposal: state.proposal === null ? null : { ...state.proposal, status: "stale" },
    formatProposal: state.formatProposal === null ? null : { ...state.formatProposal, status: "stale" },
    preview: stalePreview(state),
  };
}

/**
 * Pure, stale-safe transition boundary for the authoring workspace.
 * @param {WorkspaceState} state
 * @param {WorkspaceEvent} event
 * @returns {WorkspaceState}
 */
export function transition(state, event) {
  switch (event.type) {
    case "description.edit": {
      const index = state.cells.findIndex(({ id }) => id === event.cellId);
      if (index < 0 || state.cells[index].pendingDescription === event.description) return state;
      const cells = state.cells.slice();
      cells[index] = { ...cells[index], pendingDescription: event.description };
      return { ...state, cells };
    }
    case "source.edit": {
      if (state.mutationLocked) return state;
      const index = state.cells.findIndex(({ id }) => id === event.cellId);
      if (index < 0 || state.cells[index].source === event.source) return state;
      const cells = state.cells.slice();
      cells[index] = { ...cells[index], source: event.source, lastAppliedSource: event.source };
      return withMutation(state, cells);
    }
    case "editor.mode": {
      const index = state.cells.findIndex(({ id }) => id === event.cellId);
      if (index < 0 || state.cells[index].mode === event.mode) return state;
      const cells = state.cells.slice();
      cells[index] = { ...cells[index], mode: event.mode };
      return { ...state, cells };
    }
    case "cell.activate": {
      if (!state.cells.some(({ id }) => id === event.cellId) || state.activeCellId === event.cellId) return state;
      return { ...state, activeCellId: event.cellId };
    }
    case "document.edit": {
      if (state.mutationLocked) return state;
      const document = { ...state.document, ...event.patch };
      const changed = /** @type {(keyof CurrentDocument)[]} */ (Object.keys(event.patch)).some(
        (key) => document[key] !== state.document[key],
      );
      if (!changed) return state;
      return { ...withMutation(state, state.cells), document };
    }
    case "document.replace": {
      if (state.mutationLocked || event.sources.length !== state.cells.length) return state;
      const cells = state.cells.map((cell, index) => ({
        ...cell,
        source: event.sources[index],
        lastAppliedSource: event.sources[index],
        mode: /** @type {EditorMode} */ ("source"),
      }));
      return { ...withMutation(state, cells), document: { ...event.document }, formatProposal: null };
    }
    case "document.reset": {
      if (state.mutationLocked || event.cells.length === 0) return state;
      const ids = new Set(event.cells.map(({ id }) => id));
      if ([...ids].some((id) => typeof id !== "string" || id === "") || ids.size !== event.cells.length) return state;
      return createWorkspaceState(
        event.cells.map((cell) => ({ ...cell, mode: /** @type {EditorMode} */ ("source") })),
        state.theme,
        { ...event.document, authors: [...event.document.authors] },
      );
    }
    case "generation.start": {
      if (state.generation !== null || state.proposal !== null) return state;
      const cell = state.cells.find(({ id }) => id === event.cellId);
      if (cell === undefined || cell.pendingDescription.trim() === "") return state;
      const requestGeneration = state.requestGeneration + 1;
      return {
        ...state,
        requestGeneration,
        generation: {
          requestId: event.requestId,
          cellId: cell.id,
          description: cell.pendingDescription.trim(),
          revision: state.revision,
          requestGeneration,
        },
        generationResponse: null,
        mutationLocked: true,
      };
    }
    case "generation.cancel": {
      if (state.generation === null) return state;
      const cells = state.cells.map((cell) =>
        cell.id === state.generation?.cellId ? { ...cell, mode: /** @type {EditorMode} */ ("description") } : cell,
      );
      return { ...state, cells, generation: null, requestGeneration: state.requestGeneration + 1, mutationLocked: false };
    }
    case "generation.resolve": {
      const generation = state.generation;
      if (
        generation === null ||
        generation.requestId !== event.requestId ||
        generation.requestGeneration !== state.requestGeneration ||
        !state.cells.some(({ id }) => id === generation.cellId)
      ) {
        return state;
      }
      if (event.outcome.kind !== "source") {
        return {
          ...state,
          generation: null,
          mutationLocked: false,
          generationResponse: { cellId: generation.cellId, kind: event.outcome.kind, message: event.outcome.message },
        };
      }
      const status = generation.revision !== state.revision ? "stale" : event.outcome.valid ? "valid" : "invalid";
      return {
        ...state,
        generation: null,
        mutationLocked: false,
        proposal: {
          cellId: generation.cellId,
          source: event.outcome.source,
          capturedRevision: generation.revision,
          status,
          diagnostics: event.outcome.diagnostics,
        },
      };
    }
    case "response.dismiss": {
      if (state.generationResponse === null) return state;
      if (event.cellId !== undefined && state.generationResponse.cellId !== event.cellId) return state;
      return { ...state, generationResponse: null };
    }
    case "proposal.apply": {
      const proposal = state.proposal;
      if (proposal === null || proposal.status !== "valid" || proposal.capturedRevision !== state.revision) return state;
      const index = state.cells.findIndex(({ id }) => id === proposal.cellId);
      if (index < 0) return state;
      const cells = state.cells.slice();
      cells[index] = {
        ...cells[index],
        source: proposal.source,
        lastAppliedSource: proposal.source,
        mode: /** @type {EditorMode} */ ("source"),
      };
      return { ...withMutation({ ...state, proposal: null }, cells), activeCellId: proposal.cellId };
    }
    case "proposal.discard": {
      const proposal = state.proposal;
      if (proposal === null) return state;
      const cells = state.cells.map((cell) =>
        cell.id === proposal.cellId ? { ...cell, mode: /** @type {EditorMode} */ ("description") } : cell,
      );
      return { ...state, cells, proposal: null };
    }
    case "theme.change":
      return state.theme === event.theme ? state : { ...state, theme: event.theme, preview: stalePreview(state) };
    case "preview.start":
      return {
        ...state,
        preview: {
          ...state.preview,
          request: { requestId: event.requestId, revision: state.revision, theme: state.theme },
          status: "refreshing",
          message: "Refreshing preview",
        },
      };
    case "preview.resolve": {
      const request = state.preview.request;
      if (
        request === null ||
        request.requestId !== event.requestId ||
        request.revision !== state.revision ||
        request.theme !== state.theme
      ) {
        return state;
      }
      return {
        ...state,
        preview: {
          ...state.preview,
          artifact: event.artifact,
          artifactRevision: state.revision,
          artifactTheme: state.theme,
          request: null,
          status: "current",
          message: "Preview updated",
        },
      };
    }
    case "preview.fail": {
      const request = state.preview.request;
      if (request === null || request.requestId !== event.requestId) return state;
      return {
        ...state,
        preview: {
          ...state.preview,
          request: null,
          status: event.blocked === true ? "blocked" : "failed",
          message: event.message,
        },
      };
    }
    case "preview.resize": {
      const height = event.height === null ? null : Math.round(event.height);
      if (state.preview.height === height) return state;
      return { ...state, preview: { ...state.preview, height } };
    }
    case "analysis.start":
      return {
        ...state,
        operations: {
          ...state.operations,
          analyze: { requestId: event.requestId, revision: state.revision, status: "running", message: "Analyzing…" },
        },
      };
    case "analysis.resolve": {
      const operation = state.operations.analyze;
      if (operation === null || operation.requestId !== event.requestId) return state;
      const operations = { ...state.operations, analyze: null };
      if (operation.revision !== state.revision) return { ...state, operations };
      return { ...state, operations, diagnostics: event.diagnostics, diagnosticsRevision: state.revision };
    }
    case "analysis.fail": {
      const operation = state.operations.analyze;
      if (operation === null || operation.requestId !== event.requestId) return state;
      return {
        ...state,
        operations: {
          ...state.operations,
          analyze: { ...operation, status: "failed", message: event.message },
        },
      };
    }
    case "diagnostics.set":
      return { ...state, diagnostics: event.diagnostics, diagnosticsRevision: state.revision };
    case "format.start":
      return {
        ...state,
        operations: {
          ...state.operations,
          format: { requestId: event.requestId, revision: state.revision, status: "running", message: "Formatting…" },
        },
      };
    case "format.resolve": {
      const operation = state.operations.format;
      if (operation === null || operation.requestId !== event.requestId) return state;
      const operations = { ...state.operations, format: null };
      if (operation.revision !== state.revision) return { ...state, operations };
      return {
        ...state,
        operations,
        formatProposal: { source: event.source, capturedRevision: state.revision, status: "open" },
      };
    }
    case "format.fail": {
      const operation = state.operations.format;
      if (operation === null || operation.requestId !== event.requestId) return state;
      return {
        ...state,
        operations: { ...state.operations, format: { ...operation, status: "failed", message: event.message } },
      };
    }
    case "format.discard":
      return state.formatProposal === null ? state : { ...state, formatProposal: null };
    case "export.start":
      return {
        ...state,
        operations: {
          ...state.operations,
          export: {
            requestId: event.requestId,
            revision: state.revision,
            format: event.format,
            status: "running",
            message: `Exporting ${event.format.toUpperCase()}…`,
          },
        },
      };
    case "export.resolve": {
      const operation = state.operations.export;
      if (operation === null || operation.requestId !== event.requestId) return state;
      return { ...state, operations: { ...state.operations, export: null } };
    }
    case "export.fail": {
      const operation = state.operations.export;
      if (operation === null || operation.requestId !== event.requestId) return state;
      return {
        ...state,
        operations: { ...state.operations, export: { ...operation, status: "failed", message: event.message } },
      };
    }
    case "cell.insert": {
      if (state.mutationLocked || state.cells.some(({ id }) => id === event.cell.id)) return state;
      const index = Math.max(0, Math.min(event.index, state.cells.length));
      const cells = state.cells.slice();
      cells.splice(index, 0, { ...event.cell, mode: event.cell.mode ?? "source" });
      return { ...withMutation(state, cells), activeCellId: event.cell.id };
    }
    case "cell.move": {
      if (state.mutationLocked) return state;
      const from = state.cells.findIndex(({ id }) => id === event.cellId);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(event.index, state.cells.length - 1));
      if (from === to) return state;
      const cells = state.cells.slice();
      const [cell] = cells.splice(from, 1);
      cells.splice(to, 0, cell);
      return { ...withMutation(state, cells), activeCellId: event.cellId };
    }
    case "cell.delete": {
      if (state.mutationLocked) return state;
      const index = state.cells.findIndex(({ id }) => id === event.cellId);
      if (index < 0) return state;
      const cells = state.cells.slice();
      const [cell] = cells.splice(index, 1);
      const proposal = state.proposal?.cellId === cell.id ? null : state.proposal;
      const next = withMutation({ ...state, proposal }, cells);
      return {
        ...next,
        activeCellId: cells[index]?.id ?? cells[index - 1]?.id ?? null,
        generationResponse: next.generationResponse?.cellId === cell.id ? null : next.generationResponse,
        deletedCell: { cell, index },
      };
    }
    case "cell.undoDelete": {
      if (state.deletedCell === null || state.mutationLocked) return state;
      const { cell, index } = state.deletedCell;
      const cells = state.cells.slice();
      cells.splice(Math.min(index, cells.length), 0, cell);
      return { ...withMutation(state, cells), activeCellId: cell.id, deletedCell: null };
    }
  }
}
