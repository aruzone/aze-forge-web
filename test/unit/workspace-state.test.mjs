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
