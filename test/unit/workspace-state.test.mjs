import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceState, transition } from "../../src/web/workspace-state.js";

function sourceCell(id = "cell-a", source = "# Applied") {
  return { id, source, lastAppliedSource: source, pendingDescription: "" };
}

test("generation captures stable ownership and ignores cancelled or late results", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "description.edit", cellId: "cell-a", description: "Create a callout" });
  state = transition(state, { type: "generation.start", cellId: "cell-a", requestId: "request-1" });
  assert.equal(state.generation?.description, "Create a callout");
  assert.equal(state.generation?.revision, 0);
  assert.equal(state.mutationLocked, true);

  state = transition(state, { type: "generation.cancel" });
  assert.equal(state.generation, null);
  assert.equal(state.mutationLocked, false);
  assert.equal(state.cells[0].pendingDescription, "Create a callout");

  const late = transition(state, {
    type: "generation.resolve",
    requestId: "request-1",
    outcome: { kind: "source", source: "::callout\nLate\n::", valid: true, diagnostics: [] },
  });
  assert.strictEqual(late, state);
  assert.equal(late.proposal, null);
});

test("clarification remains visible beside its owning Cell and preserves Description", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "description.edit", cellId: "cell-a", description: "Make this clearer" });
  state = transition(state, { type: "generation.start", cellId: "cell-a", requestId: "request-1" });
  state = transition(state, {
    type: "generation.resolve",
    requestId: "request-1",
    outcome: { kind: "clarification", message: "Which audience?" },
  });
  assert.deepEqual(state.generationResponse, {
    cellId: "cell-a",
    kind: "clarification",
    message: "Which audience?",
  });
  assert.equal(state.cells[0].pendingDescription, "Make this clearer");
  assert.equal(state.mutationLocked, false);
});

test("refusal and infrastructure failure are responses, never Draft Gate proposals", () => {
  for (const kind of ["refusal", "failure"]) {
    let state = createWorkspaceState([sourceCell()]);
    state = transition(state, { type: "description.edit", cellId: "cell-a", description: "Do the thing" });
    state = transition(state, { type: "generation.start", cellId: "cell-a", requestId: "request-1" });
    state = transition(state, { type: "generation.resolve", requestId: "request-1", outcome: { kind, message: `${kind} message` } });
    assert.equal(state.proposal, null);
    assert.equal(state.mutationLocked, false);
    assert.deepEqual(state.generationResponse, { cellId: "cell-a", kind, message: `${kind} message` });
    assert.equal(state.cells[0].pendingDescription, "Do the thing");
  }
});

test("a proposal is revision-bound, becomes stale after a Source edit, and cannot apply", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "description.edit", cellId: "cell-a", description: "Rewrite it" });
  state = transition(state, { type: "generation.start", cellId: "cell-a", requestId: "request-1" });
  state = transition(state, {
    type: "generation.resolve",
    requestId: "request-1",
    outcome: { kind: "source", source: "# Proposed", valid: true, diagnostics: [] },
  });
  assert.equal(state.proposal?.status, "valid");

  state = transition(state, { type: "source.edit", cellId: "cell-a", source: "# Manual edit" });
  assert.equal(state.proposal?.status, "stale");
  const unchanged = transition(state, { type: "proposal.apply" });
  assert.strictEqual(unchanged, state);
  assert.equal(unchanged.cells[0].source, "# Manual edit");
});

test("Apply updates Last-applied Source atomically and Discard preserves Pending Description", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "description.edit", cellId: "cell-a", description: "Rewrite it" });
  state = transition(state, { type: "generation.start", cellId: "cell-a", requestId: "request-1" });
  state = transition(state, {
    type: "generation.resolve",
    requestId: "request-1",
    outcome: { kind: "source", source: "# Proposed", valid: true, diagnostics: [] },
  });
  state = transition(state, { type: "proposal.apply" });
  assert.equal(state.cells[0].source, "# Proposed");
  assert.equal(state.cells[0].lastAppliedSource, "# Proposed");
  assert.equal(state.cells[0].pendingDescription, "Rewrite it");
  assert.equal(state.proposal, null);
});

