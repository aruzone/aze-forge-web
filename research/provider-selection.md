# Provider selection for owner-configured AzeMark authoring

**Question:** [issue #7](https://github.com/aruzone/aze-forge-web/issues/7)  
**Decision status:** prior recommendation; superseded for the current authoring deployment by the Command Code Provider API cutover documented in [`research/commandcode-provider.md`](commandcode-provider.md).
**Researched:** 2026-09-26. All external citations below are first-party provider documentation.

## Guardrails that are not provider choices

The model proposes **AzeMark Source**, not an artifact. The installed
`@aruzone/aze-forge` compiler remains the authority for parsing, diagnostics,
and rendering. A proposed Source must be separately analyzed/compiled by that
compiler before it is presented as valid; it must never be treated as a
model-produced SVG, HTML, PNG, PDF, or diagnostic. `tex` remains optional and
worker-only under the existing compiler boundary. The user explicitly decides
whether to replace their editor content with a proposed Source.

Provider credentials belong only in the owner-controlled Node deployment
(secret manager or process environment); the browser receives neither a key nor
a provider endpoint. Do not enable model tools, hosted code execution, files,
web search, or agent state for this feature. This keeps the outbound request
stateless and limits it to the prompt and generated text.

## Candidates and evidence

| Criterion | OpenAI API — recommended | Anthropic Claude API | Google Vertex AI / Gemini — viable only when its GCP boundary is required |
| --- | --- | --- | --- |
| **API and Node integration** | Official `openai` TypeScript/JavaScript SDK supports server-side Node, Deno, and Bun; the documented API exposes the Responses API. [SDKs][openai-sdk] | Official `@anthropic-ai/sdk` supports Node 20 LTS or later and warns that browser support is disabled by default to avoid exposing secret credentials. [TypeScript SDK][anthropic-sdk] | Official Google Gen AI SDK supports JavaScript and Vertex configuration, but requires a Google Cloud project/location and ADC/IAM setup. [Google Gen AI SDK][vertex-sdk] |
| **Structured output** | GA Structured Outputs uses JSON Schema and the JavaScript SDK provides Zod helpers. It states schema adherence, while refusals still need handling. [Structured Outputs][openai-structured] | GA JSON outputs (`output_config.format`) and strict tool use use constrained decoding for schema-compliant output. We need only JSON output, not tools. [Structured outputs][anthropic-structured] | Response schema plus `application/json` is documented to produce valid JSON; schema support is a subset and complex schemas can be rejected. [Structured output][vertex-structured] |
| **API stability posture** | The current structured-output guide directs new projects to the Responses API; exact model availability is model-dependent. Use a published dated snapshot when the selected model provides one, and retain a contract corpus before any model change. The documentation does **not** promise semantic stability of generated AzeMark. [Structured Outputs][openai-structured] | The Messages API has a required version header in the documented request shape. The structured-output migration explicitly deprecates the former `output_format`, so integration must use `output_config.format` and retain a provider adapter/contract corpus. [Structured outputs][anthropic-structured] | Vertex REST examples use a versioned `v1` endpoint, but the model/location matrix and schema subset add operational change surface. [Locations][vertex-locations], [Structured output][vertex-structured] |
| **Credentials, retention, and region** | API data is not used for training unless the customer opts in. Default abuse-monitoring logs can retain content for up to 30 days; ZDR/MAM require approval. Data residency is a project control, with regional processing only where the documented endpoint/model matrix supports it. [Data controls][openai-data] | ZDR is an organization arrangement; eligible Messages calls do not store prompts/responses after the API response. Structured-output schemas can be cached for up to 24 hours, and Anthropic may retain flagged data or data required by law. Direct API inference can be `global` or US-only; the current documented workspace geo is US. [Retention][anthropic-data], [Residency][anthropic-region] | Regional and US/EU multi-region endpoints give a distinct GCP deployment/control-plane option; Google warns that global routing must not be used where ML-processing location is required. This is useful only if AzeForge is already governed in GCP. [Locations][vertex-locations] |
| **Rate and concurrency controls** | Organization/project/model limits cover RPM, TPM, and other dimensions. Response headers expose remaining request/token limits and `Retry-After`; limits are not a capacity guarantee. [Rate limits][openai-rate] | Organization token-bucket limits cover RPM, input TPM, and output TPM; workspace limits can lower allocated usage and responses expose reset/remaining headers. New organizations can start below published tiers. [Rate limits][anthropic-rate] | Quotas are project, model, and region dependent, adding a GCP quota-management path. This is viable but unnecessary for the current single-owner Node deployment. [Vertex quotas][vertex-quota] |
| **Token and cost observability** | The response exposes usage for application telemetry; OpenAI also has organization usage/cost APIs and cost data can be grouped by project. Those organization reports require an Admin API key, which must be separate from the serving key. [Usage API][openai-usage] | Each SDK response has input/output token usage. The Usage & Cost Admin API supports model/workspace and USD cost reporting, but requires an Admin credential; do not put it in the serving process. [SDK usage][anthropic-sdk], [Usage & Cost API][anthropic-usage] | `usageMetadata`, Cloud Monitoring quotas, and Cloud Billing can provide observability, but the dimensions are spread across the application, Cloud Monitoring, and billing configuration. [Google Gen AI SDK][vertex-sdk], [Vertex quotas][vertex-quota] |
| **Mathematics, geometry, chemistry, and optional TeX** | A general text model plus schema-constrained envelope is technically suitable for proposing textual AzeMark, including math/geometry/chemistry and literal `tex` blocks; no cited provider documentation guarantees correctness in any of those domains or in AzeMark. Compiler diagnostics and explicit user approval are therefore mandatory. | Same conclusion. Structured JSON makes the envelope parseable, not the AzeMark semantically correct. | Same conclusion. Region/IAM benefits do not establish better AzeMark or scientific correctness. |

### Why OpenAI

Select the **OpenAI API, using the official Node SDK and the Responses API with
Structured Outputs**, as the first provider. It meets every requested capability
with the smallest additional operating surface for this existing Node service:
a supported server-side SDK, JSON-Schema output, project-scoped rate controls
and headers, data-retention controls, regional options where eligible, and
organization-level cost/usage reporting. Its model/provider APIs may evolve;
that is managed by pinning a named model snapshot where available and retaining
an AzeMark contract corpus, not by assuming output stability.

Anthropic is a credible alternative and particularly attractive if owner policy
requires its ZDR arrangement or US-only inference control. It is not selected
because it does not materially improve the proposed source-only boundary, and
its documented direct-API geography currently offers US/global rather than an
EU inference option. Vertex is materially distinct because it provides a GCP
project/IAM and US/EU multi-region control plane, but that benefit does not
justify adding GCP identity, quota, and billing operations to the declared
single-owner VM unless an owner requires it.

**Facts not established by this research:** no cited source guarantees a model's
mathematical, geometry, chemistry, TeX, or AzeMark correctness; no published
rate number should be embedded as a service promise; and regional/retention
eligibility is conditional on the owner's account, model, endpoint, and
contract. Verify those selections in the owner account before deployment.

## Deployable request boundary

Add a narrow, authenticated server endpoint only after owner approval, for
example `POST /v1/authoring/proposals`:

1. The browser sends its authenticated authoring intent, the current AzeMark
   Source, and any explicitly selected authoring options to AzeForge Web—not to
   OpenAI. It never selects a provider base URL or supplies credentials.
2. The Node service enforces its own source/body/concurrency/deadline limits,
   builds a stateless request, and calls a single `AuthoringProvider` adapter.
   The OpenAI implementation reads a deployment-owned key and fixed owner
   configuration (model snapshot/alias, allowed region, retention mode and
   maximum output tokens). It sends `store: false`; that is an application
   setting, **not** a substitute for the provider's documented account-level
   retention controls.
3. Require a small JSON Schema envelope such as
   `{ "source": string, "summary": string, "assumptions": string[] }` and
   reject a refusal, missing field, over-limit Source, or invalid envelope.
   The `source` field is the only candidate edit. Do not grant tools, file
   uploads, hosted execution, web search, artifact rendering, or provider-side
   conversation state.
4. Send the candidate Source through the installed compiler's `analyze`
   operation. Return the candidate text and compiler diagnostics to the
   authenticated browser; a successful model schema result is never a claim
   that the candidate compiles. The UI may offer explicit replacement only;
   it does not auto-apply and it does not request a rendered artifact from the
   model.
5. Log only request metadata: provider/model identifier, region mode, latency,
   HTTP/result class, input/output token counts, and a locally generated
   correlation ID. Do not log Source, prompt, candidate Source, keys, compiler
   diagnostics, or rendered bytes. Enforce server-side admission/concurrency
   independent of provider limits, honor `Retry-After`, and expose a generic
   retryable failure without returning provider internals.
6. Use a serving project key restricted to this deployment. Keep any OpenAI
   organization Admin key used for periodic cost reporting outside the serving
   process. Before enabling a non-default retention or regional mode, verify
   account approval, endpoint/model eligibility, and the exact current
   provider terms.

This is deliberately a one-way suggestion boundary. It preserves the existing
product rule that compiler output is authoritative and avoids both browser-held
credentials and direct model-to-artifact rendering.

## Sources

- [OpenAI SDKs and CLI][openai-sdk]
- [OpenAI Structured model outputs][openai-structured]
- [OpenAI data controls][openai-data]
- [OpenAI rate limits][openai-rate]
- [OpenAI organization Usage API][openai-usage]
- [Anthropic TypeScript SDK][anthropic-sdk]
- [Anthropic structured outputs][anthropic-structured]
- [Anthropic API and data retention][anthropic-data]
- [Anthropic data residency][anthropic-region]
- [Anthropic rate limits][anthropic-rate]
- [Anthropic Usage and Cost API][anthropic-usage]
- [Google Gen AI SDK on Vertex AI][vertex-sdk]
- [Google structured output][vertex-structured]
- [Google Vertex locations][vertex-locations]
- [Google Vertex quotas][vertex-quota]

[openai-sdk]: https://developers.openai.com/api/docs/libraries
[openai-structured]: https://developers.openai.com/api/docs/guides/structured-outputs
[openai-data]: https://developers.openai.com/api/docs/guides/your-data
[openai-rate]: https://developers.openai.com/api/docs/guides/rate-limits
[openai-usage]: https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage
[anthropic-sdk]: https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript
[anthropic-structured]: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
[anthropic-data]: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
[anthropic-region]: https://platform.claude.com/docs/en/manage-claude/data-residency
[anthropic-rate]: https://platform.claude.com/docs/en/api/rate-limits
[anthropic-usage]: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
[vertex-sdk]: https://cloud.google.com/vertex-ai/generative-ai/docs/sdks/overview
[vertex-structured]: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output
[vertex-locations]: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
[vertex-quota]: https://cloud.google.com/vertex-ai/generative-ai/docs/quotas
