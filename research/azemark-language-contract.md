# AzeMark language contract audit for documentation

Ticket: aruzone/aze-forge-web#38 (part of #32).
Authority: every claim below names its source and a confidence level.
Pinned compiler: `@aruzone/aze-forge` **0.6.2** (`package.json`), verified live
via `buildCapabilities({probe:false})`, `buildGrammarDocument()`,
`createVersionReport()`, the published JSON schemas, and this repo's own
service code, tests, scripts, and vendored examples. Claims marked
**HIGH** were observed directly in this checkout. **MEDIUM** means stated by
the upstream README inside the installed tarball but not re-proven here.
**LOW / UNVERIFIED** means inferred or not present in any authoritative
source available to this repo.

## 1. Document envelope (HIGH)

Source: `buildGrammarDocument()` output (`azemarkVersions: [2]`,
`tool: {name: azeforge, version: 0.6.2}`) cross-checked with
`acceptance/walkthrough.aze.md`, `acceptance/golden-report.aze.md`, and the
16 vendored examples in `src/web/examples.json`.

- File: `.aze.md` Source, MIME `text/x-azemark`; semantic Document data is
  `application/vnd.azeforge.document+json`, schema versions `[3]`
  (capabilities `source`/`document` sections). HIGH.
- Front matter: `---` delimiters, YAML. Required: `azemark: 2` (integer).
  Optional: `title` (text), `author` (string-list), `theme` (text),
  `outputs` (string-list, values `html|svg|png|pdf`), `defaults` (record),
  `citation-style` (enum `numeric|author-year`). HIGH for keys/types;
  the *semantics* of `defaults` and `outputs` are UNVERIFIED (no
  documentation in this repo; needs a product decision, §7).
- Fences: outer `::::`, nested `::` (inside `figure`), header/body
  separator `----`, indent 2. Per `CONTEXT.md`, five colons (`:::::`) is
  never standard and must be rejected, never normalized. HIGH.
- Comments: `//` prefix. Identifier scope: document-wide, pattern
  `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` (kebab-case). Max nesting depth 8. HIGH.
- Document-level features proven by the walkthrough: `@id` cross-references
  (e.g. `@geometric-series-sum`), citations `[@knuth-1984, page 23]`,
  endnote `[^method]`, numbered `figure` wrapping a nested `:: equation`
  block, `bibliography`. HIGH (observed in `walkthrough.aze.md` lines
  ~1005–1031); exact citation/endnote syntax rules are LOW (single example
  each, no grammar entry — grammar covers directives only).

## 2. Directives: the 26-type inventory (HIGH)

Source: `buildGrammarDocument().directives` — every entry below is that
document's `type`, required header fields, body form, and limits, verbatim.
This grammar document (schema `azeforge.grammar/v1`) is the machine-readable
contract the upstream README points generators at; the docs site should treat
it as the normative field reference.

