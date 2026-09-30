/** Authoring draft request and outcome contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { authoringInstruction, buildSourceDraft, parseProviderOutcome, shapeOfOutcome, validateDraftRequest, validateProviderOutcome, validateSourceDraft } from "../../src/service/authoring.mjs";

test("the drafting instruction teaches comma-argument groups and bracketed operators", () => {
  const instruction = authoringInstruction(["mathematics", "geometry", "chemistry"]);
  assert.match(instruction, /Psi\(r, t\)/);
  assert.match(instruction, /square delimiters/);
  assert.match(instruction, /lists its arguments in evaluation order/);
  assert.doesNotMatch(instruction, /never `V\(r, t\)`/);
  assert.doesNotMatch(instruction, /unbalanced grouping/);
  assert.doesNotMatch(instruction, /juxtaposed `V\(r t\)`/);
});

test("the drafting instruction teaches the full binder, vector, and prime catalog", () => {
  const instruction = authoringInstruction(["mathematics", "geometry", "chemistry"]);
  assert.match(instruction, /product k=1\.\.m of k/);
  assert.match(instruction, /forall e in R of/);
  assert.match(instruction, /pmatrix/);
  assert.match(instruction, /\(x'\)\^2/);
});

test("the drafting instruction pins the bracketed Hamiltonian in valid grammar", async () => {
  const { createCompiler } = await import("@aruzone/aze-forge");
  const instruction = authoringInstruction(["mathematics", "geometry", "chemistry"]);
  const bodies = [...instruction.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const expected = "i hbar frac(partial, partial t) Psi(r, t) = [-frac(hbar^2, 2 m) nabla^2 + V(r, t)] Psi(r, t)";
  assert.ok(bodies.includes(expected), "instruction must pin the bracketed Hamiltonian");
  const compiler = createCompiler();
  const source = buildSourceDraft({ kind: "source", title: "Physics", blockType: "equation", text: expected });
  assert.deepEqual(compiler.validate(compiler.parse(source, {})).diagnostics, []);
});

test("the drafting instruction teaches reaction arrows, unspecified coefficients, and geometry constructions", () => {
  const instruction = authoringInstruction(["mathematics", "geometry", "chemistry"]);
  assert.match(instruction, /<->/);
  assert.match(instruction, /explicitly unspecified/);
  assert.match(instruction, /perpendicular-line/);
  assert.match(instruction, /equal-marks/);
});

test("the drafting instruction pins the two failing physics equations in valid grammar", async () => {
  const { createCompiler } = await import("@aruzone/aze-forge");
  const instruction = authoringInstruction(["mathematics", "geometry", "chemistry"]);
  const bodies = [...instruction.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const compiler = createCompiler();
  for (const expected of [
    "i hbar partial psi / partial t = -frac(hbar^2, 2 m) nabla^2 psi + V(r, t) psi",
    "R_(mu, nu) - frac(1, 2) R g_(mu, nu) + Lambda g_(mu, nu) = frac(8 pi G, c^4) T_(mu, nu)",
  ]) {
    assert.ok(bodies.includes(expected), `instruction must pin ${expected}`);
    const source = buildSourceDraft({ kind: "source", title: "Physics", blockType: "equation", text: expected });
    const parsed = compiler.parse(source, {});
    assert.deepEqual(compiler.validate(parsed).diagnostics, []);
  }
});
test("a five-colon fence is never a valid draft, even with a four-colon body", () => {
  const draft = buildSourceDraft({ kind: "source", title: "Physics", blockType: "equation", text: "x = 1" });
  assert.equal(validateSourceDraft(draft), draft);
  assert.throws(() => validateSourceDraft(draft.replaceAll("::::", ":::::")), /complete typed AzeMark Source/);
  assert.throws(
    () => validateSourceDraft("---\nazemark: 2\ntitle: T\nauthor:\n  - AzeForge Web\n---\n\n::::: equation\nid: generated-draft\n----\nx = 1\n:::::\n"),
    /complete typed AzeMark Source/,
  );
});

test("the drafting instruction pins the structure record spelling, not the geometry kind key", () => {
  const instruction = authoringInstruction(["mathematics", "geometry", "chemistry"]);
  assert.match(instruction, /A structure body never uses a `kind:` key/);
  assert.match(instruction, /- atom:/);
  assert.match(instruction, /- bond:/);
  assert.match(instruction, /- label:/);
  assert.doesNotMatch(instruction, /A structure body is a YAML list of atoms and bonds\./);
});

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

test("treats an empty string in an unused field as absent", () => {
  assert.deepEqual(
    validateProviderOutcome({ kind: "source", text: "F = m a", title: "Newton's second law", blockType: "equation", question: "", reason: "", code: "" }),
    { kind: "source", text: "F = m a", title: "Newton's second law", blockType: "equation" },
  );
  assert.deepEqual(
    validateProviderOutcome({ kind: "clarification", text: "", title: "", blockType: null, question: "Which form?", reason: null, code: "" }),
    { kind: "clarification", question: "Which form?" },
  );
  assert.deepEqual(
    validateProviderOutcome({ kind: "refusal", text: "", title: null, blockType: "", question: null, reason: "Out of scope.", code: "not-supported" }),
    { kind: "refusal", reason: "Out of scope.", code: "not-supported" },
  );
});

test("treats an omitted unused field as absent", () => {
  assert.deepEqual(
    validateProviderOutcome({ kind: "source", text: "F = m a", title: "Newton's second law", blockType: "equation" }),
    { kind: "source", text: "F = m a", title: "Newton's second law", blockType: "equation" },
  );
  assert.deepEqual(
    validateProviderOutcome({ kind: "clarification", question: "Which form?" }),
    { kind: "clarification", question: "Which form?" },
  );
});

test("rejects a clarification or refusal whose own field carries nothing", () => {
  assert.throws(
    () => validateProviderOutcome({ kind: "clarification", text: "", title: "", blockType: null, question: "", reason: "", code: "" }),
    /invalid structured outcome/,
  );
  assert.throws(
    () => validateProviderOutcome({ kind: "refusal", text: null, title: null, blockType: null, question: null, reason: "   ", code: "not-supported" }),
    /invalid structured outcome/,
  );
});

test("rejects an outcome that carries fields belonging to another tag", () => {
  assert.throws(
    () => validateProviderOutcome({ kind: "source", text: "F = m a", title: "T", blockType: "equation", question: "Which one?", reason: null, code: null }),
    /invalid structured outcome/,
  );
  assert.throws(
    () => validateProviderOutcome({ kind: "clarification", text: "# Draft", title: null, blockType: null, question: "Which?", reason: null, code: null }),
    /invalid structured outcome/,
  );
});

test("rejects an outcome carrying unknown keys", () => {
  assert.throws(
    () => validateProviderOutcome({ kind: "source", text: "F = m a", title: "T", blockType: "equation", extra: "value" }),
    /invalid structured outcome/,
  );
});

test("a contract failure carries key types, never values", () => {
  try {
    parseProviderOutcome(JSON.stringify({ outcome: { kind: "source", text: 42, title: "Secret title" } }));
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.name, "AuthoringOutcomeError");
    assert.deepEqual(error.shape, { kind: "string", text: "number", title: "string" });
    assert.ok(!JSON.stringify(error.shape).includes("Secret title"));
  }
  assert.deepEqual(shapeOfOutcome(null), { type: "null" });
});

test("names a model-contract failure so a log can tell it from a transport one", () => {
  assert.deepEqual(
    parseProviderOutcome(JSON.stringify({ outcome: { kind: "source", text: "F = m a", title: "Newton", blockType: "equation", question: "", reason: "", code: "" } })),
    { kind: "source", text: "F = m a", title: "Newton", blockType: "equation" },
  );
  for (const [label, payload] of [["json", "not json"], ["shape", "[]"], ["outcome", JSON.stringify({ outcome: { kind: "source", text: null, title: null, blockType: null, question: null, reason: null, code: null } })]]) {
    assert.throws(
      () => parseProviderOutcome(payload),
      (error) => error.name === "AuthoringOutcomeError",
      `${label} should be an AuthoringOutcomeError`,
    );
  }
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
