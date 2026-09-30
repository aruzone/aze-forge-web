/** Server-owned Description-to-AzeMark Source draft boundary. */

import OpenAI from "openai";
import { ERROR_CODES, ServiceError } from "./errors.mjs";
import { PROTOCOL_VERSION } from "./protocol.mjs";

export const MAX_DESCRIPTION_BYTES = 32 * 1024;
export const MAX_DRAFT_SOURCE_BYTES = 128 * 1024;
const MAX_IDENTIFIER_LENGTH = 200;
const BLOCK_TYPES = Object.freeze(["equation", "derivation", "plot", "chart", "geometry", "formula", "reaction", "structure"]);

const RESPONSE_FORMAT = Object.freeze({
  type: "json_schema",
  name: "azemark_authoring_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcome"],
    properties: {
      outcome: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "title", "blockType", "question", "reason", "code"],
        properties: {
          kind: { type: "string", enum: ["source", "clarification", "refusal"] },
          text: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          blockType: { type: ["string", "null"], enum: [...BLOCK_TYPES, null] },
          question: { type: ["string", "null"] },
          reason: { type: ["string", "null"] },
          code: { type: ["string", "null"] },
        },
      },
    },
  },
});

/** @param {unknown} body */
export function validateDraftRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ServiceError(ERROR_CODES.requestMalformed, "The request body must be a JSON object.", {});
  }
  const request = /** @type {Record<string, unknown>} */ (body);
  const allowed = new Set(["protocolVersion", "requestId", "description"]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) {
      throw new ServiceError(ERROR_CODES.optionUnsupported, `${key} is not accepted for authoring drafts.`, {
        data: { field: key },
      });
    }
  }
  if (request.protocolVersion !== PROTOCOL_VERSION) {
    throw new ServiceError(ERROR_CODES.protocolVersionUnsupported, `This service speaks protocol version ${PROTOCOL_VERSION}.`, {
      data: { protocolVersion: PROTOCOL_VERSION },
    });
  }
  if (typeof request.requestId !== "string" || request.requestId.length === 0 || request.requestId.length > MAX_IDENTIFIER_LENGTH) {
    throw new ServiceError(ERROR_CODES.requestMalformed, "requestId must be a bounded non-empty string.", {
      data: { field: "requestId", limit: MAX_IDENTIFIER_LENGTH },
    });
  }
  if (typeof request.description !== "string") {
    throw new ServiceError(ERROR_CODES.requestMalformed, "description must be a string.", { data: { field: "description" } });
  }
  const byteLength = Buffer.byteLength(request.description, "utf8");
  if (byteLength > MAX_DESCRIPTION_BYTES) {
    throw new ServiceError(ERROR_CODES.payloadTooLarge, "Description exceeds this deployment's authoring limit.", {
      data: { byteLength, limit: MAX_DESCRIPTION_BYTES, unit: "bytes", scope: "authoring-description-bytes" },
    });
  }
  return Object.freeze({ protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, description: request.description });
}

/**
 * The structured-output schema requires every field, so a model may satisfy an
 * unused one with `""` rather than `null`; a gateway that strips nulls may
 * omit one instead. All three mean absent here; only a real value belonging
 * to another tag is a contract violation.
 * @param {unknown} value
 */
function absent(value) {
  return value === null || value === undefined || value === "";
}

/**
 * A tag's own field has to carry the content that makes the tag meaningful: an
 * empty question or reason would reach the author as an empty panel, so it is a
 * contract failure like any other.
 * @param {unknown} value
 * @returns {value is string}
 */
function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value */
export function validateProviderOutcome(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid structured outcome");
  const outcome = /** @type {Record<string, unknown>} */ (value);
  // Unknown keys are rejected even when harmless: a gateway injecting extras
  // must not silently widen the contract the Draft Gate relies on.
  const allowed = new Set(["kind", "text", "title", "blockType", "question", "reason", "code"]);
  for (const key of Object.keys(outcome)) {
    if (!allowed.has(key)) throw new Error("invalid structured outcome");
  }
  if (outcome.kind === "source" && typeof outcome.text === "string" && typeof outcome.title === "string" && typeof outcome.blockType === "string" && BLOCK_TYPES.includes(outcome.blockType) && absent(outcome.question) && absent(outcome.reason) && absent(outcome.code)) {
    return Object.freeze({ kind: "source", text: outcome.text, title: outcome.title, blockType: outcome.blockType });
  }
  if (outcome.kind === "clarification" && absent(outcome.text) && absent(outcome.title) && absent(outcome.blockType) && present(outcome.question) && outcome.question.length <= 1_000 && absent(outcome.reason) && absent(outcome.code)) {
    return Object.freeze({ kind: "clarification", question: outcome.question });
  }
  if (outcome.kind === "refusal" && absent(outcome.text) && absent(outcome.title) && absent(outcome.blockType) && absent(outcome.question) && present(outcome.reason) && outcome.reason.length <= 1_000 && typeof outcome.code === "string" && outcome.code.length <= 100) {
    return Object.freeze({ kind: "refusal", reason: outcome.reason, code: outcome.code });
  }
  throw new Error("invalid structured outcome");
}

