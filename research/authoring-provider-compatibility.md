# Authoring provider compatibility

**Researched:** 2026-10-02. This note covers the deployed authoring request, not a hypothetical provider adapter.

## Configuration and lifecycle

The service reads its environment once in `main()` through `loadConfig(process.env)`, before it creates the application. It creates the authoring provider once during application construction only when `AZEWEB_AUTHORING_API_KEY` is non-empty. No request reads or changes provider configuration. [config source](../src/service/config.mjs#L73-L168), [startup source](../src/service/main.mjs#L144-L162), [provider construction](../src/service/main.mjs#L89-L100)

| Setting | Default or behavior |
| --- | --- |
| `AZEWEB_AUTHORING_API_KEY` | Optional secret. Its absence disables authoring. |
| `AZEWEB_AUTHORING_BASE_URL` | `https://api.commandcode.ai/provider/v1` |
| `AZEWEB_AUTHORING_MODEL` | `deepseek/deepseek-v4-flash` |
| `AZEWEB_AUTHORING_DEADLINE_MS` | `30000`, passed to the OpenAI client timeout. |

The base URL may be any absolute `https:` URL. The configuration has no provider allowlist or model allowlist. That is not unrestricted compatibility: the service always calls the OpenAI JavaScript SDK's `POST {baseURL}/responses` path with a developer/user `input` array, `max_output_tokens: 16384`, and `text.format` set to a strict JSON Schema. It then requires `status === "completed"` and string `output_text`. [validation](../src/service/config.mjs#L128-L137), [request and response contract](../src/service/authoring.mjs#L12-L37) [request and response contract](../src/service/authoring.mjs#L216-L240)

An endpoint is usable only if it accepts that exact Responses request and returns that exact response shape. The service cannot select a Chat Completions endpoint, translate `response_format` to `text.format`, send router preferences, retry, or adapt another provider's response.

## Supported direct OpenAI option

OpenAI currently lists `gpt-5.3-codex` in its API model catalogue. Its model page declares model ID `gpt-5.3-codex`, supports `v1/responses`, lists Chat Completions as unsupported, and lists `structured_outputs` among its supported features. This is a direct match for the service contract. [OpenAI model catalogue](https://developers.openai.com/api/docs/models.md) and [GPT-5.3-Codex capabilities](https://developers.openai.com/api/docs/models/gpt-5.3-codex.md)

```sh
AZEWEB_AUTHORING_API_KEY="$OPENAI_API_KEY"
AZEWEB_AUTHORING_BASE_URL=https://api.openai.com/v1
AZEWEB_AUTHORING_MODEL=gpt-5.3-codex
```

OpenAI's Structured Outputs guide documents `text.format` with a `json_schema` object and `strict: true`, the same request form used here. It says Structured Outputs is available in current large language models beginning with GPT-4o. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs.md)

## OpenRouter: endpoint exists, this exact use is not yet proven

OpenRouter documents `https://openrouter.ai/api/v1/responses` as an OpenAI-compatible, drop-in Responses API. Its basic Responses guide documents the input-array form, `max_output_tokens`, and a final response with `status: "completed"` and `output[].content[].text`. The service is stateless, so OpenRouter's rejection of `store: true` and `previous_response_id` does not conflict with its request. [OpenRouter Responses overview](https://openrouter.ai/docs/api_reference/responses/overview) and [OpenRouter basic Responses use](https://openrouter.ai/docs/api_reference/responses/basic-usage)

```sh
AZEWEB_AUTHORING_API_KEY="$OPENROUTER_API_KEY"
AZEWEB_AUTHORING_BASE_URL=https://openrouter.ai/api/v1
AZEWEB_AUTHORING_MODEL=openai/gpt-5.3-codex
```

That example is a configuration candidate, not a source-backed approval for production. OpenRouter's `openai/gpt-5.3-codex` model-specific API page confirms Chat Completions and advertises `response_format` there, but it does not list Responses among the confirmed APIs. [OpenRouter GPT-5.3-Codex API guide](https://openrouter.ai/openai/gpt-5.3-codex/llms.txt)

OpenRouter's Structured Outputs guide documents `response_format` for its Chat Completions API, not the service's Responses `text.format` field. It also says structured-output support is per endpoint, can change, and strict enforcement varies by provider. The guide advises `require_parameters: true` to restrict routing to endpoints that support a requested parameter, but this service does not send router preferences. [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs) and [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

## Deployment caveats

- The current default is CommandCode, not OpenAI or OpenRouter. A deployment must override both base URL and model, and supply the matching provider key.
- Direct OpenAI with `gpt-5.3-codex` is source-backed for this service's Responses plus strict-schema request.
- OpenRouter's generic Responses endpoint and its general structured-output feature do not establish that `openai/gpt-5.3-codex` accepts the exact `text.format` request or returns a compatible `output_text`. Do not treat the OpenRouter example as confirmed until an owner-key smoke request proves those fields against the selected model and route.
- OpenRouter's default routing load-balances across providers. Because this integration cannot send `provider.require_parameters: true`, a configured OpenRouter model needs an endpoint-level compatibility check whenever the route or model changes.