test("preview accepts only matching revision and Theme and remains stale after edits", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "preview.start", requestId: "preview-1" });
  state = transition(state, { type: "theme.change", theme: "dark" });
  const obsolete = transition(state, {
    type: "preview.resolve",
    requestId: "preview-1",
    artifact: { url: "blob:old", bytes: 12 },
  });
  assert.strictEqual(obsolete, state);
  assert.equal(obsolete.preview.artifact, null);

  state = transition(state, { type: "preview.start", requestId: "preview-2" });
  state = transition(state, {
    type: "preview.resolve",
    requestId: "preview-2",
    artifact: { url: "blob:new", bytes: 20 },
  });
  assert.equal(state.preview.status, "current");
  state = transition(state, { type: "source.edit", cellId: "cell-a", source: "# Changed" });
  assert.equal(state.preview.status, "stale");
  assert.equal(state.preview.artifact?.url, "blob:new");
});

test("editor mode and active Cell are workflow state, not DOM state", () => {
  let state = createWorkspaceState([sourceCell("cell-a"), sourceCell("cell-b")]);
  state = transition(state, { type: "editor.mode", cellId: "cell-b", mode: "description" });
  assert.equal(state.cells[1].mode, "description");
  assert.equal(state.cells[0].mode, "source");
  assert.strictEqual(transition(state, { type: "cell.activate", cellId: "missing" }), state);

  state = transition(state, { type: "cell.activate", cellId: "cell-b" });
  assert.equal(state.activeCellId, "cell-b");
  assert.equal(state.revision, 0);
});

test("a Current document edit advances the revision and stales proposals and preview", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "preview.start", requestId: "preview-1" });
  state = transition(state, { type: "preview.resolve", requestId: "preview-1", artifact: { url: "blob:1", bytes: 1 } });
  state = transition(state, { type: "description.edit", cellId: "cell-a", description: "Rewrite" });
  state = transition(state, { type: "generation.start", cellId: "cell-a", requestId: "request-1" });
  state = transition(state, { type: "generation.resolve", requestId: "request-1", outcome: { kind: "source", source: "# Proposed", valid: true, diagnostics: [] } });
  assert.equal(state.proposal?.status, "valid");

  state = transition(state, { type: "document.edit", patch: { title: "Bench note" } });
  assert.equal(state.document.title, "Bench note");
  assert.equal(state.revision, 1);
  assert.equal(state.proposal?.status, "stale");
  assert.equal(state.preview.status, "stale");
  assert.strictEqual(transition(state, { type: "document.edit", patch: { title: "Bench note" } }), state);
});

test("replacing the Current document is atomic and refuses to change Cell boundaries", () => {
  let state = createWorkspaceState([sourceCell("cell-a"), sourceCell("cell-b", "::chart\n::")]);
  const document = { version: "2", title: "Formatted", authors: ["A"], date: "", metadata: "" };
  const wrong = transition(state, { type: "document.replace", document, sources: ["# One"] });
  assert.strictEqual(wrong, state);

  state = transition(state, { type: "document.replace", document, sources: ["# One", "::chart\nformatted\n::"] });
  assert.equal(state.revision, 1);
  assert.equal(state.document.title, "Formatted");
  assert.deepEqual(state.cells.map(({ source }) => source), ["# One", "::chart\nformatted\n::"]);
  assert.deepEqual(state.cells.map(({ lastAppliedSource }) => lastAppliedSource), ["# One", "::chart\nformatted\n::"]);
});