/** @param {{ kind: "source", title: string, blockType: string, text: string }} outcome */
export function buildSourceDraft(outcome) {
  const title = outcome.title.replace(/[\r\n]/g, " ").trim();
  const body = outcome.text.trim();
  if (title.length === 0 || title.length > 200 || !BLOCK_TYPES.includes(outcome.blockType)) {
    throw new Error("invalid source draft metadata");
  }
  if (body.length === 0) throw new Error("invalid source draft body");
  return `---\nazemark: 2\ntitle: ${title}\nauthor:\n  - AzeForge Web\n---\n\n:::: ${outcome.blockType}\nid: generated-draft\n----\n${body}\n::::\n`;
}

/** @param {string} source */
export function validateSourceDraft(source) {
  const frontMatter = /^---\nazemark: 2\ntitle: .+\nauthor:\n(?:  - .+\n)+---\n\n/;
  const nativeBlock = /^:::: (?:equation|derivation|plot|chart|geometry|formula|reaction|structure)\n(?:[^\n]+\n)*----\n[\s\S]+?\n::::\s*$/m;
  if (!frontMatter.test(source) || !nativeBlock.test(source)) throw new Error("complete typed AzeMark Source required");
  return source;
}
/**
 * The model answered, but not with something this boundary accepts. It is named
 * so a deployment log can tell a model-contract failure from a transport one:
 * the server records only `error.name` plus the safe shape below.
 * @param {string} message
 * @param {Record<string, unknown>} [shape] key presence and value types only, never values
 */
function authoringOutcomeError(message, shape) {
  return Object.assign(new Error(message), { name: "AuthoringOutcomeError", shape: shape ?? {} });
}

/**
 * Safe one-line summary of the rejected outcome for the deployment log: which
 * keys exist and their value types, never the values themselves (values may
 * carry Description-derived text the metadata-only log must not record).
 * @param {unknown} outcome
 * @returns {Record<string, unknown>}
 */
export function shapeOfOutcome(outcome) {
  if (outcome === null || typeof outcome !== "object" || Array.isArray(outcome)) {
    return { type: Array.isArray(outcome) ? "array" : outcome === null ? "null" : typeof outcome };
  }
  /** @type {Record<string, unknown>} */
  const shape = {};
  for (const [key, value] of Object.entries(outcome)) {
    shape[key] = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  }
  return shape;
}

/**
 * Parse the model's structured response into a tagged outcome.
 * @param {string} outputText
 */
export function parseProviderOutcome(outputText) {
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw authoringOutcomeError("Authoring provider did not return JSON.", { json: "unparsable" });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw authoringOutcomeError("Authoring provider did not return a structured outcome.", shapeOfOutcome(parsed));
  }
  const outcome = /** @type {Record<string, unknown>} */ (parsed).outcome;
  try {
    return validateProviderOutcome(outcome);
  } catch {
    throw authoringOutcomeError("Authoring provider returned an unusable outcome.", shapeOfOutcome(outcome));
  }
}

/**
 * The developer instruction sent to the drafting model. Exported so tests can
 * pin the per-family body syntax it promises: the model copies whatever shape
 * is shown, so each family needs its exact record spelling here.
 * @param {readonly string[]} catalogue
 */
