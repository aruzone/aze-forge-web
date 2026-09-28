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
 * unused one with `""` rather than `null`. Both mean absent here; only a real
 * value belonging to another tag is a contract violation.
 * @param {unknown} value
 */
function absent(value) {
  return value === null || value === "";
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
 * the server records only `error.name`.
 * @param {string} message
 */
function authoringOutcomeError(message) {
  return Object.assign(new Error(message), { name: "AuthoringOutcomeError" });
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
    throw authoringOutcomeError("Authoring provider did not return JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw authoringOutcomeError("Authoring provider did not return a structured outcome.");
  }
  try {
    return validateProviderOutcome(/** @type {Record<string, unknown>} */ (parsed).outcome);
  } catch {
    throw authoringOutcomeError("Authoring provider returned an unusable outcome.");
  }
}

/** @param {{ apiKey: string, model: string, catalogue: readonly string[] }} config */
export function createOpenAIAuthoringProvider(config) {
  const client = new OpenAI({ apiKey: config.apiKey, timeout: 30_000, maxRetries: 0 });
  const instruction = [
    "Return only a typed AzeMark Block body, never a full document, prose explanation, Markdown, TeX delimiters, or code fences.",
    `Supported families: ${config.catalogue.join(", ")}. blockType must be exactly one of equation, derivation, plot, chart, geometry, formula, reaction, or structure.`,
    "The families split as mathematics (equation, derivation, plot, chart), geometry (geometry), and chemistry (formula, reaction, structure). A mathematical formula, identity, theorem, or equation is always equation, or derivation when it shows steps; formula, reaction, and structure are chemistry only and are wrong for any mathematics request.",
    "For source outcomes, title is a short document title, blockType is the exact native Block type, and text is only the content after `----`.",
    "Use AzeMark's readable mathematics grammar, never LaTeX: an equation body is `x = frac(-b + sqrt(b^2 - 4 a c), 2 a)`; a derivation body uses `- expression: x = 1` lines. Use symbolic operators `+`, `-`, `*`, `/`, `=`, `^`, and `sqrt`, never English operator words such as `minus`, `plus`, `times`, `divided by`, or `equals`.",
    "A formula body is exactly one chemical expression such as `H2O` or `Fe(CN)6·2H2O4-`, never a sentence. A reaction body is one species line such as `Ag+(aq) + Cl-(aq) -> AgCl(s)`.",
    "A geometry body is a YAML list of constructions, such as `- kind: point\\n  name: a\\n  x: 0\\n  y: 0`. A structure body is a YAML list of atoms and bonds.",
    "A plot body is a YAML list whose entries have a `kind`, such as `- kind: function\\n  variable: x\\n  expression: x^2`; a chart body is a YAML list of labelled series.",
    "If the requested content cannot be expressed with one of those bodies, return clarification or refusal. Never substitute a formula Block for mathematics.",
  ].join(" ");
  return Object.freeze({
    /** @param {string} description */
    async generate(description) {
      const response = await client.responses.create({
        model: config.model,
        input: [{ role: "developer", content: instruction }, { role: "user", content: description }],
        max_output_tokens: 16_384,
        text: { format: RESPONSE_FORMAT },
      });
      if (response.status !== "completed" || typeof response.output_text !== "string") {
        throw authoringOutcomeError("Authoring provider did not return a completed structured response.");
      }
      return parseProviderOutcome(response.output_text);
    },
  });
}
