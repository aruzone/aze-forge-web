# Switch server authoring to the CommandCode Provider API

**Question:** how to switch server-side authoring from direct OpenAI to the provider the user calls "CommandCode."
**Decision status:** implemented in the authoring service; owner-key contract validation remains required before production cutover.
**Researched:** 2026-09-30. All external citations below are first-party Command Code documentation at `commandcode.ai`.

## Provider identity (unambiguous)

"CommandCode" resolves to **Command Code's Provider API** at `commandcode.ai` — a gateway exposing every catalog model over OpenAI- and Anthropic-compatible endpoints — not to Meta's first-party Muse/Model API and not to any unrelated "code combat"-style API.

- Product page: "Command Provider API … Call them from any OpenAI or Anthropic compatible client." [Provider][cmd-provider]
- Docs: "This page is about calling Command Code's models from your own code." and "Standard OpenAI and Anthropic endpoints. Use any agent, anywhere. No lock-in." [Provider API][cmd-docs]
- Disambiguation: Meta `muse-spark-*` models (e.g. `meta/muse-spark-1.3-contributor`) appear **inside** the Command Code catalog; they are model IDs you request through Command Code, not the provider itself. [Models][cmd-models]

## What the official docs establish (facts)

| Concern | Finding | Source |
| --- | --- | --- |
| **API base URL** | Point any OpenAI/Anthropic-compatible client at `https://api.commandcode.ai/provider/v1`. | [API support][cmd-docs] ("Point any OpenAI or Anthropic compatible client at `https://api.commandcode.ai/provider/v1`") |
| **Responses endpoint** | `POST https://api.commandcode.ai/provider/v1/responses`, format "OpenAI Responses". Sibling routes: `/chat/completions` (OpenAI Chat Completions), `/messages` (Anthropic Messages), `GET /models` (models list). | [Endpoints][cmd-docs], [Supported formats][cmd-provider] |
| **Responses schema posture** | "Request and response bodies follow the [OpenAI Responses schema]". Tool arrays pass through; `function`/`custom` execute client-side; built-in declarations (e.g. `web_search`) are forwarded for upstream accept/refuse. Two exceptions: remote `type: "mcp"` tools are rejected, and `x-cmd-zdr: 1` requests accept only client-executed tools (`function`, `custom`, `local_shell`). | [Quickstart — OpenAI Responses][cmd-docs] |
| **Authentication** | `Authorization: Bearer <CMD_API_KEY>` on any route (Anthropic SDK on `/messages` may use `x-api-key`). Same key authenticates CLI and API; created in Studio. | [Quickstart examples][cmd-docs], [Errors table][cmd-docs], [Get an API key][cmd-provider] |
| **Model naming** | Fully-qualified catalog IDs, e.g. `deepseek/deepseek-v4-flash`, `meta/muse-spark-1.3-contributor`, `gpt-5.5`, `claude-sonnet-5-5`. CLI matching is case-insensitive and accepts the short name after `/`; unknown IDs are rejected up front. Live list at `GET /provider/v1/models`. | [Models][cmd-models], [List models][cmd-docs] |
| **Endpoint-per-model routing** | "OpenAI and open models answer on `/chat/completions`, and **most** of them on `/responses` as well. Claude models answer on `/messages` **only**." Each entry in `/models` carries `supported_endpoints`; "check there before you pick an endpoint." Wrong-endpoint sends fail `400` (`invalid_request_error`). Unknown model fails `400` (`unsupported_model`, OpenAI envelope). | [Supported endpoints][cmd-docs], [Errors][cmd-docs], [FAQ][cmd-provider] |
| **Message parts** | Text and images only; audio/file/document parts are schema-rejected. (This repo sends text only, so in-scope.) | [FAQ][cmd-docs] |
| **Error envelope** | OpenAI clients see the standard `{ error: { message, type, code, param } }` envelope with `authentication_error`, `rate_limit_error` (`429`), `server_error` (`5xx`, upstream message passthrough), `upgrade_required` (`403`, Go plan has no API access), `cmd_zdr_no_providers` (`422`). | [Errors][cmd-docs] |
| **Plans/keys** | Every plan **except Go** has API access (GOAT/Pro/Max/Team meter against plan credits; Provider plan is pay-as-you-go, $15/mo + card fee, no markup, credits never expire). Keys via Studio billing/keys pages. | [Pricing][cmd-docs], [API support][cmd-docs], [Provider plan][cmd-provider] |
| **Retention/ZDR** | Command Code never trains on or sells caller data and enables upstream ZDR/no-training flags where offered; `x-cmd-zdr: 1` enforces ZDR-capable routing or fails `422` instead of falling back. Caveats: a few models lack ZDR upstreams; free/promotional/stealth models may run under different provider terms (e.g. stealth `space-bunny-alpha` is served with no ZDR and may retain prompts); open-source models served from US/EU/Singapore infra. | [ZDR][cmd-docs], [Data answers][cmd-provider], [Pricing & Limits][cmd-limits] |