export function authoringInstruction(catalogue) {
  return [
    "Return only a typed AzeMark Block body, never a full document, prose explanation, Markdown, TeX delimiters, or code fences.",
    `Supported families: ${catalogue.join(", ")}. blockType must be exactly one of equation, derivation, plot, chart, geometry, formula, reaction, or structure.`,
    "The families split as mathematics (equation, derivation, plot, chart), geometry (geometry), and chemistry (formula, reaction, structure). A mathematical formula, identity, theorem, or equation is always equation, or derivation when it shows steps; formula, reaction, and structure are chemistry only and are wrong for any mathematics request.",
    "For source outcomes, title is a short document title, blockType is the exact native Block type, and text is only the content after `----`. A source outcome must set kind to source with non-empty text, title, and blockType, and null question, reason, and code; a clarification outcome must set only a non-empty question; a refusal outcome must set only a non-empty reason and code. Example source outcome: {\"kind\": \"source\", \"text\": \"F = m a\", \"title\": \"Newton's second law\", \"blockType\": \"equation\", \"question\": null, \"reason\": null, \"code\": null}.",
    "Use AzeMark's readable mathematics grammar, never LaTeX: an equation body is `x = frac(-b +- sqrt(b^2 - 4 a c), 2 a)`; a derivation body uses `- expression: x = 1` lines. Use symbolic operators `+`, `-`, `*`, `/`, `=`, `^`, and `sqrt`, never English operator words such as `minus`, `plus`, `times`, `divided by`, or `equals`.",
    "Mathematics is a closed vocabulary: juxtaposition or `*` for products, `^` and `_` for powers and subscripts (`r^2`, `q_1`), `frac(a, b)` with a comma between arguments, `sqrt(x)`, `abs(x)`, `exp`, `ln`, Greek names such as `sigma` and `psi`, and `sum`, `integral`, and `limit` binders written as `sum n=1..infinity of expr`, `integral x=0..L of expr dx`, and `limit n->infinity of expr`, plus `cases(value when condition; value otherwise)`. Function application takes a single parenthesized argument with no comma: `f(x)`, `cos(n pi x / L)`, `V(x)`, or juxtaposed `V(r t)` for a potential of two variables, never `V(r, t)` with a comma, which is unbalanced grouping; only `frac(a, b)` and `root(n, x)` take comma-separated arguments. Multiple indices on one base share one parenthesized subscript: `R_(mu, nu)`, `g_(mu, nu)`, never chained `R_mu_nu`. Never emit `|`, `{`, `}`, a backslash, TeX commands such as `\\frac`, `\\sqrt`, or `\\pm`, or TeX-style binder bounds such as `sum(n=1 to infinity)`: absolute value is `abs(x)`, never `|x|`; plus-minus is `+-`. A Fourier series in that grammar is `f(x) = frac(a_0, 2) + sum n=1..infinity of (a_n cos(n pi x / L) + b_n sin(n pi x / L))`.",
    "When the Description names a standard law, theorem, or equation, emit its standard symbolic form in that grammar and nothing else: Coulomb's law is `F = k q_1 q_2 / r^2`, Newton's second law is `F = m a`, the Pythagorean theorem is `a^2 + b^2 = c^2`, kinetic energy is `E_k = frac(1, 2) m v^2`, Ohm's law is `V = I R`, the ideal gas law is `P V = n R T`, the wave equation is `partial^2 u / partial t^2 = c^2 partial^2 u / partial x^2`, radioactive decay is `N(t) = N_0 exp(-lambda t)`, the quadratic formula is `x = frac(-b +- sqrt(b^2 - 4 a c), 2 a)`, the normal density is `f(x) = frac(1, sigma sqrt(2 pi)) exp(frac(-(x - mu)^2, 2 sigma^2))`, the time-independent Schrodinger equation is `H psi = E psi`, the time-dependent Schrodinger equation is `i hbar partial psi / partial t = -frac(hbar^2, 2 m) nabla^2 psi + V(r t) psi`, and Einstein's field equation with the cosmological constant is `R_(mu, nu) - frac(1, 2) R g_(mu, nu) + Lambda g_(mu, nu) = frac(8 pi G, c^4) T_(mu, nu)`.",
    "Before answering, check that a mathematics body contains none of `|`, `{`, `}`, or backslash, that function parentheses hold a single argument with no comma, that multi-index subscripts use one `_(...)` group, and that an equation body is a single expression.",
    "A formula body is exactly one chemical expression such as `H2O` or `Fe(CN)6·2H2O4-`, never a sentence. A reaction body is one species line such as `2 Mg(s) + O2(g) -> 2 MgO(s)`; attached coefficients such as `2Mg(s)` are accepted as identical to spaced ones.",
    "A geometry body is a YAML list of constructions, each with a `kind:` key, such as `- kind: point\\n  name: a\\n  x: 0\\n  y: 0`. A structure body never uses a `kind:` key: its records are `- atom:`, `- bond:`, and `- label:`, such as `- atom: c1\\n  element: C\\n  at: [0, 0]\\n- bond:\\n  from: c1\\n  to: c2\\n  order: 1`. Every atom carries authored coordinates and exactly one of `element:` or `attach:`; every bond names its endpoints with `from:` and `to:`.",
    "A plot body is a YAML list whose entries have a `kind`, such as `- kind: function\\n  variable: x\\n  expression: x^2`; a chart body is a YAML list of labelled series.",
    "If the requested content cannot be expressed with one of those bodies, return clarification or refusal. Never substitute a formula Block for mathematics.",
  ].join(" ");
}

/** @param {{ apiKey: string, model: string, catalogue: readonly string[], timeoutMs?: number }} config */
export function createOpenAIAuthoringProvider(config) {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const client = new OpenAI({ apiKey: config.apiKey, timeout: timeoutMs, maxRetries: 0 });
  const instruction = authoringInstruction(config.catalogue);
  return Object.freeze({
    /** @param {string} description @param {{ signal?: AbortSignal }} [options] */
    async generate(description, options = {}) {
      const response = await client.responses.create({
        model: config.model,
        input: [{ role: "developer", content: instruction }, { role: "user", content: description }],
        max_output_tokens: 16_384,
        text: { format: RESPONSE_FORMAT },
      }, options.signal === undefined ? undefined : { signal: options.signal });
      if (response.status !== "completed" || typeof response.output_text !== "string") {
        throw authoringOutcomeError("Authoring provider did not return a completed structured response.");
      }
      return parseProviderOutcome(response.output_text);
    },
  });
}