test("analysis and diagnostics results are rejected when stale and owned by request", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "analysis.start", requestId: "analysis-1" });
  state = transition(state, { type: "source.edit", cellId: "cell-a", source: "# Changed" });
  const stale = transition(state, { type: "analysis.resolve", requestId: "analysis-1", diagnostics: [{ severity: "error", message: "old" }] });
  assert.deepEqual(stale.diagnostics, []);
  assert.equal(stale.operations.analyze, null);

  state = transition(stale, { type: "analysis.start", requestId: "analysis-2" });
  state = transition(state, { type: "analysis.resolve", requestId: "analysis-2", diagnostics: [{ severity: "warning", message: "current" }] });
  assert.deepEqual(state.diagnostics, [{ severity: "warning", message: "current" }]);
  assert.equal(state.diagnosticsRevision, state.revision);
});

test("format proposals are revision-bound and cannot survive a Source edit", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "format.start", requestId: "format-1" });
  state = transition(state, { type: "format.resolve", requestId: "format-1", source: "# Formatted" });
  assert.equal(state.formatProposal?.status, "open");

  state = transition(state, { type: "source.edit", cellId: "cell-a", source: "# Manual" });
  assert.equal(state.formatProposal?.status, "stale");
  state = transition(state, { type: "format.discard" });
  assert.equal(state.formatProposal, null);

  let staleResolve = createWorkspaceState([sourceCell()]);
  staleResolve = transition(staleResolve, { type: "format.start", requestId: "format-2" });
  staleResolve = transition(staleResolve, { type: "source.edit", cellId: "cell-a", source: "# Edited" });
  const ignored = transition(staleResolve, { type: "format.resolve", requestId: "format-2", source: "# Formatted" });
  assert.equal(ignored.formatProposal, null);
});

test("export progress ignores results from a superseded request", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "export.start", requestId: "export-1", format: "pdf" });
  assert.equal(state.operations.export?.format, "pdf");
  const foreign = transition(state, { type: "export.resolve", requestId: "export-2" });
  assert.strictEqual(foreign, state);
  state = transition(state, { type: "export.resolve", requestId: "export-1" });
  assert.equal(state.operations.export, null);
});

test("structural controls lock during generation and deletion drops an ownerless response", () => {
  let state = createWorkspaceState([sourceCell("cell-a"), sourceCell("cell-b", "::chart\n::")]);
  state = transition(state, { type: "description.edit", cellId: "cell-b", description: "Improve chart" });
  state = transition(state, { type: "generation.start", cellId: "cell-b", requestId: "request-1" });
  assert.strictEqual(transition(state, { type: "cell.delete", cellId: "cell-a" }), state);
  assert.equal(state.mutationLocked, true);

  state = transition(state, { type: "generation.resolve", requestId: "request-1", outcome: { kind: "clarification", message: "Which chart?" } });
  state = transition(state, { type: "cell.delete", cellId: "cell-b" });
  assert.equal(state.generationResponse, null);
  assert.deepEqual(state.cells.map(({ id }) => id), ["cell-a"]);
});

test("preview resize keeps height as session layout state only", () => {
  let state = createWorkspaceState([sourceCell()]);
  state = transition(state, { type: "preview.resize", height: 412.6 });
  assert.equal(state.preview.height, 413);
  assert.equal(state.preview.artifact, null);
  const same = transition(state, { type: "preview.resize", height: 413 });
  assert.strictEqual(same, state);
});

test("deleting and undoing restores complete Cell state and stable identity", () => {
  let state = createWorkspaceState([
    sourceCell("cell-a"),
    { ...sourceCell("cell-b", "::chart\n::"), pendingDescription: "Improve chart" },
  ]);
  state = transition(state, { type: "cell.delete", cellId: "cell-b" });
  assert.deepEqual(state.cells.map(({ id }) => id), ["cell-a"]);
  state = transition(state, { type: "cell.undoDelete" });
  assert.deepEqual(state.cells.map(({ id }) => id), ["cell-a", "cell-b"]);
  assert.equal(state.cells[1].pendingDescription, "Improve chart");
});
