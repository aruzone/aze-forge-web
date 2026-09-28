// @ts-check

/** @typedef {{ id: string, source: string, lastAppliedSource: string, pendingDescription: string }} Cell */
/** @typedef {{ url: string, bytes: number }} PreviewArtifact */
/** @typedef {{ requestId: string, cellId: string, description: string, revision: number }} Generation */
/** @typedef {{ cellId: string, source: string, capturedRevision: number, status: "valid" | "invalid" | "stale", diagnostics: unknown[] }} Proposal */
/** @typedef {{ requestId: string, revision: number, theme: string } | null} PreviewRequest */
/** @typedef {{ artifact: PreviewArtifact | null, artifactRevision: number | null, artifactTheme: string | null, request: PreviewRequest, status: "empty" | "refreshing" | "current" | "stale" | "blocked" | "failed", message: string }} Preview */
/** @typedef {{ cells: Cell[], revision: number, theme: string, activeCellId: string | null, generation: Generation | null, generationResponse: { cellId: string, kind: "clarification" | "refusal" | "failure", message: string } | null, requestGeneration: number, mutationLocked: boolean, proposal: Proposal | null, preview: Preview, deletedCell: { cell: Cell, index: number } | null }} WorkspaceState */
/** @typedef {{ kind: "source", source: string, valid: boolean, diagnostics: unknown[] } | { kind: "clarification" | "refusal" | "failure", message: string }} GenerationOutcome */
/** @typedef {{ type: "description.edit", cellId: string, description: string } | { type: "source.edit", cellId: string, source: string } | { type: "generation.start", cellId: string, requestId: string } | { type: "generation.cancel" } | { type: "generation.resolve", requestId: string, outcome: GenerationOutcome } | { type: "proposal.apply" } | { type: "proposal.discard" } | { type: "theme.change", theme: string } | { type: "preview.start", requestId: string } | { type: "preview.resolve", requestId: string, artifact: PreviewArtifact } | { type: "preview.fail", requestId: string, message: string, blocked?: boolean } | { type: "cell.insert", cell: Cell, index: number } | { type: "cell.move", cellId: string, index: number } | { type: "cell.delete", cellId: string } | { type: "cell.undoDelete" }} WorkspaceEvent */

/** @param {Cell[]} cells @param {string} [theme] @returns {WorkspaceState} */
export function createWorkspaceState(cells, theme = "default") {
  return {
    cells: cells.map((cell) => ({ ...cell })),
    revision: 0,
    theme,
    activeCellId: cells[0]?.id ?? null,
    generation: null,
    generationResponse: null,
    requestGeneration: 0,
    mutationLocked: false,
    proposal: null,
    preview: {
      artifact: null,
      artifactRevision: null,
      artifactTheme: null,
      request: null,
      status: "empty",
      message: "Preview not generated",
    },
    deletedCell: null,
  };
}

/** @param {WorkspaceState} state @returns {Preview} */
function stalePreview(state) {
  if (state.preview.artifact === null) return { ...state.preview, request: null, status: "empty", message: "Preview not generated" };
  return { ...state.preview, request: null, status: "stale", message: "Preview out of date" };
}

/** @param {WorkspaceState} state @param {Cell[]} cells @returns {WorkspaceState} */
function withMutation(state, cells) {
  const revision = state.revision + 1;
  return {
    ...state,
    cells,
    revision,
    proposal: state.proposal === null ? null : { ...state.proposal, status: "stale" },
    preview: stalePreview(state),
  };
}

/** Pure, stale-safe transition boundary for the authoring workspace. @param {WorkspaceState} state @param {WorkspaceEvent} event @returns {WorkspaceState} */
export function transition(state, event) {
  switch (event.type) {
    case "description.edit": {
      const index = state.cells.findIndex(({ id }) => id === event.cellId);
      if (index < 0) return state;
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
    case "generation.start": {
      if (state.generation !== null || state.proposal !== null) return state;
      const cell = state.cells.find(({ id }) => id === event.cellId);
      if (cell === undefined || cell.pendingDescription.trim() === "") return state;
      return {
        ...state,
        requestGeneration: state.requestGeneration + 1,
        generation: { requestId: event.requestId, cellId: cell.id, description: cell.pendingDescription.trim(), revision: state.revision },
        generationResponse: null,
        mutationLocked: true,
      };
    }
    case "generation.cancel":
      if (state.generation === null) return state;
      return { ...state, generation: null, requestGeneration: state.requestGeneration + 1, mutationLocked: false };
    case "generation.resolve": {
      const generation = state.generation;
      if (generation === null || generation.requestId !== event.requestId || !state.cells.some(({ id }) => id === generation.cellId)) return state;
      if (event.outcome.kind !== "source") return { ...state, generation: null, generationResponse: { cellId: generation.cellId, kind: event.outcome.kind, message: event.outcome.message }, mutationLocked: false };
      const status = generation.revision !== state.revision ? "stale" : event.outcome.valid ? "valid" : "invalid";
      return {
        ...state,
        generation: null,
        mutationLocked: false,
        proposal: { cellId: generation.cellId, source: event.outcome.source, capturedRevision: generation.revision, status, diagnostics: event.outcome.diagnostics },
      };
    }
    case "proposal.apply": {
      const proposal = state.proposal;
      if (proposal === null || proposal.status !== "valid" || proposal.capturedRevision !== state.revision) return state;
      const index = state.cells.findIndex(({ id }) => id === proposal.cellId);
      if (index < 0) return state;
      const cells = state.cells.slice();
      cells[index] = { ...cells[index], source: proposal.source, lastAppliedSource: proposal.source };
      return { ...withMutation({ ...state, proposal: null }, cells), activeCellId: proposal.cellId };
    }
    case "proposal.discard":
      return state.proposal === null ? state : { ...state, proposal: null };
    case "theme.change":
      return state.theme === event.theme ? state : { ...state, theme: event.theme, preview: stalePreview(state) };
    case "preview.start":
      return { ...state, preview: { ...state.preview, request: { requestId: event.requestId, revision: state.revision, theme: state.theme }, status: "refreshing", message: "Refreshing preview" } };
    case "preview.resolve": {
      const request = state.preview.request;
      if (request === null || request.requestId !== event.requestId || request.revision !== state.revision || request.theme !== state.theme) return state;
      return { ...state, preview: { artifact: event.artifact, artifactRevision: state.revision, artifactTheme: state.theme, request: null, status: "current", message: "Preview updated" } };
    }
    case "preview.fail": {
      const request = state.preview.request;
      if (request === null || request.requestId !== event.requestId) return state;
      return { ...state, preview: { ...state.preview, request: null, status: event.blocked ? "blocked" : "failed", message: event.message } };
    }
    case "cell.insert": {
      if (state.mutationLocked || state.cells.some(({ id }) => id === event.cell.id)) return state;
      const index = Math.max(0, Math.min(event.index, state.cells.length));
      const cells = state.cells.slice();
      cells.splice(index, 0, { ...event.cell });
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
      return { ...next, activeCellId: cells[index]?.id ?? cells[index - 1]?.id ?? null, deletedCell: { cell, index } };
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