| # | Directive | Required header fields | Body form | Notable limits |
| --- | --- | --- | --- | --- |
| 1 | `equation` | all optional (`id`, `number`, `align: left\|center\|right`, `syntax: readable\|latex`) | scalar lines: `expression` | 4000 source / 4000 TeX chars |
| 2 | `derivation` | all optional (`id`, `number`, `align`) | scalar lines: repeated `- expression:` + optional `annotation:` | 4000 / 4000 |
| 3 | `callout` | all optional (`id`, `variant: note\|tip\|important\|warning\|caution`, `title`) | keyed sections, Markdown children | — |
| 4 | `mermaid` | all optional (`id`, `title`, `description`) | scalar lines: `source` + optional `diagramType` (11 values: `flowchart`, `graph`, `sequencediagram`, `classdiagram`, `statediagram`, `statediagram-v2`, `erdiagram`, `pie`, `gantt`, `journey`, `mindmap`) | 8000 / 8000 chars |
| 5 | `tex` | **required** `title`, `description`, `profile: circuitikz\|tikz\|pgfplots\|chemfig\|tikz-cd` (+ optional `id`) | scalar lines: figure `body` | 50000 body chars |
| 6 | `table` | all optional (`id`, `number`, `caption`) | keyed sections: `columns` (each `key` + `type: prose\|text\|integer\|decimal\|quantity\|boolean\|math`, optional `name/unit/align`), optional `groups`, `rows` | 64 cols, 1000 rows, 16 groups; 500 text / 4000 math chars per cell |
| 7 | `plot` | all optional (`id`, `number`, `width/height`, `legend/grid`, `parameters`, `x-axis/y-axis` records with `label/scale: linear\|log/min/max`) | record list (`-`): `function` (`expression` + required `domain{min,max}`), `line` (`points`), … | 16 series, 5000 pts/series, 10000 samples, 64 params, 500 label chars |
| 8 | `chart` | **required** `type: bar\|grouped-bar\|stacked-bar\|histogram` (+ optional `id`, `number`, dims, `legend/grid`, `x-label/y-label/y-min/y-max`) | record list: `bars` (`category/value`, optional errors), `histogram` (`values`, …) | 16 series, 10000 histogram values, 256 bins / bar categories |
| 9 | `geometry` | all optional (`id`, `number`, `width/height`, `bounds{min-x,min-y,max-x,max-y}`) | record list of constructions: `point/segment/line/ray/circle/arc/polygon/midpoint/intersection/tangent-line/perpendicular-foot/perpendicular-line/parallel-line/angle-mark/length-mark/equal-marks/right-angle-mark` | 256 declarations, 64 polygon vertices, 16 equal-mark segments/groups |
| 10 | `formula` | all optional (`id`, `number`) | scalar lines: chemical `expression` | 512 expr chars, charge ≤ 8, subscript ≤ 999, group nesting ≤ 3, isotope mass ≤ 299 |
| 11 | `reaction` | all optional (`id`, `number`, `above/below`, `balance: none\|check`) | scalar lines: reaction `equation` | 32 species, 128 chars/species, 256 condition chars |
| 12 | `structure` | all optional (`id`, `number`, `width/height`) | record list: `atom` (`element` enum of all 118 symbols, …), bonds | 512 atoms, 4096×4096, 500 label chars |
| 13 | `circuit` | **required** `title` (+ optional `id`, `number`, `description`, `flow: left-to-right\|top-to-bottom`) | record list: `node/connect/voltage-label/current-label` + components (`resistor`, …), relations, annotations | 64 components, 128 nodes, 512 relations, 128 annotations |
| 14 | `timing` | **required** `title` (+ optional `id`, `number`, `description`, `scale: cycles\|time`, `unit: ns\|µs\|ms\|s`) | record list: `signal` (`ref`, `clock/phase/width/wave`, `intervals[state: low\|high\|unknown\|impedance\|bus\|continue\|rise\|fall + duration]`), `group`, markers, arrows | 32 signals, 256 intervals/signal (2048 total), 16 groups (depth 2), 32 markers/arrows |
| 15 | `diagram` | **required** `mode: flowchart\|graph\|tree\|architecture` (+ optional `id`, `number`, `title/description`, `flow` incl. `bottom-to-top`, `right-to-left`) | record list: `node` (shapes: `rectangle/rounded/diamond/parallelogram/circle/hexagon/cylinder`, `parent`, `ports[left\|right\|top\|bottom]`), `group`, edges | 512 declarations, 128 nodes, 256 edges, 32 groups (depth 4), 12 ports/node |
| 16 | `sequence` | all optional | keyed sections: `participants` (name/label/kind), `timeline` (`message/alt/loop/note`, `sync/async/return`) | 12 participants, 256 timeline items, fragment depth 4 |
| 17 | `state` | all optional | record list: `state/initial/final/transition` incl. nested `states` | 64 states, depth 3, 128 transitions |
| 18 | `entity` | all optional | record list: `entity/relationship`, attributes (`primary/foreign/unique` keys, `references`) | 32 entities, 64 attrs/entity, 64 relationships |
| 19 | `class` | all optional | record list: `class/interface/relationship`, visibility (`public/private/protected/package`), `static` | 32 classifiers, 64 attrs/ops, 16 params/op |
| 20 | `control` | all optional (`flow` 4 values first) | record list: `block` (`name` + `tf`), `sum` (`signs: +|-`), `input/output`, `edge` | 256 declarations, 64 blocks, 32 sums/stubs, 128 edges |
| 21 | `free-body` | all optional (`scale`, dims, `bounds`) | record list: `block/circle/polygon/…` positioned shapes, forces | 256 declarations, 64 polygon vertices |
| 22 | `figure` | all optional (`id`, `number`, `caption`) | keyed sections: **required** `children` (nested `::` blocks) | — |
| 23 | `bibliography` | all optional (`id`, `number`, `caption`) | record list of `entry`: required `key/type: article\|book\|chapter\|report\|thesis\|web\|software\|standard\|other/title`, optional authors/year/venue/publisher/edition/pages/url/doi | 512 entries |
| 24 | `algorithm` | all optional (`id`, `number`, `caption`) | keyed sections: required `procedure`, optional `parameters`, required `steps` (`assign/if/for/while/…` with nesting) | 256 statements, depth 8, 32 params, 200 expr chars |
| 25 | `statement` | **required** `kind: theorem\|definition\|lemma\|corollary\|proposition\|remark` (+ optional `id`, `number`, `caption`) | keyed sections: required `text` (prose), optional `proof` | 20000 markdown chars |
| 26 | `example` | all optional (`id`, `number`, `caption`) | keyed sections: required `problem` + `steps` (each `text`), optional `givens`, `result` | 64 steps/givens, 20000 chars |

