# AzeForge Web

AzeForge Web is the single-user web product for AzeMark: an ephemeral Node
service that compiles Source through the published `@aruzone/aze-forge`
compiler, and a frontend for editing Source, reading live diagnostics,
previewing with a selected Theme and exporting HTML, SVG, PNG and PDF.

It is a separate repository that consumes a published compiler dependency. No
compiler source is copied, and there is no monorepo coupling.

## Scope

This repository implements the service, the edit-preview-export frontend, and —
per [Package the AzeForge Web image, env schema, and smoke suite](https://github.com/aruzone/aze-forge-web/issues/2)
and the [operating envelope](https://github.com/aruzone/aze-forge/issues/54) it
packages — the deployable image, the documented environment schema and the
deployment acceptance smoke suite. [Build the AzeForge Web service and
edit-preview-export frontend](https://github.com/aruzone/aze-forge-web/issues/1)
is the service and frontend work itself.

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
| Isolation | Every job runs in its own child process, and termination signals the worker's group *and* every process group its descendants lead — the pinned browser calls `setsid()`, so its own group is not the worker's. |
| Cancellation | Idempotent, and competes with completion at a single atomic terminal decision. A cancelled job never publishes an Artifact. |
| Deadlines | Start at admission and include queue time. A service deadline produces `failed` with the stable `job-timeout` code, never a fabricated Source diagnostic. |
| Artifacts | Delivered as bytes with their MIME type and byte-integrity hash, verified by the service before publication. Never base64 in JSON, never a partial Artifact. |
| Retention | Assets, results and cache entries expire; terminal results advertise `expiresAt` and keep it — an unexpired result is never evicted. Reaching the retained-result bound refuses new work (`503`) instead of shortening an advertised lifetime. |
| Logs | Metadata only. Source text, asset bytes, Artifact bytes and diagnostic messages never appear. |

The frontend owns editing, examples, request scheduling and polling,
stale-result rejection, Theme and format controls, explicit replacement
application and downloads. It does not reproduce compiler policy: what a
diagnostic means, what may be fixed and what renders all come from the compiler.

The preloaded examples are the compiler's own reference library
(`docs/language/*.aze.md`), reused verbatim: thirteen complete Sources spanning
every family, graded within each section from the minimal idiomatic form to the
deepest feature the directive registers, plus the deliberately invalid
diagnostics sampler. The library is not on the installed path — the published
package ships `dist`, `schemas` and its logo — so it is vendored into
`src/web/examples.json`, and moving to a new compiler release re-runs the
generator that produced it:

```bash
node scripts/examples.mjs --library ../aze-forge-3/docs/language
```

The compiler integration suite compiles every example through the real service,
so a vendored document that no longer parses or renders fails there rather than
in a browser.

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

Every limit knob's default is also its ceiling. Configuration may **lower** a
ceiling; any value above it is rejected at startup rather than silently clamped. Raising a
ceiling is an owner decision, not a configuration change.

| Variable | Default (= ceiling) | Notes |
| --- | --- | --- |
| `AZEWEB_ACCESS_TOKEN` | required | at least 32 characters, no whitespace |
| `AZEWEB_HOST`, `AZEWEB_PORT` | `0.0.0.0`, `8080` | |
| `AZEWEB_SCRATCH_DIR` | `$TMPDIR/aze-forge-web` | uploads, job snapshots, cache |
| `AZEWEB_MAX_RUNNING_JOBS`, `AZEWEB_QUEUE_DEPTH` | `2`, `8` | admission beyond either returns 429 |
| `AZEWEB_NODE_HEAP_MB` | `1024` | the Node heap ceiling the image pins for the service and every job worker |
| `AZEWEB_JOB_SUBMISSIONS_PER_MINUTE`, `AZEWEB_ASSET_UPLOADS_PER_MINUTE` | `30`, `60` | per client context |
| `AZEWEB_RATE_LIMIT_WINDOW_MS` | `60000` | |
| `AZEWEB_DEADLINE_ANALYZE_MS`, `AZEWEB_DEADLINE_COMPILE_MS` | `60000`, `300000` | measured from admission, queue time included |
| `AZEWEB_TERMINATION_GRACE_MS` | `5000` | SIGTERM, then SIGKILL, for the whole process group |
| `AZEWEB_POLL_AFTER_MS` | `2000` | polling guidance returned with each job |
| `AZEWEB_MAX_SOURCE_BYTES`, `AZEWEB_MAX_JOB_BODY_BYTES` | `1 MiB`, `2 MiB` | |
| `AZEWEB_MAX_ASSET_BYTES`, `AZEWEB_MAX_TOTAL_ASSET_BYTES`, `AZEWEB_MAX_ASSETS_PER_JOB` | `32 MiB`, `128 MiB`, `64` | |
| `AZEWEB_ASSET_TTL_MS`, `AZEWEB_RESULT_TTL_MS` | `24 h`, `1 h` | |
| `AZEWEB_MAX_RETAINED_JOBS` | `256` | unexpired terminal results held in memory; reaching it returns 503 rather than evicting a promised result |
| `AZEWEB_CACHE_MAX_BYTES`, `AZEWEB_CACHE_MAX_AGE_MS` | `256 MiB`, `24 h` | completed successful results only |
| `AZEWEB_SCRATCH_MAX_BYTES` | `2 GiB` | admission refuses with 503 when full |

An unrecognised `AZEWEB_*` variable is a startup error: a typo must not be
silently ignored.

## Deployment

One container on an owner-controlled VM: a single instance, no horizontal
scaling, no PaaS. The image is immutable and offline at runtime — the pinned
compiler release, the pinned `chrome-headless-shell` and the woff2 fonts the
compiler inlines are baked at build time, so provisioning is verified once per
image instead of at runtime on a foreign host.

```bash
docker build --platform linux/amd64 -t aze-forge-web:"$(git rev-parse --short HEAD)" .
```

The base image is `node:24-bookworm-slim`, pinned by manifest-list digest inside
the `Dockerfile`, so it cannot move under a rebuild. `/app/image-manifest.json`
records the exact pins the built image contains — compiler release, resolved
dependency tree, fonts, and the browser's build, digest and archive.

**Target platform.** `linux/amd64`. The pinned `chrome-headless-shell`
152.0.7977.75 is only published for `linux64` on Linux (Chrome for Testing began
publishing `linux-arm64` headless shells at 153.0.8001.0), so an arm64 image
would bake a browser it cannot execute. The manifest records both the runtime
platform and the browser archive it baked, and the smoke suite refuses the pair
when they disagree.

```bash
docker run -d --name azeweb \
  --read-only \
  --tmpfs /scratch:rw,noexec,nosuid,nodev,size=2g,mode=1777 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777 \
  --cap-drop=ALL --security-opt=no-new-privileges --security-opt=seccomp=unconfined \
  --memory=6g --memory-swap=6g --pids-limit=512 \
  --log-driver=local --log-opt max-size=50m --log-opt max-file=8 \
  -e AZEWEB_ACCESS_TOKEN="$(openssl rand -hex 24)" \
  -p 127.0.0.1:8080:8080 \
  aze-forge-web:"$(git rev-parse --short HEAD)"
```

- **Read-only rootfs, two writable volumes.** `/scratch` is the tmpfs mounted at
  `AZEWEB_SCRATCH_DIR`: uploads, job snapshots, cache and Artifacts live there
  and die with the container. `/tmp` is a smaller tmpfs because a read-only
  rootfs leaves the runtime nowhere to write — the pinned browser refuses to
  start without a writable temporary directory. Neither survives the container.
- **No capabilities, no privilege escalation.** `--cap-drop=ALL` with
  `no-new-privileges`: nothing in the container can gain a capability, and the
  browser's setuid sandbox does not exist, so Chrome runs as the non-root `node`
  user on its namespace sandbox alone.
- **Browser sandbox — the one deviation from the envelope's hardening list.**
  `--security-opt=seccomp=unconfined` is load-bearing and is *not* in the
  envelope's hardening list, so it is recorded here as a deviation for the owner
  to accept or reject rather than as ordinary hardening. Docker's default seccomp
  profile refuses `clone(CLONE_NEWUSER)` to a container without `CAP_SYS_ADMIN`,
  and Chrome refuses to start without a usable sandbox; the pinned compiler owns
  the browser's launch arguments, so `--no-sandbox` is not available to this
  deployment. The choice is therefore the browser's own namespace sandbox with
  Docker's syscall filter relaxed, or an image that cannot render at all.
  Every other isolation flag above stays, and every acceptance run prints this
  deviation with its evidence.
  Two host notes: Ubuntu 23.10+ hosts additionally restrict unprivileged user
  namespaces through AppArmor (`kernel.apparmor_restrict_unprivileged_userns`),
  which the owner must relax for the container's namespace sandbox to be
  permitted; and without a namespace sandbox the render checks fail loudly with
  `azeforge.renderer#adapter-missing` rather than rendering something else.
- **Bounded.** `--memory`/`--memory-swap` cap the container; `--pids-limit`
  bounds process count; the image pins the Node heap ceiling
  (`AZEWEB_NODE_HEAP_MB`) for the service *and* for each job worker, so a
  runaway job dies inside its own process group rather than at the OOM killer.
- **No egress, and the port is the ingress.** The published port is bound to the
  loopback interface, so the only way in is the TLS terminator on the host; TLS
  never happens inside the container. Nothing the service or the compiler runs
  opens an outbound connection — the compiler's request fence admits only
  `about:blank` and `data:font/woff2`, and remote assets are denied at the
  request boundary — and the container can be denied egress at the host's
  firewall for defence in depth. That block belongs to the host, not to this
  image, and not to `docker network create --internal`: an internal network also
  removes the container's route back to the host, so the published port stops
  working with it. The smoke suite stages the deployment profile on the default
  bridge for that reason, and does not claim to verify host-level egress.
- **Logs stay local.** The service logs metadata-only JSON to stdout and writes
  no files, so the container's log driver is the whole story: it must go to
  local disk with rotation (for example `--log-driver=local
  --log-opt max-size=50m --log-opt max-file=8`, about the fourteen-day window
  the envelope asks for) and never to a remote or third-party driver. There is
  no telemetry and no analytics anywhere in the image.
- **Rollout.** Build a new immutable tag → run the acceptance suite against the
  staged container → stop the old container, start the new one. Rollback is
  redeploying the previous tag; tags are never mutated. Cache never survives
  cutover because it is on the scratch tmpfs.

### Deployment acceptance smoke suite

```bash
npm run smoke -- --image aze-forge-web:"$(git rev-parse --short HEAD)"
```
The suite stages the image twice — the deployment profile, and a probe profile
with a lowered compile deadline and result retention — and runs the nine
acceptance checks of the operating envelope against them, collecting its
container-level evidence (browser processes, log lines, the image manifest)
through `docker exec`. It writes its recorded output to
`acceptance/smoke/<timestamp>-<pass|fail>.txt` and the same run as structured
JSON next to it; that output is the evidence artifact of the cutover decision,
and it exits non-zero if any check fails.

Nothing about the suite is a stub: it compiles a real golden report
(`acceptance/golden-report.aze.md`) to all four formats and verifies each
downloaded Artifact against its advertised byte-integrity hash. It can also run
against an already-deployed URL when the container name is reachable
(`--base-url … --container …`); the checks that need process or log access fail
rather than pass vacuously when no container is given.

### The owner walkthrough (Checkpoint B)

`acceptance/walkthrough.aze.md` is the alpha's representative Source: one
document spanning all ten native capability families plus the composition layer
around them — a numbered equation and derivation, a plot and a chart, two
geometry constructions, a flowchart and an architecture, a sequence, a state
machine, an entity schema and a class hierarchy, a circuit, both timing scales,
a formula, a reaction and a structure, a control loop and a free body, a typed
table, an algorithm, a proved statement and a worked example, a wrapped figure,
a citation, an endnote and a bibliography.

```bash
npm run walkthrough -- --image aze-forge-web:"$(git rev-parse --short HEAD)"
npm run walkthrough -- --base-url https://alpha.example --container azeweb
```

The walkthrough performs the acceptance-decision pass (`aruzone/aze-forge#53`
§6) against the deployment: it opens that Source and reads the live diagnostics,
checks the Document against the ten families, asserts the advertised canonical
runtime is the approved matrix and the capability fingerprint is the pinned
release's, toggles every advertised Theme (asserting one semantic identity and
one distinct layout per Theme), exports HTML, SVG, PNG and PDF and verifies each
download against the Artifact's advertised MIME type, length and byte-integrity
hash, and spot-checks the acceptance golden in two ways — two renders must be
byte-identical, and the render must match the identity recorded in
`acceptance/golden-identity.json`. A record that is absent, or a render that has
drifted from it, fails the step rather than passing on self-agreement; both are
re-recorded deliberately from a green run:

```bash
npm run walkthrough -- --image aze-forge-web:"$(git rev-parse --short HEAD)" --record-golden
```

The exported Artifacts are written to `acceptance/walkthrough/<stamp>-artifacts/`
for the owner to open; the recorded run goes to `acceptance/walkthrough/`.

The recorded golden is the *canonical image's* rendering, and the pinned
browser is deterministic per platform rather than across them: the same Source
rendered by a service running on macOS differs from the linux/x64 image in
bytes while agreeing on `contentHash`. That is the gate working — a walkthrough
against a deployment that is not the canonical one reports the drift and names
where the recording came from — so `--record-golden` belongs on the cutover
image, not on a developer's machine, where overwriting the recording would
quietly move the reference to a platform the alpha does not ship.
(To exercise the loop locally anyway, point `--golden-identity` at your own
recording, or run the walkthrough with `--golden` over a Source whose identity
you have recorded.)

The owner records the binary decision on the same deployment:

```bash
npm run walkthrough -- --image aze-forge-web:"$(git rev-parse --short HEAD)" \
  --approve owner@example.com
```

That writes one manual-evidence entry,
`acceptance/manual-evidence/alpha-walkthrough-001.json`, against the compiler
repository's existing manual-evidence schema (`azeforge.acceptance-manual-evidence/v1`):
`participantRole`, `consentedIdentifier`, the fixture's `contentHash`, the four
`artifactHashes`, the commands, the binary `result`, unresolved notes, the date,
the compiler fingerprint and the OS. Until the owner decides, the entry stays
`pending-owner-approval`. `--approve` is refused when an automated step failed,
so a broken run cannot be signed off.

**The fixture is the pinned release's own evidence.** The ten-family Source
needs a compiler release that carries all ten families plus the composition
layer, and the pinned `@aruzone/aze-forge` release now ships them: analyzing
`acceptance/walkthrough.aze.md` with the installed package reports an
error-free Document that covers every family, and the compiler integration
suite asserts the same document analyzes cleanly before any image is built.
Until a release carried all of them, the walkthrough failed closed and named
the families it could not find rather than approving a narrower document; that
gate is the same one to re-check when the pin moves.
The cutover's catalog clause reads the same prerequisite from the other side —
a green automated catalog entry for every family — so a release that adds a
family without catalog entries to match fails there instead of passing here.

### Cutover

```bash
npm run cutover -- --image aze-forge-web:"$(git rev-parse --short HEAD)" \
  --catalog-report /path/to/aze-forge-acceptance-report.json \
  --approve owner@example.com
```

`cutover` runs the smoke suite and the walkthrough against the one image, reads
the compiler repository's automated acceptance report (`scripts/acceptance.mjs
--json` in `aze-forge`, schema `azeforge.acceptance-report/v1`), and decides the
alpha pass/fail rule of `aruzone/aze-forge#53` §8: every automated semantic and
deterministic-render catalog entry green with no unpending drift (the approved
`azemark:2` re-baseline is the only pre-approved exception — `--accept-drift`
accepts that id and no other), the deployability suite green, and the owner's
Approve recorded — all three against the same image digest, because deployable
means the staged image is the cutover image. It writes
`acceptance/cutover/<stamp>-<approved|not-approved>.{txt,json}` with the three
clauses, the conflicting digests or the missing report spelled out. Any one
blocking failure withholds approval; there is no partial approval.

The catalog clause reads the report against the catalog the *pinned* release
publishes (`ACCEPTANCE_ENTRIES` from `@aruzone/aze-forge/contracts`), so an
entry the pinned release does not publish means the report describes another
build. For each of the ten families and composition it then asks the catalog
which evidence that family has: automated entries that must be green (a family
whose entries ran and failed is named), an area the compiler evidences only
manually — the Circuit family — which is recorded as such rather than demanded
as an automated entry no release will publish, or no entry at all, which
withholds approval and names the family, because the acceptance decision
requires the catalog to carry a per-family entry for every approved native
family plus composition.

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
- **Some advertised schemas are not published.** `publicSchemaVersions()`
  advertises 50 ids, and the `contracts` entry point ships no schema document
  for 35 of them: the watch event, and both the source and data schema of every
  family added after the typed table — formula, reaction, structure, circuit,
  timing, diagram, sequence, state, entity, class, control, free-body,
  algorithm, statement, example, figure and bibliography. Those ids return 404
  and are logged as `schema-advertised-but-not-published` at startup.
- **No Renderer selection.** `CompileOptions` accepts a format and a Theme, not
  a Renderer id, so the request boundary accepts exactly those two and rejects a
  `renderer` field rather than accepting one it cannot honour.
- **Capabilities publish no per-capability support mode.** The registry holds
  `pluginVersionRange`, `rendererVersionRange` and the source/data schemas, but
  `buildCapabilities()` emits only `type`, `version`, `title`, `namespace` and
  `bodySyntax` per Plugin, plus block-renderer ids and per-block limits. Native
  versus delegated support, compatible Renderer routes and structured remedies
  per capability are therefore absent from `/v1/capabilities`. The service
  embeds exactly what the compiler publishes; deriving a parallel per-family
  matrix here would duplicate compiler policy, which the boundary contract
  forbids.

## Tests

```bash
npm test              # everything
npm run test:unit     # configuration, protocol, stores, coordinates
npm run test:service  # HTTP policy against a stubbed worker, real HTTP
npm run test:compiler # the real pinned compiler, real Artifacts
npm run smoke         # the deployment acceptance suite (needs a built image)
npm run walkthrough   # the owner walkthrough against a staged image
npm run cutover       # both suites plus the alpha pass/fail decision
npm run typecheck
```

The service tests own what the service is responsible for — access, envelopes,
admission, isolation, deadlines, cancellation, retention, Artifact delivery and
log privacy — and stub the worker so they need no browser; the walkthrough's own
steps are tested there too. The compiler tests run
the real loop: every preloaded example validates and previews, all four formats
produce bytes whose advertised hash matches, and an unavailable required engine
fails with a truthful diagnostic instead of a silent fallback. The acceptance
golden report is analyzed there too, so a document the smoke suite compiles
cannot rot unnoticed.

## Architecture

```
src/service/
  main.mjs            wiring: configuration → compiler facts → stores → HTTP
  config.mjs          environment schema, validated at startup, fail-closed
  limits.mjs          the alpha envelope values, single source of truth
  server.mjs          routing, envelopes, access boundary, rate limits
  protocol.mjs        strict request validation
  jobs.mjs            admission, queue, deadlines, cancellation, retention
  executor.mjs        worker launch, process-group termination
  worker-entry.mjs    the per-job child process
  runner.mjs          the compiler operations, on the child side
  assets.mjs          upload handles
  cache.mjs           bounded Artifact reuse
  readiness.mjs       fail-closed startup validation
  capabilities.mjs    the compiler's capabilities plus this deployment's policy
  schemas.mjs         the published schema registry
src/web/              the frontend: no build step, no runtime dependencies
Dockerfile            the deployable image (Node LTS + pinned browser + fonts)
docker/               the image entrypoint and the build-time browser provisioning
scripts/cli.mjs       the flags, recorder and failure vocabulary the suites share
scripts/http.mjs      the HTTP client: hard timeouts, bytes, hashes
scripts/jobs.mjs      the job protocol client: submit, poll, download, verify
scripts/containers.mjs      staging under the deployment's hardening flags
scripts/smoke.mjs     the deployment acceptance suite (nine checks, recorded output)
scripts/smoke/        its checks and Sources
scripts/walkthrough.mjs     the owner walkthrough (Checkpoint B, recorded evidence)
scripts/walkthrough/  its steps, family coverage, golden identity and the evidence entry
scripts/cutover.mjs   the cutover: runs both suites, decides the alpha pass/fail rule
scripts/cutover/      the catalog accessor and the rule itself
scripts/image-manifest.mjs  the image's exact pins, generated at build time
scripts/examples.mjs        regenerates src/web/examples.json from the compiler's library
acceptance/           the walkthrough Source, the golden report and its identity,
                      the upload fixture, and the recorded suite output
```
