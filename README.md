# AzeForge Web

AzeForge Web is the single-user web product for AzeMark: an ephemeral Node
service that compiles Source through the published `@aruzone/aze-forge`
compiler, and a frontend for editing Source, reading live diagnostics,
previewing with a selected Theme and exporting HTML, SVG, PNG and PDF.

It is a separate repository that consumes a published compiler dependency. No
compiler source is copied, and there is no monorepo coupling.

## Scope

This repository implements the service and the edit-preview-export frontend, per
[Build the AzeForge Web service and edit-preview-export frontend](https://github.com/aruzone/aze-forge-web/issues/1).
The deployable image, the documented environment schema and the deployment
acceptance smoke suite are [Packaging work](https://github.com/aruzone/aze-forge-web/issues/2).

Explicitly out of scope, by decision: accounts, signup, saved cloud projects,
collaboration, LLM integration, durable storage, cross-client sharing, remote
asset fetching, browser-only compilation, and hosted raw LaTeX.

## Quick start

Node 24 (or 22) — the compiler's supported engines range, which excludes the
odd-numbered and newer lines.

```bash
npm install
AZEWEB_ACCESS_TOKEN=$(openssl rand -hex 24) npm start
# then open http://127.0.0.1:8080 and paste the token
```

The service refuses to start with an invalid configuration, and reports not-ready
until it can prove the compiler registry constructs, the pinned browser engine is
present, scratch storage is writable, and a real compile of a trivial Source
succeeds in an isolated child process.

## What the service is responsible for

| Area | Behaviour |
| --- | --- |
| Access | One deployment-issued bearer token; `/v1` is closed without it. The token's digest is the client context that scopes asset handles, jobs and cache entries. |
| Protocol | `/v1`, `protocolVersion: 1`, strict request validation. Unknown fields, unadvertised Themes/formats and unsupported operations are errors. |
| Snapshots | A job is one immutable Source snapshot plus frozen asset bindings and render choices. There is no server-side editable project and no patch protocol. |
| Isolation | Every job runs in its own child process and process group, so the browser the compiler launches dies with it. |
| Cancellation | Idempotent, and competes with completion at a single atomic terminal decision. A cancelled job never publishes an Artifact. |
| Deadlines | Start at admission and include queue time. A service deadline produces `failed` with the stable `job-timeout` code, never a fabricated Source diagnostic. |
| Artifacts | Delivered as bytes with their MIME type and byte-integrity hash, verified by the service before publication. Never base64 in JSON, never a partial Artifact. |
| Retention | Assets, results and cache entries expire; terminal results advertise `expiresAt`. |
| Logs | Metadata only. Source text, asset bytes, Artifact bytes and diagnostic messages never appear. |

The frontend owns editing, examples, request scheduling and polling,
stale-result rejection, Theme and format controls, explicit replacement
application and downloads. It does not reproduce compiler policy: what a
diagnostic means, what may be fixed and what renders all come from the compiler.

## HTTP surface

| Method and path | Contract |
| --- | --- |
| `GET /healthz`, `GET /readyz` | Unauthenticated and detail-free: liveness and readiness only. Everything informative lives behind the token. |
| `GET /v1/capabilities` | The installed compiler's capability document, embedded verbatim, plus this deployment's effective policy, limits, deadlines and retention. |
| `GET /v1/schemas/{schemaId}` | The schemas of the installed compiler, plus the service's own envelopes. Schema ids contain `/`; percent-encode it or not, both work. |
| `POST /v1/assets` | Binary upload; returns an opaque temporary handle and its expiry. |
| `DELETE /v1/assets/{assetId}` | Revokes the handle for future submissions. An accepted job keeps the bytes it froze. |
| `POST /v1/jobs` | Admits an operation snapshot; returns `202` with a job id, status URL and polling guidance. |
| `GET /v1/jobs/{jobId}` | Poll status, or read a terminal structured result. |
| `POST /v1/jobs/{jobId}/cancel` | Idempotent cancellation; reports the authoritative current state. |
| `GET /v1/jobs/{jobId}/artifact` | The completed job's binary Artifact. |

Operations are `analyze`, `compile` and `format`. `migrate` is named by the
library/service boundary but the pinned compiler release exposes no migration
operation, so the service rejects it explicitly with a remedy and advertises the
gap in `service.unavailableOperations` rather than approximating it.

Error envelopes are separate from compiler diagnostics: `unauthorized` (401),
`not-found` (404, uniform for unknown, expired and inaccessible handles),
`request-malformed` / `protocol-version-unsupported` / `operation-unsupported` /
`option-unsupported` (400), `method-not-allowed` (405), `payload-too-large`
(413), `admission-limit` / `rate-limit-exceeded` (429), `service-unavailable`
(503), and `internal-error` (500). Expected compiler failures — invalid Source,
an unavailable required engine — are *completed* job results with `ok: false`
and compiler diagnostics, never HTTP failures.

## Configuration

Environment variables only, validated at startup, fail-closed. Missing or invalid
configuration is a startup error, never a runtime surprise.

Every knob has a built-in alpha ceiling. Configuration may **lower** a ceiling;
any value above it is rejected at startup rather than silently clamped. Raising a
ceiling is an owner decision, not a configuration change.

| Variable | Default (= ceiling) | Notes |
| --- | --- | --- |
| `AZEWEB_ACCESS_TOKEN` | required | at least 32 characters, no whitespace |
| `AZEWEB_HOST`, `AZEWEB_PORT` | `0.0.0.0`, `8080` | |
| `AZEWEB_SCRATCH_DIR` | `$TMPDIR/aze-forge-web` | uploads, job snapshots, cache |
| `AZEWEB_MAX_RUNNING_JOBS`, `AZEWEB_QUEUE_DEPTH` | `2`, `8` | admission beyond either returns 429 |
| `AZEWEB_JOB_SUBMISSIONS_PER_MINUTE`, `AZEWEB_ASSET_UPLOADS_PER_MINUTE` | `30`, `60` | per client context |
| `AZEWEB_RATE_LIMIT_WINDOW_MS` | `60000` | |
| `AZEWEB_DEADLINE_ANALYZE_MS`, `AZEWEB_DEADLINE_COMPILE_MS` | `60000`, `300000` | measured from admission, queue time included |
| `AZEWEB_TERMINATION_GRACE_MS` | `5000` | SIGTERM, then SIGKILL, for the whole process group |
| `AZEWEB_POLL_AFTER_MS` | `2000` | polling guidance returned with each job |
| `AZEWEB_MAX_SOURCE_BYTES`, `AZEWEB_MAX_JOB_BODY_BYTES` | `1 MiB`, `2 MiB` | |
| `AZEWEB_MAX_ASSET_BYTES`, `AZEWEB_MAX_TOTAL_ASSET_BYTES`, `AZEWEB_MAX_ASSETS_PER_JOB` | `32 MiB`, `128 MiB`, `64` | |
| `AZEWEB_ASSET_TTL_MS`, `AZEWEB_RESULT_TTL_MS` | `24 h`, `1 h` | |
| `AZEWEB_MAX_RETAINED_JOBS` | `256` | in-memory job records |
| `AZEWEB_CACHE_MAX_BYTES`, `AZEWEB_CACHE_MAX_AGE_MS` | `256 MiB`, `24 h` | completed successful results only |
| `AZEWEB_SCRATCH_MAX_BYTES` | `2 GiB` | admission refuses with 503 when full |

An unrecognised `AZEWEB_*` variable is a startup error: a typo must not be
silently ignored.

## Caching

Two identities are kept deliberately distinct:

- the **authoritative identity** the compiler computes for a completed compile
  (`contentHash`, `assetManifestHash`, `rendererFingerprint`, `artifactHash`,
  render options, compiler release). It is recorded with the cache entry so the
  claim is inspectable rather than assumed;
- the **admission fingerprint** the service computes from an immutable job
  snapshot (exact Source bytes, bound asset bytes, operation choices, compiler
  release and capability fingerprint) to decide whether a previous entry can
  answer a new submission.

The fingerprint is only ever computed by the service from bytes it holds; a
client-supplied key or hash can never select an entry. Cache entries are copies,
so evicting one can never break an advertised download. Alpha caches completed
successful results only, layered over `contentHash + assetManifestHash +
rendererFingerprint + canonical render options + compiler version`, bounded by
the LRU byte budget above, in memory and on the ephemeral scratch volume.

## Known compiler-side gaps observed against the pinned release

These are recorded because the service reports what the library actually offers
rather than papering over it. They belong to the compiler repository:

- **`migrate` is not available.** The public `Compiler` interface exposes
  `parse`, `validate`, `format` and `compile` only, so the service rejects
  `migrate` with a remedy (see above).
- **`contentHash` is only computed while rendering.** `validate` returns a
  Document but no `contentHash`, and a render that fails returns diagnostics
  without Document or hash. The worker therefore validates first, so a failed
  render still reports `semantic.valid: true`; a semantic `contentHash` is
  reported when, and only when, the compiler produced one.
- **Some advertised schemas are not published.** `publicSchemaVersions()` lists
  ids such as `azeforge.event/v1` and `azeforge.formula/source/v1` for which the
  `contracts` entry point ships no schema document. Those ids return 404 and are
  logged as `schema-advertised-but-not-published` at startup.
- **No Renderer selection.** `CompileOptions` accepts a format and a Theme, not
  a Renderer id, so the request boundary accepts exactly those two and rejects a
  `renderer` field rather than accepting one it cannot honour.

## Tests

```bash
npm test              # everything
npm run test:unit     # configuration, protocol, stores, coordinates
npm run test:service  # HTTP policy against a stubbed worker, real HTTP
npm run test:compiler # the real pinned compiler, real Artifacts
npm run typecheck
```

The service tests own what the service is responsible for — access, envelopes,
admission, isolation, deadlines, cancellation, retention, Artifact delivery and
log privacy — and stub the worker so they need no browser. The compiler tests run
the real loop: every curated example validates and previews, all four formats
produce bytes whose advertised hash matches, and an unavailable required engine
fails with a truthful diagnostic instead of a silent fallback.

## Architecture

```
src/service/
  main.mjs            wiring: configuration → compiler facts → stores → HTTP
  config.mjs          environment schema, validated at startup, fail-closed
  limits.mjs          the alpha envelope values, single source of truth
  server.mjs          routing, envelopes, access boundary, rate limits
  protocol.mjs        strict request validation
  jobs.mjs            admission, queue, deadlines, cancellation, retention
  executor.mjs        process-group isolation and termination
  worker-entry.mjs    the per-job child process
  runner.mjs          the compiler operations, on the child side
  assets.mjs          upload handles
  cache.mjs           bounded Artifact reuse
  readiness.mjs       fail-closed startup validation
  capabilities.mjs    the compiler's capabilities plus this deployment's policy
  schemas.mjs         the published schema registry
src/web/              the frontend: no build step, no runtime dependencies
```
