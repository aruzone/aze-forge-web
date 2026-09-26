/** Authoring draft request and outcome contract. */

import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceDraft, validateDraftRequest, validateProviderOutcome, validateSourceDraft } from "../../src/service/authoring.mjs";

test("accepts only the versioned Description draft request", () => {
  assert.deepEqual(
    validateDraftRequest({
      protocolVersion: 1,
      requestId: "draft-42",
      description: "Draw a triangle with labelled sides.",
    }),
    {
      protocolVersion: 1,
      requestId: "draft-42",
      description: "Draw a triangle with labelled sides.",
    },
  );
});

test("rejects client-supplied source, capabilities, and unknown fields", () => {
  for (const field of ["source", "capabilities", "model", "profile", "prompt"]) {
    assert.throws(
      () =>
        validateDraftRequest({
          protocolVersion: 1,
          requestId: "draft-42",
          description: "An equation",
          [field]: "client controlled",
        }),
      (error) => error.code === "option-unsupported" && error.data.field === field,
    );
  }
});

test("enforces the 32 KiB UTF-8 Description bound", () => {
  assert.throws(
    () =>
      validateDraftRequest({
        protocolVersion: 1,
        requestId: "draft-42",
        description: "é".repeat(16_385),
      }),
    (error) => error.code === "payload-too-large" && error.data.scope === "authoring-description-bytes",
  );
});

test("accepts only complete tagged provider outcomes", () => {
  assert.deepEqual(
    validateProviderOutcome({ kind: "source", title: "Draft", blockType: "equation", text: "# Draft", question: null, reason: null, code: null }),
    { kind: "source", title: "Draft", blockType: "equation", text: "# Draft" },
  );
  assert.throws(
    () => validateProviderOutcome({ kind: "source", title: null, blockType: null, text: null, question: null, reason: null, code: null }),
    /invalid structured outcome/,
  );
});

test("requires a complete typed AzeMark Source document, never bare notation", () => {
  const source = "---\nazemark: 2\ntitle: Quadratic formula\nauthor:\n  - AzeForge Web\n---\n\n:::: equation\nid: quadratic-formula\n----\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n::::\n";
  assert.equal(validateSourceDraft(source), source);
  assert.throws(() => validateSourceDraft("x = \\frac{-b}{2a}"), /complete typed AzeMark Source/);
});

test("assembles a complete typed AzeMark Source from a model draft body", () => {
  assert.equal(
    buildSourceDraft({ kind: "source", title: "Quadratic formula", blockType: "equation", text: "x = 1" }),
    "---\nazemark: 2\ntitle: Quadratic formula\nauthor:\n  - AzeForge Web\n---\n\n:::: equation\nid: generated-draft\n----\nx = 1\n::::\n",
  );
});

test("refuses an empty model body instead of creating an invalid typed Block", () => {
  assert.throws(
    () => buildSourceDraft({ kind: "source", title: "Empty", blockType: "equation", text: " \n" }),
    /invalid source draft body/,
  );
});