Header/body separator is always `----`. Only five directives have any
required header field (`tex`, `chart`, `circuit`, `timing`, `diagram`,
`statement`). Confidence: HIGH for the table above (machine-generated from
the pinned compiler); body-record details for the largest directives
(circuit components, geometry constructions, algorithm steps) are MEDIUM —
present in the grammar JSON but only skimmed here, so the docs author must
re-check each record list against `buildGrammarDocument()` rather than this
report.

Families for prose grouping (upstream README + `scripts/walkthrough/families.mjs`,
owner-approved catalog): Math (`equation`, `derivation`), Science
(`formula`, `reaction`, `structure`), Engineering
(`circuit`, `timing`, `control`, `free-body`), Data (`plot`, `chart`),
Geometry (`geometry`), Software (`sequence`, `state`, `entity`, `class`),
Documents (`table`, `algorithm`, `statement`, `example`, `bibliography`),
General diagrams (`diagram`); `figure` + `callout` compose content; `mermaid`
and `tex` are bounded escape hatches, not native families. HIGH.

## 3. Renderer behaviour (HIGH unless noted)

Source: capability document (`buildCapabilities`), `src/service/*.mjs`,
upstream README, compiler-integration suite.

- Operations: `analyze`, `compile`, `format` (`SUPPORTED_OPERATIONS`,
  `src/service/protocol.mjs`). `migrate` is named by the boundary but the
  pinned compiler exposes no migration operation — the service rejects it
  with a remedy and advertises `service.unavailableOperations`. `compile`
  takes `format` (required), `theme`, `assets`, `includeDocument`; `analyze`
  takes `includeDocument`; `format` returns a `formatted-source` proposal.
  HIGH.
- Formats: `html`, `svg`, `png`, `pdf`. Profiles/MIME/serializers:
  `azeforge.html.self-contained/v1` (`text/html; charset=utf-8`),
  `azeforge.svg.foreign-object/v1`, `azeforge.png.continuous/v1`
  (deviceScaleFactor 2), `azeforge.pdf.paged/v1` (≤ 200 pages). HTML needs no
  browser; svg/png/pdf require the `browser` capability. HIGH.
- Themes: `default` (light), `academic` (light), `dark-presentation`
  (dark), each version `1.0.0`. HIGH for ids/versions; visual appearance is
  UNVERIFIED (no screenshots in this repo).
- Engines (capability `engines`): `chrome-headless-shell`
  **152.0.7977.75** (diagrams + visual formats), KaTeX **0.18.5** (equations:
  readable notation parsed/validated → TeX derived deterministically →
  KaTeX HTML+MathML), Mermaid **11.17.2**, plot emitter 1.0.1
  (d3-array 3.2.4 / d3-scale 4.0.2 / d3-shape 3.2.0), geometry emitter 1.1.0,
  chemistry emitter 1.2.0. Raw LaTeX in equations is **denied by default**,
  opt-in per command (`--allow-raw-latex`). HIGH.