## How this maps to the current integration (facts, repo-observed)

- `src/service/authoring.mjs` `createAuthoringProvider({ apiKey, baseUrl, model, catalogue, timeoutMs })` constructs `new OpenAI({ apiKey, baseURL: baseUrl, timeout, maxRetries: 0 })` and calls the same Responses request with strict JSON Schema, then requires `response.status === "completed"` and string `response.output_text` before `parseProviderOutcome`.
- `RESPONSE_FORMAT` is `{ type: "json_schema", name: "azemark_authoring_draft", strict: true, schema: { … outcome: { kind enum [source, clarification, refusal], text/title/blockType/question/reason/code, additionalProperties: false } } }` (`src/service/authoring.mjs`).
- Deployment config is `AZEWEB_AUTHORING_API_KEY` (secret), `AZEWEB_AUTHORING_BASE_URL` (default `https://api.commandcode.ai/provider/v1`) and `AZEWEB_AUTHORING_MODEL` (default `deepseek/deepseek-v4-flash`) in `src/service/limits.mjs`, wired in `src/service/main.mjs`; SDK is `openai@^6.22.0` (`package.json`).

## What the docs do NOT establish (uncertainty — do not assume)

1. **Strict JSON-Schema enforcement per model is unverified.** The docs promise the Responses *shape* follows OpenAI's schema, but say nothing explicit about `text.format: { type: "json_schema", strict: true }` support, schema-adherence guarantees, refusal shape, `output_text`/`status` field parity, or `max_output_tokens` acceptance on any specific model. Structured-output behavior is therefore a per-model empirical question.
2. **Which models serve `/responses`.** Only "most" OpenAI/open models do; the authoritative answer is the live `supported_endpoints` field per model. The configured default `deepseek/deepseek-v4-flash` is currently advertised with `/responses`; do not assume future catalog entries resolve.
3. **Semantic stability.** As with the prior provider note, no source guarantees model output correctness for AzeMark/math/geometry/chemistry/TeX; the compiler boundary and contract corpus remain mandatory.
4. **Retention/region eligibility** is conditional on the owner account, plan, model, and upstream; verify in the owner account before deployment.

## Recommendation / blocker

**Implementation status:** the code/config changes are in place. Deployment still requires a Command Code API key, a model available to the account, and empirical contract validation.

1. The integration adds a deployment-owned base-URL setting (`AZEWEB_AUTHORING_BASE_URL`, defaulting to `https://api.commandcode.ai/provider/v1`) and passes it to `new OpenAI({ baseURL, … })`.
2. Keep the official `openai` SDK and the Responses call shape; point it at `/provider/v1` with a Command Code API key (server env/secret manager only; never to the browser) and a fully-qualified catalog model ID.
3. Pick the model from the **live** `GET /provider/v1/models` list and require `supported_endpoints` to include `/responses`. Prefer an OpenAI or open model on `/responses`; do **not** pick a Claude model (would require a `/messages` adapter rewrite) or a free/stealth preview model (weaker retention terms, may disappear).
4. **Blocker before production cutover:** empirically confirm with the owner key that the chosen model accepts the exact `text.format` strict schema, returns `status: "completed"` with string `output_text`, and honors `max_output_tokens`; retain the AzeMark contract corpus and keep `parseProviderOutcome` rejection behavior unchanged. Docs alone do not prove this.
5. Map the new failure modes to the existing generic 503 surface without leaking provider internals: `unsupported_model`/`invalid_request_error` (wrong model/endpoint — deployment misconfiguration), `upgrade_required` (wrong plan), `cmd_zdr_no_providers` (only if the `x-cmd-zdr: 1` opt-in is adopted), `429` (honor backoff). Decide explicitly whether to send `x-cmd-zdr: 1`; it can change upstream routing/cost and hard-fails models without ZDR coverage.
6. Do not invent credentials, model availability, or rate numbers; verify plan, key, model access, and retention posture in the owner account first.

## Sources

- [Command Code Provider API docs][cmd-docs]
- [Command Code Provider landing][cmd-provider]
- [Available models][cmd-models]
- [Pricing & Limits][cmd-limits]

[cmd-docs]: https://commandcode.ai/docs/provider
[cmd-provider]: https://commandcode.ai/provider
[cmd-models]: https://commandcode.ai/docs/reference/cli/models
[cmd-limits]: https://commandcode.ai/docs/resources/pricing-limits