- `tex` Blocks: only the five profiles in §2; rendered by a
  deployment-configured, fixed-argv, digest-pinned external renderer
  (`src/service/tex-renderer.mjs`); the request boundary cannot name it and
  jobs without `tex` start no instance. Without it, `tex` fails closed with
  `azeforge.renderer#adapter-missing` — never a placeholder
  (test asserts this, `compiler-integration.test.mjs:117,155`). HIGH.
- Determinism: same Source → byte-identical Artifacts; every Artifact
  carries the content hash of its Document (upstream README claim, MEDIUM —
  not re-proven by this audit; note the service-side caveat in
  `src/service/runner.mjs`: a failed render reports `valid: true` with a
  null `contentHash` because the pinned release exposes no hash-without-render
  API).
- Self-contained output: fonts embedded, no scripts emitted, no network
  requests (README + capability `security`: compile-time network `deny`,
  `partialArtifacts: never-published`). MEDIUM.
- Fail-closed: invalid Source → completed job `ok: false` with diagnostics,
  never an HTTP failure and never a partial Artifact. Diagnostic caps
  20/block, 200/document, lowerable-only; render timeout 5000 ms default.
  HIGH.

## 4. Diagnostics (HIGH for shape; MEDIUM for catalog)

- Envelope schema `azeforge.diagnostics/v1` (`schemas/diagnostics.json`):
  each diagnostic has `code` (pattern
  `^[a-z0-9@/._-]+#[a-z0-9]+(-[a-z0-9]+)*$`, e.g.
  `azeforge.equation#unsupported-notation`), `severity`
  (`error|warning|info`), `message`, `data`, optional `location`
  (line/column/offset ranges), `suggestion`, `fix` (edits), and
  `relatedLocations`. HIGH.
- Representative codes (observed in `src/web/examples.json#diagnostics`
  sampler, `acceptance/walkthrough.aze.md` comments, service/smoke code):
  `equation#unsupported-notation`, `equation#chained-power`,
  `plot#missing-domain`, `plot#non-evaluable-construct`,
  `timing#invalid-wave`, `timing#invalid-field`,
  `table#unknown-column-key`, `table#non-numeric-value`,
  `state#multiple-initials`, `sequence#unresolved-reference`,
  `geometry#unresolved-reference`, `geometry#ambiguous-construction`,
  `free-body#scale-conflict`, `free-body#conflicting-fields`,
  `example#missing-problem`, `example#empty-step`,
  `diagram#undirected-not-permitted`, `diagram#group-endpoint`,
  `control#sum-no-inputs`, `control#sign-count-mismatch`,
  `circuit#unknown-terminal`, `circuit#unbound-terminal`,
  `entity#unknown-kind`,
  `class#multiplicity-on-ranked-relationship`,
  `algorithm#invalid-assign-target`, `algorithm#assignment-in-condition`,
  plus service-level `renderer#adapter-missing`,
  `renderer#browser-unavailable`, and job-level `job-timeout`. MEDIUM as a
  catalog — harvested from this repo's fixtures, not from a published
  compiler code list; the full per-block code set lives in the compiler, not
  in this repo.

## 5. Representative examples (HIGH)

- `src/web/examples.json`: 16 Sources vendored **verbatim** from the
  compiler's own `docs/language` library via `scripts/examples.mjs`
  (`--library <compiler docs/language>`); fields are `id`, `name`,
  `source`. The published npm tarball ships only `dist`, `schemas`, and a
  logo, so the library is vendored, not referenced. The compiler-integration
  suite compiles every example through the real service. HIGH.
- The 16: `authoring-azemark` (Authoring AzeMark — the onboarding guide;
  references `directive-reference.md`), `document-basics`, `mathematics`,
  `visualization`, `geometry`, `chemistry`, `circuit`, `timing`,
  `diagrams`, `engineering`, `models`, `structured-content`,
  `composition`, `diagnostics` (**deliberately invalid** sampler with `//
  Expected:` code+remedy comments — must be labeled non-compiling in docs),
  `tex` (renderer smoke Source covering all five profiles, "not a canonical
  Artifact"), `showcase`. HIGH.
- `acceptance/walkthrough.aze.md`: the representative ten-family-plus-
  composition document (title "AzeForge alpha walkthrough",
  `citation-style: numeric`, `x-circuit-symbol-convention: iec` metadata).
  `acceptance/golden-report.aze.md`: the smaller deployment-acceptance
  golden (prose, math, callout, table, diagram, plot, chart) compiled to
  every advertised format with hash verification. HIGH.
- `src/web/starter.js`: default first-load document lifts the smallest
  compiling snippet per guide (01–12 reading order) verbatim from the
  examples; circuit needs the `x-circuit-symbol-convention: iec` metadata.
  HIGH.
- Upstream README quick-starts (MEDIUM): hello-document
  (`validate` silence = valid → `render --output`), equation without LaTeX,
  tables+callouts, Mermaid via browser engine, determinism proof, CLI
  `render|validate|watch|serve|format|capabilities|grammar|version`.

## 6. What the docs release must describe (answer to the ticket)

1. Envelope: front matter (`azemark: 2` required), fences, `----`,
   `//` comments, kebab-case document-scoped ids, nesting depth 8.
2. The 26-directive reference with required vs optional fields, enums, body
   forms, and limits — generated from `buildGrammarDocument()`, not
   hand-copied (hand copies rot; the grammar schema is versioned).
3. Family guides reusing the 15 valid vendored examples verbatim, with the
   diagnostics sampler clearly marked invalid and the tex example marked
   deployment-dependent.
4. Renderer behaviour: four formats and profiles, three themes,
   browser-dependent rendering, KaTeX equation pipeline, raw-LaTeX denial,
   five tex profiles + adapter-missing fail-closed, determinism +
   content hash, no-partial-artifact guarantee.
5. Diagnostics: envelope shape (code/severity/ranged location/suggestion/
   fix), severity levels, per-block/per-document caps, and the sampler's
   code→remedy pairs as the voice example.
6. Operations: analyze/compile/format with options; migrate explicitly
   unavailable in 0.6.2.

## 7. Gaps requiring a later human decision

- G1. Equation readable-notation vocabulary: no operator/function list
  exists in this repo (grammar says `expression`, nothing more). Docs cannot
  teach math authoring until someone sources the vocabulary from the
  compiler repo or its `docs/language` guides.
- G2. `defaults` and `outputs` front-matter semantics: keys exist, meaning
  undocumented here.
- G3. Citation (`[@key, …]`) and endnote (`[^…]`) syntax: one example each,
  no grammar; needs compiler-side confirmation.
- G4. How much of the 26-directive reference ships day one (all vs
  curated subset) and whether docs pin field tables to 0.6.2 or track the
  grammar schema version.
- G5. tex/mermaid deployment-dependence wording for the public site (when
  to promise rendering vs diagnose).
- G6. Theme visuals: no screenshots or token lists in this repo.
- G7. Full diagnostic-code catalog: this repo has ~27 sampled codes; the
  complete list is compiler-side.
- G8. `x-circuit-symbol-convention: iec` metadata: load-bearing in
  walkthrough/starter, undocumented anywhere in this repo.
- G9. Versioning story: `azemark: 2`, document schema v3, per-plugin
  versions (equation/table v2, rest v1) — what "2" vs "v2" means to authors
  and what a future v3 costs them.

## Evidence sources

- Installed compiler 0.6.2: `node_modules/@aruzone/aze-forge/README.md`,
  `schemas/{grammar,capabilities,diagnostics,version}.json`,
  live `buildCapabilities({probe:false})`, `buildGrammarDocument()`,
  `createVersionReport()` outputs (see §1–§4 values above).
- This repo: `src/service/compiler-facts.mjs`, `protocol.mjs`,
  `runner.mjs`, `tex-renderer.mjs`, `capabilities.mjs`, `errors.mjs`;
  `test/compiler-integration.test.mjs:66–348`;
  `scripts/examples.mjs`, `scripts/walkthrough/{families,sources}.mjs`;
  `src/web/examples.json` (16 entries), `src/web/starter.js`,
  `src/web/front-matter.js`; `acceptance/walkthrough.aze.md`,
  `acceptance/golden-report.aze.md`; `CONTEXT.md`, `README.md`, `CONTEXT`
  fence rule.
- Not available here (do not cite as authoritative): the compiler's
  `docs/language/*.aze.md` guides and `directive-reference.md` — the
  examples' own words point at them, but the npm tarball does not ship
  them; docs work needs the compiler repo or a fresh `--library` checkout
  at the pinned release.
