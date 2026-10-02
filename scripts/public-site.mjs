#!/usr/bin/env node

/**
 * Build the standalone AzeForge public site.
 *
 * The generated `public/` directory has no dependency on the service or the
 * authoring application. Documentation data comes from the pinned compiler,
 * while the example corpus comes from the vendored compiler Sources.
 */

import { buildCapabilities, buildGrammarDocument } from "@aruzone/aze-forge";
import { createVersionReport } from "@aruzone/aze-forge/contracts";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(REPO, "public");
const PUBLIC_SOURCE = join(REPO, "src", "public");
const PLAYGROUND_SOURCE = join(REPO, "src", "web");
const VERSION = "0.6.3";
const DOCS_ROOT = `/docs/${VERSION}`;

/** @typedef {{ id: string, name: string, source: string }} Example */
/** @typedef {{ slug: string, title: string, directives: string[], examples: string[], summary: string, note?: string }} Family */

/** @type {Example[]} */
const examples = JSON.parse(await readFile(join(PLAYGROUND_SOURCE, "examples.json"), "utf8"));
const grammar = buildGrammarDocument();
const capabilities = await buildCapabilities({ probe: false });
const versionReport = createVersionReport();

if (grammar.tool.version !== VERSION || capabilities.tool.version !== VERSION || versionReport.tool.version !== VERSION) {
  throw new Error(`public docs are pinned to ${VERSION}, but the installed compiler reports another version`);
}
if (grammar.directives.length !== 26) {
  throw new Error(`expected the ${VERSION} grammar to expose 26 directives, received ${grammar.directives.length}`);
}

/** @type {Family[]} */
const families = [
  {
    slug: "mathematics",
    title: "Mathematics",
    directives: ["equation", "derivation"],
    examples: ["mathematics"],
    summary: "Write readable equations and annotated derivations. AzeForge validates the notation before KaTeX renders it.",
  },
  {
    slug: "science",
    title: "Science",
    directives: ["formula", "reaction", "structure"],
    examples: ["chemistry"],
    summary: "Describe chemical formulae, reactions, and molecular structures as typed declarations rather than drawing instructions.",
  },
  {
    slug: "engineering",
    title: "Engineering",
    directives: ["circuit", "timing", "control", "free-body"],
    examples: ["circuit", "timing", "engineering"],
    summary: "Author schematics, timing traces, control systems, and force diagrams with bounded records and explicit references.",
    note: "The canonical circuit Source declares x-circuit-symbol-convention: iec. This metadata is required by the example but is not part of the generated directive grammar.",
  },
  {
    slug: "data",
    title: "Data",
    directives: ["plot", "chart"],
    examples: ["visualization"],
    summary: "Render functions, authored point series, categorical bars, and histograms from validated numeric declarations.",
  },
  {
    slug: "geometry",
    title: "Geometry",
    directives: ["geometry"],
    examples: ["geometry", "showcase"],
    summary: "Declare primitives, constructions, and marks in authored order. Unresolved or ambiguous references produce diagnostics.",
  },
  {
    slug: "software",
    title: "Software",
    directives: ["sequence", "state", "entity", "class"],
    examples: ["models"],
    summary: "Model message timelines, state machines, relational entities, classes, interfaces, and their relationships.",
  },
  {
    slug: "documents",
    title: "Documents",
    directives: ["table", "algorithm", "statement", "example", "bibliography", "figure", "callout"],
    examples: ["document-basics", "structured-content", "composition"],
    summary: "Combine typed tables and algorithms with theorem-family statements, worked examples, figures, callouts, and references.",
    note: "Citation and endnote forms are demonstrated by the canonical composition Source. The 0.6.2 grammar does not publish a complete syntax for either form, so this guide does not infer one.",
  },
  {
    slug: "diagrams",
    title: "Diagrams and escape hatches",
    directives: ["diagram", "mermaid", "tex"],
    examples: ["diagrams", "tex"],
    summary: "Use the native diagram model first. Mermaid and five fixed TeX profiles cover figures outside the native families.",
    note: "Mermaid needs the pinned browser engine. TeX needs a deployment-configured renderer and fails closed when that adapter is absent.",
  },
];

const diagnosticCodes = [
  "azeforge.equation#unsupported-notation",
  "azeforge.equation#chained-power",
  "azeforge.plot#missing-domain",
  "azeforge.plot#non-evaluable-construct",
  "azeforge.timing#invalid-wave",
  "azeforge.table#unknown-column-key",
  "azeforge.state#multiple-initials",
  "azeforge.sequence#unresolved-reference",
  "azeforge.geometry#ambiguous-construction",
  "azeforge.free-body#scale-conflict",
  "azeforge.diagram#group-endpoint",
  "azeforge.control#sign-count-mismatch",
  "azeforge.circuit#unknown-terminal",
  "azeforge.algorithm#assignment-in-condition",
  "azeforge.renderer#adapter-missing",
];

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** @param {unknown} value */
function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** @param {string} id @param {string} text */
function copyCommand(id, text) {
  return `<div class="command"><code id="${id}">${escapeHtml(text)}</code><button type="button" data-copy="#${id}">Copy</button></div>`;
}

/** @param {string} code @param {string} [language] */
function codeBlock(code, language = "") {
  const className = language.length === 0 ? "" : ` class="language-${language}"`;
  return `<pre class="code-block"><code${className}>${escapeHtml(code)}</code></pre>`;
}

/** @param {"home" | "docs" | "none"} current */
function header(current) {
  return `<header class="site-header">
  <a class="brand" href="/" aria-label="AzeForge home"><img src="/assets/azeforge-mark.png" alt=""><span>Aze<span class="brand-accent">Forge</span></span></a>
  <button class="site-navigation-toggle" type="button" aria-expanded="false" aria-controls="public-navigation" data-site-navigation-toggle>Menu</button>
  <nav class="site-nav" id="public-navigation" aria-label="Public" data-site-navigation>
    <a href="${DOCS_ROOT}/"${current === "docs" ? ' aria-current="page"' : ""}>Docs</a>
    <a href="/#examples">Examples</a>
    <a href="/playground">Playground</a>
    <a class="github-link" href="https://github.com/aruzone/aze-forge"><svg class="github-mark" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg><span>GitHub</span></a>
    <a class="install-link" href="/#install-command">Install AzeForge</a>
  </nav>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <p>AzeForge ${VERSION} documentation. AzeMark language version 2.</p>
  <p class="open-source-note">We <span class="heart" aria-label="love">♥</span> open source. AzeForge is MIT licensed: <a href="https://github.com/aruzone/aze-forge">github.com/aruzone/aze-forge</a>.</p>
  <nav aria-label="Footer"><a href="${DOCS_ROOT}/ai-authoring/">AI authoring</a><a href="${DOCS_ROOT}/reference/versioning/">Version contract</a></nav>
</footer>`;
}

/**
 * @param {{ title: string, description: string, current: "home" | "docs" | "none", main: string }} input
 */
function page({ title, description, current, main }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(description)}">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/assets/azeforge-mark.png" type="image/png">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/site.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="site-shell">
${header(current)}
${main}
${footer()}
</div>
</body>
</html>
`;
}

/** @type {[string, [string, string][]][]} */
const docsSections = [
  ["Start here", [[`${DOCS_ROOT}/`, "Documentation home"], [`${DOCS_ROOT}/getting-started/`, "Install and first document"]]],
  ["Language", [[`${DOCS_ROOT}/language/`, "Foundations"], [`${DOCS_ROOT}/notation/`, "Notation codex"], [`${DOCS_ROOT}/examples/`, "Example corpus"]]],
  ["Family guides", families.map((family) => /** @type {[string, string]} */ ([`${DOCS_ROOT}/guides/${family.slug}/`, family.title]))],
  [
    "Reference",
    [
      [`${DOCS_ROOT}/reference/directives/`, "26 directives"],
      [`${DOCS_ROOT}/reference/front-matter/`, "Front matter"],
      [`${DOCS_ROOT}/reference/operations/`, "Operations"],
      [`${DOCS_ROOT}/reference/formats-themes/`, "Formats and themes"],
      [`${DOCS_ROOT}/reference/diagnostics/`, "Diagnostics"],
      [`${DOCS_ROOT}/reference/limits/`, "Limits"],
      [`${DOCS_ROOT}/reference/versioning/`, "Versioning"],
    ],
  ],
  ["AI authoring", [[`${DOCS_ROOT}/ai-authoring/`, "Agent contract"]]],
];

/** @param {string} currentPath */
function docsNavigation(currentPath) {
  return `<nav class="docs-nav" aria-label="Documentation" data-navigation>
${docsSections
  .map(
    ([label, links]) => `<p>${label}</p>
${links
  .map(([href, text]) => `<a href="${href}"${href === currentPath ? ' aria-current="page"' : ""}>${text}</a>`)
  .join("\n")}`,
  )
  .join("\n")}
</nav>`;
}

/** @param {{ title: string, description: string, path: string, content: string, toc?: [string, string][] }} input */
function docsPage({ title, description, path, content, toc = [] }) {
  const tocMarkup = toc.length === 0
    ? ""
    : `<aside class="docs-toc" aria-label="On this page"><strong>On this page</strong>${toc
        .map(([id, label]) => `<a href="#${id}">${label}</a>`)
        .join("")}</aside>`;
  return page({
    title: `${title} · AzeForge docs`,
    description,
    current: "docs",
    main: `<nav class="docs-header-row" aria-label="Documentation menu"><p>AzeForge ${VERSION}</p><button class="navigation-toggle" type="button" aria-expanded="false" data-navigation-toggle>Documentation menu</button></nav>
<main class="docs-layout" id="main-content">
${docsNavigation(path)}
<article class="docs-content">
<p class="version-label">AzeMark 2 · AzeForge ${VERSION}</p>
${content}
</article>
${tocMarkup}
</main>`,
  });
}

/** @param {string} route @param {string} content */
async function writeRoute(route, content) {
  const directory = route.length === 0 ? OUTPUT : join(OUTPUT, route);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), content);
}

/** @param {string} path @param {string} content */
async function writePublicFile(path, content) {
  const output = join(OUTPUT, path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content);
}

/** @param {string} source @param {string} destination */
async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await copyFile(from, to);
  }
}

const firstDocument = `---
azemark: 2
title: Sample variance
---

# Sample variance

Spread of a sample around its mean.

:::: equation
id: sample-variance
number: true
----
sigma^2 = frac(1, n) sum i=1..n of (x_i - mu)^2
::::`;

const home = page({
  title: "AzeForge · Compile and render AzeMark",
  description: "Install AzeForge to validate and render technical documents written in AzeMark.",
  current: "home",
  main: `<main id="main-content">
<section class="home-hero">
  <div>
    <p class="eyebrow">AzeForge compiler and renderer</p>
    <h1>Technical documents, built from plain text.</h1>
    <p class="lede">AzeForge is the compiler and renderer for AzeMark — a library for both humans and AI agents. Validate structured technical Source, then render HTML, SVG, PNG, or PDF.</p>
    <div class="action-row"><a class="button primary" href="#install-command">Install AzeForge</a><a class="button" href="${DOCS_ROOT}/">Read the docs</a></div>
    ${copyCommand("install-command", "npm install @aruzone/aze-forge")}
  </div>
  <aside class="hero-side" aria-label="AzeForge summary">
    <p class="eyebrow">Built for structured work</p>
    <p>AzeMark adds typed directives for equations, data, diagrams, engineering notation, and document composition while keeping prose in Markdown.</p>
  </aside>
</section>
<section class="proof-section" id="capabilities">
  <p class="proof-index">01 / Capabilities</p>
  <div><h2>Compiler contracts instead of plugin guesswork.</h2><p class="proof-copy">The ${grammar.directives.length}-directive grammar comes from the same registered definitions the compiler validates.</p>
  <ul class="capability-list">
    <li><strong>Readable Source</strong>Markdown prose and typed AzeMark directives stay in one <code>.aze.md</code> file.</li>
    <li><strong>Corrective diagnostics</strong>Errors carry codes, severity, locations, suggestions, and optional edits.</li>
    <li><strong>Deterministic output</strong>The same valid Source and render options produce byte-identical Artifacts.</li>
    <li><strong>Fail-closed rendering</strong>Invalid Source publishes no partial Artifact and does not replace a previous output.</li>
  </ul></div>
</section>
<section class="proof-section" id="use-cases">
  <p class="proof-index">02 / Use cases</p>
  <div><h2>Native structures for technical work.</h2><p class="proof-copy">Use one Source format across quantitative notes, engineering records, software models, and publication-ready documents.</p>
  <ul class="use-case-list">
    ${families.map((family) => `<li><strong>${family.title}</strong>${family.directives.map((directive) => `<code>${directive}</code>`).join(" ")}</li>`).join("\n")}
  </ul></div>
</section>
<section class="proof-section" id="examples">
  <p class="proof-index">03 / AzeMark Source</p>
  <div><h2>A complete document stays readable before it renders.</h2><p class="proof-copy">Front matter pins AzeMark language version 2. Directive fences use exactly four colons and a <code>----</code> header separator.</p>
  <figure class="source-figure"><figcaption><span>variance.aze.md</span><span>Complete Source</span></figcaption>${codeBlock(firstDocument, "azemark")}</figure>
  <figure class="source-figure"><figcaption><span>variance.aze.md · rendered Document preview</span><span>Document preview</span></figcaption><div class="rendered-sample" role="img" aria-label="Rendered sample variance equation: sigma squared equals one over n times the sum from i equals 1 to n of x sub i minus mu, squared"><p class="rendered-sample-title">Sample variance</p><p class="rendered-sample-prose">Spread of a sample around its mean.</p><p class="rendered-sample-equation"><span class="rendered-sample-math" aria-hidden="true">σ<sup>2</sup> = <span class="frac"><span>1</span><span>n</span></span> ∑<sub>i = 1</sub><sup>n</sup> (x<sub>i</sub> − μ)<sup>2</sup></span><span class="rendered-sample-number">(1)</span></p></div></figure>
  <a class="button" href="${DOCS_ROOT}/examples/">Browse the verified examples</a></div>
</section>
<section class="proof-section" id="compare">
  <p class="proof-index">04 / Compare</p>
  <div><h2>What Changes When the Document Is a Contract.</h2><p class="proof-copy">Other tools render pages. AzeForge validates meaning first: every Block is typed, every field is checked, and the grammar is published as JSON so humans and agents author against the same contract.</p>
  <div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>Capability</th><th>AzeForge</th><th>Typst</th><th>Quarto</th><th>LaTeX</th></tr></thead><tbody>
<tr><td><strong>Authoring Model</strong><span>What you write to get a document</span></td><td><strong>Typed AzeMark Source</strong><span>Markdown plus validated directive Blocks</span></td><td><strong>Scripted Markup</strong><span>Code-like syntax with packages</span></td><td><strong>Markdown Plus Extensions</strong><span>Prose with bolted-on filters</span></td><td><strong>Typesetting Program</strong><span>Explicit layout commands</span></td></tr>
<tr><td><strong>Technical Diagrams</strong><span>Circuits, timing, geometry, control</span></td><td><strong>Native Typed Blocks</strong><span>Declared topology, rendered wires</span></td><td>Community Packages</td><td>External Extensions</td><td>Specialist Packages</td></tr>
<tr><td><strong>Correctness Feedback</strong><span>What happens when Source is wrong</span></td><td><strong>Compiler Diagnostics</strong><span>Coded errors with locations and fixes</span></td><td>Compiler Errors</td><td>Build Logs</td><td>Log Diving</td></tr>
<tr><td><strong>Machine-Readable Contract</strong><span>Can an agent verify before rendering</span></td><td><strong>Published JSON Grammar</strong><span>26 directives, fields, enums, limits</span></td><td>—</td><td>—</td><td>—</td></tr>
<tr><td><strong>Programmatic Access</strong><span>Use from code and agents</span></td><td><strong>Compiler npm API</strong><span>Analyze, compile, format</span></td><td>Different Ecosystem</td><td>—</td><td>—</td></tr>
<tr><td><strong>Output Guarantee</strong><span>What a successful render promises</span></td><td><strong>Self-Contained Artifacts</strong><span>HTML, SVG, PNG, PDF with content hash</span></td><td>Varies by Output</td><td>Varies by Output</td><td>Usually PDF</td></tr>
  </tbody></table></div>
  <p class="proof-copy">Mathematics and Mermaid rendering are table stakes — every column handles them. The rows above are where the authoring experience actually diverges.</p></div>
</section>
<section class="home-continue">
  <p class="eyebrow">Docs and Playground</p>
  <h2>Read the contract or try the hosted authoring flow.</h2>
  <div class="cta-row"><a href="${DOCS_ROOT}/"><strong>Documentation</strong><span>Pinned ${VERSION} guides, generated reference data, and AI-authoring rules.</span></a><a href="/playground"><strong>Playground</strong><span>Use an access token to author and render the Current document in the browser.</span></a></div>
</section>
</main>`,
});

const docsOverviewContent = `<h1>Write valid AzeMark Source.</h1>
<p class="lede">This documentation is pinned to AzeForge ${VERSION}, AzeMark language version 2, document schema version 3, and grammar schema <code>azeforge.grammar/v1</code>.</p>
<div class="callout"><strong>Versioned by design.</strong> Future compiler releases receive separate documentation. This reference does not silently track the latest package.</div>
<h2 id="start">Start here</h2>
<ul class="link-list"><li><a href="${DOCS_ROOT}/getting-started/"><strong>Install and render a first document</strong><span>Install the CLI, validate Source, render HTML, and run the formatter.</span></a></li><li><a href="${DOCS_ROOT}/language/"><strong>Language foundations</strong><span>Front matter, fences, identifiers, composition, and rendering rules.</span></a></li><li><a href="${DOCS_ROOT}/notation/"><strong>Notation codex</strong><span>Symbols, subscripts, superscripts, directive bodies, geometry, and circuit declarations.</span></a></li></ul>
<h2 id="guides">Family guides</h2>
<ul class="link-list">${families.map((family) => `<li><a href="${DOCS_ROOT}/guides/${family.slug}/"><strong>${family.title}</strong><span>${family.directives.join(", ")}</span></a></li>`).join("")}</ul>
<h2 id="reference">Reference and agent data</h2>
<p>The directive reference and JSON artifacts are generated from the installed compiler. The prose pages state only behavior verified for ${VERSION}.</p>
<ul class="link-list"><li><a href="${DOCS_ROOT}/reference/directives/"><strong>All ${grammar.directives.length} directives</strong><span>Header fields, body schema, enum values, and limits.</span></a></li><li><a href="${DOCS_ROOT}/ai-authoring/"><strong>AI-authoring contract</strong><span>Hard rules plus grammar, capabilities, and version documents.</span></a></li></ul>`;

const gettingStartedContent = `<h1>Install and render.</h1>
<p class="lede">Install the pinned CLI globally, save one complete AzeMark Source, validate it, and render HTML.</p>
<h2 id="install">Install AzeForge</h2>
<p>AzeForge ${VERSION} supports Node.js 22 or 24 on Ubuntu and macOS.</p>
${copyCommand("docs-install-command", "npm install -g @aruzone/aze-forge")}
<h2 id="source">Create a Source</h2>
<p>Save this file as <code>hello.aze.md</code>. The <code>azemark: 2</code> field pins the source language.</p>
${codeBlock(firstDocument, "azemark")}
<h2 id="validate">Validate and render</h2>
${copyCommand("docs-validate-command", "azeforge validate hello.aze.md && azeforge render hello.aze.md --output hello.html")}
<p>Validation exits nonzero when diagnostics contain errors. Rendering publishes no partial output when validation or rendering fails.</p>
<h2 id="format">Format deterministically</h2>
${copyCommand("docs-format-command", "azeforge format hello.aze.md --write")}
<p>Use <code>--check</code> in automation. It exits 1 when Source needs formatting and does not rewrite the file.</p>
<h2 id="next">Next steps</h2>
<ul><li>Read the <a href="${DOCS_ROOT}/language/">language foundations</a>.</li><li>Choose a <a href="${DOCS_ROOT}/#guides">family guide</a>.</li><li>Inspect the <a href="${DOCS_ROOT}/reference/directives/">generated directive reference</a>.</li></ul>`;

const languageContent = `<h1>Language foundations.</h1>
<p class="lede">AzeMark combines YAML front matter, Markdown prose, and typed directives in one <code>.aze.md</code> Source.</p>
<h2 id="front-matter">Front matter</h2>
<p>Open the document with YAML between <code>---</code> delimiters. Every ${VERSION} guide and agent-authored Source declares the integer <code>azemark: 2</code>. Verified optional keys include <code>title</code>, <code>author</code>, <code>theme</code>, <code>outputs</code>, <code>defaults</code>, and <code>citation-style</code>.</p>
<div class="warning"><strong>Do not infer semantics.</strong> The ${VERSION} compiler exposes the <code>defaults</code> and <code>outputs</code> keys but does not publish their full behavior in the grammar.</div>
<h2 id="fences">Directive fences</h2>
<p>An outer directive uses exactly four colons. Five colons are invalid and must not be normalized. Put header fields before <code>----</code> and body data after it. A <code>figure</code> uses nested <code>::</code> child blocks.</p>
${codeBlock(":::: callout\nvariant: note\ntitle: Check the Source\n----\nValidate before rendering.\n::::", "azemark")}
<h2 id="identifiers">Identifiers and nesting</h2>
<p>Directive identifiers have document scope and match <code>^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$</code>. Maximum directive nesting depth is 8. A line beginning with <code>//</code> is a comment.</p>
<h2 id="composition">Composition</h2>
<p>The canonical composition Source demonstrates <code>@id</code> cross-references, citations, endnotes, numbered figures, nested equations, and bibliography entries.</p>
<div class="warning"><strong>Bounded claim.</strong> ${VERSION} has one verified citation example and one verified endnote example, but the generated grammar does not define their complete syntax. Reuse the canonical Source forms; do not invent variants.</div>
<h2 id="rendering">Rendering</h2>
<p>AzeForge parses and validates the complete Source before rendering. HTML does not need a browser engine. SVG, PNG, PDF, Mermaid, and native visual directives need the pinned browser capability. TeX also needs the configured external adapter.</p>`;

/** @param {Family} family */
function familyContent(family) {
  const sources = family.examples.map((id) => {
    const example = examples.find((entry) => entry.id === id);
    if (example === undefined) throw new Error(`family ${family.slug} names missing example ${id}`);
    return `<li><a href="${DOCS_ROOT}/examples/${example.id}.aze.md"><strong>${escapeHtml(example.name)}</strong><span>Download the complete canonical Source.</span></a></li>`;
  });
  return `<h1>${family.title}.</h1>
<p class="lede">${family.summary}</p>
<h2 id="directives">Directives</h2>
<div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>Directive</th><th>Generated reference</th></tr></thead><tbody>${family.directives.map((directive) => `<tr><td><code>${directive}</code></td><td><a href="${DOCS_ROOT}/reference/directives/#${directive}">Fields, body schema, and limits</a></td></tr>`).join("")}</tbody></table></div>
<h2 id="sources">Canonical Sources</h2>
<p>These files come from the compiler's verified example library. Keep the document envelope and directive spellings intact when adapting them.</p>
<ul class="link-list">${sources.join("")}</ul>
${family.note === undefined ? "" : `<div class="warning"><strong>Known boundary.</strong> ${family.note}</div>`}
<h2 id="workflow">Authoring workflow</h2>
<ol><li>Start from the smallest relevant block in the canonical Source.</li><li>Give referenced declarations stable kebab-case identifiers.</li><li>Run <code>azeforge validate</code> before rendering.</li><li>Apply diagnostic suggestions to the reported location rather than guessing at a replacement field.</li></ol>`;
}

/** @param {unknown} field */
function fieldValues(field) {
  if (typeof field !== "object" || field === null || !("values" in field) || !Array.isArray(field.values)) return "";
  return field.values.map((value) => String(value)).join(", ");
}

/** @param {typeof grammar.directives[number]} directive */
function directiveReference(directive) {
  const rows = directive.header.fields
    .map((field) => `<tr><td><code>${field.key}</code></td><td>${field.valueType}</td><td>${field.required ? "required" : "optional"}</td><td>${escapeHtml(fieldValues(field))}</td></tr>`)
    .join("");
  return `<section class="directive-reference" id="${directive.type}">
<h2><code>${directive.type}</code></h2>
<p class="directive-meta">${escapeHtml(directive.title)} · plugin ${directive.pluginVersion} · body ${directive.body.form}</p>
<h3>Header fields</h3>
<div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>Field</th><th>Type</th><th>Presence</th><th>Values</th></tr></thead><tbody>${rows}</tbody></table></div>
<h3>Limits</h3>
${Object.keys(directive.limits).length === 0 ? "<p>No directive-specific limits are published.</p>" : codeBlock(json(directive.limits), "json")}
<details><summary>Complete generated body contract</summary>${codeBlock(json(directive.body), "json")}</details>
</section>`;
}

const directivesContent = `<h1>Directive reference.</h1>
<p class="lede">All ${grammar.directives.length} registered directives below come from <code>buildGrammarDocument()</code> in AzeForge ${VERSION}. The generated body contracts include nested records, required fields, enums, and ceilings.</p>
<div class="callout"><strong>Normative data.</strong> Download <a href="${DOCS_ROOT}/ai/grammar.json">grammar.json</a> for machine use. This page renders the same document.</div>
<h2 id="index">Directive index</h2>
<p>${grammar.directives.map((directive) => `<a href="#${directive.type}"><code>${directive.type}</code></a>`).join(" · ")}</p>
${grammar.directives.map(directiveReference).join("\n")}`;

const frontMatterContent = `<h1>Front matter.</h1>
<p class="lede">A ${VERSION} Source declares AzeMark language version 2 in YAML front matter.</p>
<div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>Key</th><th>Type</th><th>Verified values or rule</th></tr></thead><tbody>
<tr><td><code>azemark</code></td><td>integer</td><td><code>2</code></td></tr>
<tr><td><code>title</code></td><td>text</td><td>Document title</td></tr>
<tr><td><code>author</code></td><td>string list</td><td>One or more author names</td></tr>
<tr><td><code>theme</code></td><td>text</td><td><code>default</code>, <code>academic</code>, <code>dark-presentation</code></td></tr>
<tr><td><code>outputs</code></td><td>string list</td><td><code>html</code>, <code>svg</code>, <code>png</code>, <code>pdf</code>; full semantics undocumented</td></tr>
<tr><td><code>defaults</code></td><td>record</td><td>Accepted shape; semantics undocumented</td></tr>
<tr><td><code>citation-style</code></td><td>enum</td><td><code>numeric</code> or <code>author-year</code></td></tr>
</tbody></table></div>
<h2 id="example">Complete envelope</h2>${codeBlock(firstDocument, "azemark")}
<h2 id="boundaries">Boundaries</h2><p>Do not document custom metadata as a general language feature. The canonical circuit Source uses <code>x-circuit-symbol-convention: iec</code>, but ${VERSION} does not publish that key in the front-matter grammar.</p>`;

const operationsContent = `<h1>Operations.</h1>
<p class="lede">AzeForge ${VERSION} supports analyze, compile, and format operations. The hosted service exposes those operations through its authenticated <code>/v1</code> API.</p>
<div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>Operation</th><th>Result</th><th>Key options</th></tr></thead><tbody>
<tr><td><code>analyze</code></td><td>Document diagnostics and optional Document data</td><td><code>includeDocument</code></td></tr>
<tr><td><code>compile</code></td><td>Requested Artifact after successful validation</td><td><code>format</code>, <code>theme</code>, <code>assets</code>, <code>includeDocument</code></td></tr>
<tr><td><code>format</code></td><td>A deterministic formatted-Source proposal</td><td>CLI <code>--write</code>, <code>--check</code>, or <code>--stdin</code></td></tr>
<tr><td><code>migrate</code></td><td>Unavailable in ${VERSION}</td><td>The service rejects it rather than translating Source</td></tr>
</tbody></table></div>
<h2 id="cli">CLI commands</h2>${copyCommand("operation-validate", "azeforge validate document.aze.md --diagnostics json")}${copyCommand("operation-render", "azeforge render document.aze.md --output document.pdf")}${copyCommand("operation-format", "azeforge format document.aze.md --check")}`;

const formatsThemesContent = `<h1>Formats and themes.</h1>
<p class="lede">The pinned capability document advertises four output formats and three themes.</p>
<h2 id="formats">Formats</h2>
<div class="version-grid">${capabilities.formats.map((format) => `<div><strong>${format.toUpperCase()}</strong><span>${format === "html" ? "Self-contained HTML; no browser engine required" : "Rendered through the pinned browser capability"}</span></div>`).join("")}</div>
<p>PDF output is capped at 200 pages. PNG uses device scale factor 2. Successful Artifacts include the content hash of their Document.</p>
<h2 id="themes">Themes</h2>
<div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>ID</th><th>Version</th><th>Colour scheme</th></tr></thead><tbody>${capabilities.themes.map((theme) => `<tr><td><code>${theme.id}</code></td><td>${theme.version}</td><td>${theme.colorScheme}</td></tr>`).join("")}</tbody></table></div>
<div class="warning"><strong>No visual promise.</strong> ${VERSION} publishes theme IDs and versions, not reference screenshots or a public token contract.</div>
<h2 id="engines">Pinned engines</h2><p>The ${VERSION} capability document pins Chrome Headless Shell 152.0.7977.75, KaTeX 0.18.5, and Mermaid 11.17.2. Read <a href="${DOCS_ROOT}/ai/capabilities.json">capabilities.json</a> for the full engine registry.</p>`;

const diagnosticsContent = `<h1>Diagnostics.</h1>
<p class="lede">Diagnostics are the compiler's authoritative correction path. Preserve their code, severity, location, suggestion, fix, and related locations.</p>
<h2 id="shape">Envelope</h2>
<p>Each diagnostic has a machine code, <code>error</code>, <code>warning</code>, or <code>info</code> severity, a message, and data. It may add source ranges, a suggestion, edit operations, and related ranges.</p>
${codeBlock(`{
  "code": "azeforge.plot#missing-domain",
  "severity": "error",
  "message": "...",
  "location": { "start": { "line": 8, "column": 1 } },
  "suggestion": "..."
}`, "json")}
<h2 id="limits">Caps and failure behavior</h2><p>The compiler caps diagnostics at 20 per block and 200 per document; deployments may only lower those limits. Invalid Source produces no partial Artifact.</p>
<h2 id="codes">Representative codes</h2><p>This is a verified sample, not a complete catalog.</p><p>${diagnosticCodes.map((code) => `<code>${code}</code>`).join(" ")}</p>
<h2 id="sampler">Invalid sampler</h2><p>The diagnostic sampler is intentionally non-compiling. Its comments pair defects with expected code-to-remedy examples.</p><a class="button" href="${DOCS_ROOT}/examples/diagnostics.aze.md">Download the invalid sampler</a>`;

const limitsContent = `<h1>Limits.</h1>
<p class="lede">The compiler publishes document-wide and directive-specific ceilings in the generated grammar and capability documents.</p>
<h2 id="document">Document limits</h2>${codeBlock(json(grammar.limits), "json")}
<h2 id="directives">Directive limits</h2><p>Each directive's reference section prints its registered limits next to the complete generated body contract.</p><ul class="link-list">${grammar.directives.map((directive) => `<li><a href="${DOCS_ROOT}/reference/directives/#${directive.type}"><strong><code>${directive.type}</code></strong><span>${Object.keys(directive.limits).length} published limit${Object.keys(directive.limits).length === 1 ? "" : "s"}</span></a></li>`).join("")}</ul>`;

const versioningContent = `<h1>Version contract.</h1>
<p class="lede">These docs never use “latest” as a compatibility promise. Every artifact names the compiler, source language, document schema, and grammar schema.</p>
<div class="version-grid"><div><strong>AzeForge</strong><span>${VERSION}</span></div><div><strong>AzeMark</strong><span>language version 2</span></div><div><strong>Document data</strong><span>schema version 3</span></div><div><strong>Grammar</strong><span>azeforge.grammar/v1</span></div></div>
<h2 id="plugins">Plugin versions</h2><p>Equation and table use plugin source/data version 2. Every other ${VERSION} directive publishes plugin version 1. Plugin version numbers are not AzeMark language versions.</p>
<h2 id="future">Future releases</h2><p>A future compiler release receives a separate documentation tree. ${VERSION} does not publish migration rules for a future AzeMark version, and its <code>migrate</code> operation is unavailable.</p>
<h2 id="machine">Machine report</h2><p>Read the exact generated <a href="${DOCS_ROOT}/ai/version.json">version report</a>.</p>`;

const examplesContent = `<h1>Verified example corpus.</h1>
<p class="lede">The compiler's example library is vendored verbatim. Fifteen Sources are valid under ${VERSION}. The diagnostic sampler is deliberately invalid.</p>
<ul class="link-list">${examples.map((example) => {
  const detail = example.id === "diagnostics"
    ? "Intentionally invalid. Use it only to study diagnostic codes and remedies."
    : example.id === "tex"
      ? "Valid Source. Rendering depends on the deployment's TeX adapter."
      : "Canonical executable Source for AzeForge ${VERSION}.";
  return `<li><a href="${DOCS_ROOT}/examples/${example.id}.aze.md"><strong>${escapeHtml(example.name)}</strong><span>${detail}</span></a></li>`;
}).join("")}</ul>`;

const symbolRows = [
  ["α", "<code>alpha</code>", "Lower Greek", "<code>alpha</code>", "Significance level"],
  ["β", "<code>beta</code>", "Lower Greek", "<code>beta</code>", "Regression coefficient"],
  ["γ", "<code>gamma</code>", "Lower Greek", "<code>gamma</code>", "Decay constant"],
  ["δ", "<code>delta</code>", "Lower Greek", "<code>delta</code>", "Small change"],
  ["ε", "<code>epsilon</code>", "Lower Greek", "<code>forall e in R of body</code>", "Arbitrary tolerance"],
  ["ζ", "<code>zeta</code>", "Lower Greek", "<code>zeta</code>", "Damping ratio"],
  ["η", "<code>eta</code>", "Lower Greek", "<code>eta</code>", "Efficiency"],
  ["θ", "<code>theta</code>", "Lower Greek", "<code>cos theta</code>", "Rotation angle"],
  ["κ", "<code>kappa</code>", "Lower Greek", "<code>kappa</code>", "Curvature"],
  ["λ", "<code>lambda</code>", "Lower Greek", "<code>lambda</code>", "Wavelength"],
  ["μ", "<code>mu</code>", "Lower Greek", "<code>(x_i - mu)^2</code>", "Population mean"],
  ["ν", "<code>nu</code>", "Lower Greek", "<code>G_(mu, nu)</code>", "Tensor index"],
  ["ξ", "<code>xi</code>", "Lower Greek", "<code>xi</code>", "Random variable"],
  ["ο", "<code>omicron</code>", "Lower Greek", "<code>omicron</code>", "Small omicron"],
  ["π", "<code>pi</code>", "Lower Greek", "<code>pi</code>", "Circle constant"],
  ["ρ", "<code>rho</code>", "Lower Greek", "<code>rho</code>", "Density"],
  ["σ", "<code>sigma</code>", "Lower Greek", "<code>sigma^2</code>", "Standard deviation"],
  ["τ", "<code>tau</code>", "Lower Greek", "<code>tau</code>", "Time constant"],
  ["υ", "<code>upsilon</code>", "Lower Greek", "<code>upsilon</code>", "Frequency ratio"],
  ["φ", "<code>phi</code>", "Lower Greek", "<code>phi</code>", "Phase angle"],
  ["χ", "<code>chi</code>", "Lower Greek", "<code>chi</code>", "Susceptibility"],
  ["ψ", "<code>psi</code>", "Lower Greek", "<code>psi</code>", "Stream function"],
  ["ω", "<code>omega</code>", "Lower Greek", "<code>omega</code>", "Angular frequency"],
  ["Α", "<code>Alpha</code>", "Upper Greek", "<code>Alpha</code>", "Uppercase alpha"],
  ["Β", "<code>Beta</code>", "Upper Greek", "<code>Beta</code>", "Uppercase beta"],
  ["Γ", "<code>Gamma</code>", "Upper Greek", "<code>Gamma</code>", "Uppercase gamma"],
  ["Δ", "<code>Delta</code>", "Upper Greek", "<code>Delta</code>", "Finite difference"],
  ["Ε", "<code>Epsilon</code>", "Upper Greek", "<code>Epsilon</code>", "Uppercase epsilon"],
  ["Ζ", "<code>Zeta</code>", "Upper Greek", "<code>Zeta</code>", "Uppercase zeta"],
  ["Η", "<code>Eta</code>", "Upper Greek", "<code>Eta</code>", "Uppercase eta"],
  ["Θ", "<code>Theta</code>", "Upper Greek", "<code>Theta</code>", "Uppercase theta"],
  ["Ι", "<code>Iota</code>", "Upper Greek", "<code>Iota</code>", "Uppercase iota"],
  ["Κ", "<code>Kappa</code>", "Upper Greek", "<code>Kappa</code>", "Uppercase kappa"],
  ["Λ", "<code>Lambda</code>", "Upper Greek", "<code>Lambda</code>", "Uppercase lambda"],
  ["Μ", "<code>Mu</code>", "Upper Greek", "<code>Mu</code>", "Uppercase mu"],
  ["Ν", "<code>Nu</code>", "Upper Greek", "<code>Nu</code>", "Uppercase nu"],
  ["Ξ", "<code>Xi</code>", "Upper Greek", "<code>Xi</code>", "Uppercase xi"],
  ["Ο", "<code>Omicron</code>", "Upper Greek", "<code>Omicron</code>", "Uppercase omicron"],
  ["Π", "<code>Pi</code>", "Upper Greek", "<code>Pi</code>", "Uppercase pi"],
  ["Ρ", "<code>Rho</code>", "Upper Greek", "<code>Rho</code>", "Uppercase rho"],
  ["Σ", "<code>Sigma</code>", "Upper Greek", "<code>sum i=1..n of i^2</code>", "Summation operator"],
  ["Τ", "<code>Tau</code>", "Upper Greek", "<code>Tau</code>", "Uppercase tau"],
  ["Υ", "<code>Upsilon</code>", "Upper Greek", "<code>Upsilon</code>", "Uppercase upsilon"],
  ["Φ", "<code>Phi</code>", "Upper Greek", "<code>Phi</code>", "Uppercase phi"],
  ["Χ", "<code>Chi</code>", "Upper Greek", "<code>Chi</code>", "Uppercase chi"],
  ["Ψ", "<code>Psi</code>", "Upper Greek", "<code>Psi(x, t)</code>", "Wave function"],
  ["Ω", "<code>Omega</code>", "Upper Greek", "<code>Omega</code>", "Ohms and solid angle"],
  ["ℏ", "<code>hbar</code>", "Physics name", "<code>i hbar frac(partial, partial t) Psi(x, t)</code>", "Reduced Planck constant"],
  ["∂", "<code>partial</code>", "Physics name", "<code>frac(partial, partial t)</code>", "Partial derivative"],
  ["∇", "<code>nabla</code>", "Physics name", "<code>nabla^2</code>", "Laplacian operator"],
  ["∞", "<code>infinity</code>", "Physics name", "<code>integral x=0..infinity of exp(-x^2) dx</code>", "Unbounded limit"],
  ["∅", "<code>emptyset</code>", "Physics name", "<code>emptyset</code>", "Empty set"],
];

const transformRows = [
  ["Subscript", "<code>x_i</code>", "One base, one index", "Indexed variable"],
  ["Superscript", "<code>x^2</code>", "One base, one power", "Square and exponent"],
  ["Combined power", "<code>(x')^2</code>", "Parenthesize before combining", "Primed base raised to a power"],
  ["Prime marks", "<code>x'</code> or <code>x''</code>", "Up to two primes per base", "Derived forms"],
  ["Multi-index", "<code>G_(mu, nu)</code>", "One subscript group", "Tensor indices"],
  ["Fraction", "<code>frac(1, n)</code>", "Numerator, denominator", "Rational expression"],
  ["Root", "<code>sqrt(x)</code>", "Radicand", "Square root"],
  ["Nth root", "<code>root(n, x)</code>", "Index, radicand", "Cube and higher roots"],
  ["Absolute", "<code>abs(x)</code>", "Single argument", "Absolute value"],
  ["Bounded sum", "<code>sum i=1..n of i^2</code>", "Bound <code>i=1..n</code>, then <code>of</code>, then body", "Finite series with Σ"],
  ["Bounded product", "<code>product k=1..m of k</code>", "Bound <code>k=1..m</code>, then <code>of</code>, then body", "Finite product with Π"],
  ["Integral", "<code>integral x=0..L of f(x) dx</code>", "Bound <code>x=0..L</code>, then <code>of</code>, then body; differential matches the bound name", "Definite integral with ∫"],
  ["Unbounded integral", "<code>integral x=0..infinity of exp(-x^2) dx</code>", "<code>infinity</code> as the upper bound", "Improper integral"],
  ["Limit", "<code>limit n-&gt;infinity of V_0</code>", "Variable, arrow, target, then <code>of</code>", "Approach a value"],
  ["Universal quantifier", "<code>forall e in R of body</code>", "Name, set, then <code>of</code>", "For every element, with ∀"],
  ["Existential quantifier", "<code>exists M in R of body</code>", "Name, set, then <code>of</code>", "There exists, with ∃"],
  ["Membership", "<code>x in R</code>", "Element, then set", "Set membership with ∈"],
  ["Non-membership", "<code>x notin S</code>", "Element, then set", "Exclusion with ∉"],
  ["Subset", "<code>A subset B</code>", "Two sets", "Strict inclusion with ⊂"],
  ["Subset or equal", "<code>A subseteq B</code>", "Two sets", "Inclusion with ⊆"],
  ["Superset", "<code>A supset B</code>", "Two sets", "Strict containment with ⊃"],
  ["Union", "<code>A union B</code>", "Two sets", "Combined sets with ∪"],
  ["Intersection", "<code>A intersect B</code>", "Two sets", "Shared elements with ∩"],
  ["Equivalence", "<code>A equiv B</code>", "Two expressions", "Logical equivalence with ≡"],
  ["Vector", "<code>vector [x, y]</code>", "Bracket list; one item is an arrow vector", "Bold tuple or arrow vector"],
  ["Matrix", "<code>matrix [[a, b], [c, d]]</code>", "Rows are bracket groups", "Plain matrix"],
  ["Parenthesized matrix", "<code>pmatrix [[cos theta, -sin theta], [sin theta, cos theta]]</code>", "Rows are bracket groups", "Rotation matrix"],
  ["Determinant matrix", "<code>vmatrix [[a, b], [c, d]]</code>", "Rows are bracket groups", "Determinant bars"],
  ["Cases", "<code>cases(w_k x^k when k &lt; m; 0 otherwise)</code>", "Branches separated by <code>;</code>, conditions with <code>when</code>", "Piecewise definition"],
  ["Sine", "<code>sin theta</code>", "Angle argument", "Trigonometric function"],
  ["Cosine", "<code>cos theta</code>", "Angle argument", "Trigonometric function"],
  ["Exponential", "<code>exp(-x^2)</code>", "Exponent argument", "Natural exponential"],
];

const artifactRows = [
  ["equation", "Scalar <code>expression</code> line", "<code>V = I * R</code>", "One readable expression"],
  ["derivation", "Ordered <code>- expression:</code> steps", "<code>- expression: A_n = P_0 (1 + r)^n</code>", "Aligned chain with prose notes"],
  ["formula", "One expression line", "<code>H2O</code>", "Digits resolve to subscripts and charge"],
  ["reaction", "One reaction equation", "<code>Ag+(aq) + Cl-(aq) -&gt; AgCl(s)</code>", "Arrow with conditions and balance check"],
  ["structure", "Record list of atoms and bonds", "<code>- kind: atom</code>", "Molecular declaration"],
  ["plot", "Record list of series", "<code>- kind: function</code>", "Function, line, and point series"],
  ["chart", "Record list of bars or histogram", "<code>- kind: bars</code>", "Categorical bars or binned values"],
  ["geometry", "Ordered <code>- kind:</code> declarations", "<code>- kind: point</code>", "Coordinates, constructions, marks"],
  ["circuit", "Ordered component declarations", "<code>- kind: resistor</code>", "Named nodes with bound terminals"],
  ["timing", "Ordered signal declarations", "<code>- kind: signal</code>", "Wave run strings on a shared scale"],
  ["control", "Ordered block declarations", "<code>- kind: block</code>", "Signal-flow blocks, sums, and edges"],
  ["free-body", "Ordered body declarations", "<code>- kind: force</code>", "Bodies with anchored vectors"],
  ["sequence", "Participants plus timeline", "<code>participants:</code>", "Message timelines"],
  ["state", "Record list of states", "<code>- kind: transition</code>", "State machines"],
  ["entity", "Record list of entities", "<code>- kind: entity</code>", "Entities and relationships"],
  ["class", "Record list of classifiers", "<code>- kind: class</code>", "Classes and interfaces"],
  ["diagram", "Record list of nodes and edges", "<code>- kind: node</code>", "Flowchart, graph, tree, architecture"],
  ["table", "Keyed columns and rows", "<code>columns:</code>", "Typed tables with groups"],
  ["algorithm", "Procedure with steps", "<code>procedure:</code>", "Nested statements"],
  ["statement", "Kind plus text and proof", "<code>kind: theorem</code>", "Theorem-family blocks"],
  ["example", "Problem plus steps", "<code>problem:</code>", "Worked examples"],
  ["figure", "Required nested children", "<code>:: equation</code>", "Numbered wrapper"],
  ["bibliography", "Record list of entries", "<code>- kind: entry</code>", "Keyed references"],
  ["callout", "Keyed Markdown sections", "<code>variant: note</code>", "Admonition block"],
  ["mermaid", "Scalar source lines", "<code>source</code>", "Diagram escape hatch"],
  ["tex", "Scalar figure body", "<code>profile: tikz</code>", "Deployment-dependent profile"],
];

const geometryRows = [
  ["<code>point</code>", "Authored <code>x</code>/<code>y</code>", "Vertices and labels"],
  ["<code>segment</code>", "<code>from</code> and <code>to</code>", "Arms and edges"],
  ["<code>line</code>", "Two references", "Construction line"],
  ["<code>ray</code>", "Origin plus direction", "Beams and half-lines"],
  ["<code>circle</code>", "Center plus radius or beacon", "Sweep circles"],
  ["<code>arc</code>", "Center, radius, sweep", "Directed arcs"],
  ["<code>polygon</code>", "Ordered <code>vertices</code>", "Closed figures"],
  ["<code>midpoint</code>", "Two references", "Bisection point"],
  ["<code>intersection</code>", "Two references", "Crossing point"],
  ["<code>tangent-line</code>", "Point plus circle", "Derived tangent"],
  ["<code>perpendicular-line</code>", "Point plus line", "Derived perpendicular"],
  ["<code>perpendicular-foot</code>", "Point plus line", "Foot of perpendicular"],
  ["<code>angle-mark</code>", "Three references", "Annotated angle"],
  ["<code>right-angle-mark</code>", "Two references", "Right-angle mark"],
  ["<code>length-mark</code>", "One reference", "Measured segment"],
  ["<code>equal-marks</code>", "Segment list", "Congruence marks"],
];

const circuitRows = [
  ["<code>node</code>", "<code>ref</code>, optional <code>role: reference</code>", "Named net; reference marks ground"],
  ["<code>resistor</code>", "<code>ref</code>, <code>value</code>", "Two-terminal passive element"],
  ["<code>capacitor</code>", "<code>ref</code>, <code>value</code>", "Filtering element"],
  ["<code>voltage-source</code>", "<code>ref</code>, <code>value</code>, <code>mode: dc</code>", "Supply rail"],
  ["<code>current-label</code>", "Edge reference", "Branch current"],
  ["<code>voltage-label</code>", "Node pair", "Node voltage"],
  ["<code>op-amp</code>", "<code>ref</code>", "Amplifier with bound pins"],
  ["<code>dependent-source</code>", "<code>ref</code>", "Controlled source"],
  ["<code>digital-input</code>", "<code>ref</code>", "Logic stimulus"],
  ["<code>and</code> / <code>or</code>", "<code>ref</code>", "Logic gates"],
  ["<code>d-flip-flop</code>", "<code>ref</code>", "Sequential element"],
  ["<code>mux</code>", "<code>ref</code>", "Multiplexer"],
  ["<code>digital-output</code>", "<code>ref</code>", "Observation point"],
  ["<code>led</code>", "<code>ref</code>", "Indicator"],
  ["<code>connect</code>", "<code>terminal</code> plus <code>node</code>", "Binds every pin; unbound pins error"],
];

/** @param {string} id @param {string} title @param {string[]} head @param {string[][]} rows */
function codexTable(id, title, head, rows) {
  return `<h2 id="${id}">${title}</h2>
<div class="reference-table-wrap"><table class="reference-table"><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const codexContent = `<h1>Notation codex.</h1>
<p class="lede">AzeForge is a library for both humans and AI agents. People read this page to author valid AzeMark; agents treat it as the human companion to <a href="${DOCS_ROOT}/ai/grammar.json">grammar.json</a> and the <a href="${DOCS_ROOT}/ai-authoring/">AI-authoring contract</a>. Every spelling below is verified against the pinned ${VERSION} compiler Sources and generated grammar. Copy the AzeMark column verbatim; do not invent near-miss keys.</p>
<div class="warning"><strong>Closed grammar.</strong> Unknown words of three or more letters are diagnostics, not new functions. Use only the registered names on this page.</div>
${codexTable("symbols", "Symbols and Greek names", ["Rendered", "AzeMark", "Kind", "Example", "Reads as"], symbolRows)}
${codexTable("transforms", "Subscripts, superscripts, and expression forms", ["Form", "AzeMark", "Rule", "Reads as"], transformRows)}
${codexTable("artifacts", "Directive bodies and their AzeMark shape", ["Directive", "Body shape", "Minimal AzeMark", "Reads as"], artifactRows)}
${codexTable("geometry", "Geometry declarations", ["Declaration", "AzeMark shape", "Reads as"], geometryRows)}
${codexTable("circuit", "Circuit declarations", ["Declaration", "AzeMark shape", "Reads as"], circuitRows)}
<h2 id="workflow">Authoring workflow</h2>
<ol><li>Find the rendered form on this page.</li><li>Copy the AzeMark spelling into a four-colon outer fence or a record-list Block.</li><li>Run <code>azeforge validate</code> before rendering.</li><li>Read the <a href="${DOCS_ROOT}/reference/directives/">generated directive reference</a> for the complete field contract.</li></ol>`;

const aiContent = `<h1>AI-authoring contract.</h1>
<p class="lede">Generate AzeMark language version 2 for AzeForge ${VERSION}. Treat the generated grammar as normative and the canonical Sources as executable examples.</p>
<h2 id="rules">Hard rules</h2>
<ol><li>Emit complete <code>.aze.md</code> Source with <code>azemark: 2</code> front matter.</li><li>Use exactly four colons for outer directive fences, <code>::</code> only for nested figure children, and <code>----</code> between headers and bodies.</li><li>Choose directive fields, enum values, body records, and limits from <a href="${DOCS_ROOT}/ai/grammar.json">grammar.json</a>. Do not infer near-miss keys.</li><li>Use document-scoped kebab-case IDs and declare a target before referring to it when the family resolves declarations in order.</li><li>Run analyze or validate before render. Correct Source from diagnostic locations and suggestions. Never suppress or rewrite a diagnostic as success.</li><li>Do not promise TeX rendering unless capabilities advertise the configured adapter. Mermaid and visual formats need the browser capability.</li><li>Do not use the diagnostic sampler as valid Source. Treat the TeX Source as deployment-dependent.</li></ol>
<h2 id="artifacts">Machine-readable artifacts</h2>
<ul class="link-list"><li><a href="${DOCS_ROOT}/ai/grammar.json"><strong>grammar.json</strong><span>All 26 directives, body schemas, enums, and limits.</span></a></li><li><a href="${DOCS_ROOT}/ai/capabilities.json"><strong>capabilities.json</strong><span>Formats, themes, engines, policies, profiles, and security properties.</span></a></li><li><a href="${DOCS_ROOT}/ai/version.json"><strong>version.json</strong><span>Compiler, source-language, document-schema, and plugin-schema versions.</span></a></li><li><a href="${DOCS_ROOT}/llms.txt"><strong>llms.txt</strong><span>Compact routes and authoring rules for retrieval.</span></a></li></ul>
<h2 id="unknowns">Do not invent these facts</h2><p>The ${VERSION} evidence does not define the complete readable-equation vocabulary, <code>defaults</code> and <code>outputs</code> semantics, full citation or endnote syntax, theme visuals, a complete diagnostic-code catalog, circuit metadata semantics, or future version-transition rules.</p>`;

const llmsText = `# AzeForge ${VERSION} / AzeMark 2

AzeForge is the installable compiler and renderer. AzeMark is its source language. Playground is the authenticated browser trial at /playground.

Documentation: ${DOCS_ROOT}/
Getting started: ${DOCS_ROOT}/getting-started/
Language foundations: ${DOCS_ROOT}/language/
Directive reference: ${DOCS_ROOT}/reference/directives/
Diagnostics: ${DOCS_ROOT}/reference/diagnostics/
AI authoring contract: ${DOCS_ROOT}/ai-authoring/
Grammar JSON: ${DOCS_ROOT}/ai/grammar.json
Capabilities JSON: ${DOCS_ROOT}/ai/capabilities.json
Version JSON: ${DOCS_ROOT}/ai/version.json
Example corpus: ${DOCS_ROOT}/examples/

Authoring rules:
- Emit complete .aze.md Source with integer front matter field azemark: 2.
- Outer directive fences are exactly ::::. Five colons are invalid. Nested figure children use ::. Header/body separator is ----.
- Use grammar.json for fields, records, enum values, and limits. Do not infer keys.
- IDs are document-scoped kebab-case and nesting depth is at most 8.
- Validate before rendering and preserve diagnostic codes, locations, suggestions, and fixes.
- The diagnostics example is intentionally invalid. TeX rendering depends on a deployment adapter.
- AzeForge ${VERSION} supports analyze, compile, and format. Migrate is unavailable.
`;

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
await copyDirectory(PUBLIC_SOURCE, join(OUTPUT, "assets"));
await copyFile(join(PLAYGROUND_SOURCE, "azeforge-logo-transparent.png"), join(OUTPUT, "assets", "azeforge-mark.png"));

await writeRoute("", home);
await writeRoute("docs", docsPage({ title: "Documentation", description: `Current AzeForge documentation, pinned to ${VERSION}.`, path: "", content: docsOverviewContent, toc: [["start", "Start here"], ["guides", "Family guides"], ["reference", "Reference"]] }));
await writeRoute(`docs/${VERSION}`, docsPage({ title: "Documentation", description: `AzeForge ${VERSION} and AzeMark 2 documentation.`, path: `${DOCS_ROOT}/`, content: docsOverviewContent, toc: [["start", "Start here"], ["guides", "Family guides"], ["reference", "Reference"]] }));
await writeRoute(`docs/${VERSION}/getting-started`, docsPage({ title: "Install and first document", description: `Install AzeForge ${VERSION}, validate AzeMark Source, render HTML, and format the file.`, path: `${DOCS_ROOT}/getting-started/`, content: gettingStartedContent, toc: [["install", "Install"], ["source", "Create Source"], ["validate", "Validate and render"], ["format", "Format"]] }));
await writeRoute(`docs/${VERSION}/language`, docsPage({ title: "Language foundations", description: "AzeMark 2 front matter, directive fences, identifiers, composition, and rendering.", path: `${DOCS_ROOT}/language/`, content: languageContent, toc: [["front-matter", "Front matter"], ["fences", "Fences"], ["identifiers", "Identifiers"], ["composition", "Composition"], ["rendering", "Rendering"]] }));
await writeRoute(`docs/${VERSION}/notation`, docsPage({ title: "Notation codex", description: "Verified AzeMark symbols, subscripts, superscripts, directive bodies, geometry, and circuit declarations.", path: `${DOCS_ROOT}/notation/`, content: codexContent, toc: [["symbols", "Symbols"], ["transforms", "Transforms"], ["artifacts", "Artifacts"], ["geometry", "Geometry"], ["circuit", "Circuit"], ["workflow", "Workflow"]] }));

for (const family of families) {
  await writeRoute(`docs/${VERSION}/guides/${family.slug}`, docsPage({ title: family.title, description: family.summary, path: `${DOCS_ROOT}/guides/${family.slug}/`, content: familyContent(family), toc: [["directives", "Directives"], ["sources", "Canonical Sources"], ["workflow", "Workflow"]] }));
}

await writeRoute(`docs/${VERSION}/examples`, docsPage({ title: "Example corpus", description: "The verified AzeMark Source corpus for AzeForge 0.6.2.", path: `${DOCS_ROOT}/examples/`, content: examplesContent }));
await writeRoute(`docs/${VERSION}/reference/directives`, docsPage({ title: "Directive reference", description: `Generated reference for all ${grammar.directives.length} AzeMark directives in AzeForge ${VERSION}.`, path: `${DOCS_ROOT}/reference/directives/`, content: directivesContent, toc: [["index", "Directive index"], ...grammar.directives.map((directive) => /** @type {[string, string]} */ ([directive.type, directive.type]))]}));
await writeRoute(`docs/${VERSION}/reference/front-matter`, docsPage({ title: "Front matter", description: "Verified AzeMark 2 front-matter keys and boundaries.", path: `${DOCS_ROOT}/reference/front-matter/`, content: frontMatterContent, toc: [["example", "Envelope"], ["boundaries", "Boundaries"]] }));
await writeRoute(`docs/${VERSION}/reference/operations`, docsPage({ title: "Operations", description: `Analyze, compile, and format operations in AzeForge ${VERSION}.`, path: `${DOCS_ROOT}/reference/operations/`, content: operationsContent, toc: [["cli", "CLI commands"]] }));
await writeRoute(`docs/${VERSION}/reference/formats-themes`, docsPage({ title: "Formats and themes", description: `Formats, themes, and engines advertised by AzeForge ${VERSION}.`, path: `${DOCS_ROOT}/reference/formats-themes/`, content: formatsThemesContent, toc: [["formats", "Formats"], ["themes", "Themes"], ["engines", "Engines"]] }));
await writeRoute(`docs/${VERSION}/reference/diagnostics`, docsPage({ title: "Diagnostics", description: "AzeForge diagnostic shape, severity, limits, and representative codes.", path: `${DOCS_ROOT}/reference/diagnostics/`, content: diagnosticsContent, toc: [["shape", "Envelope"], ["limits", "Limits"], ["codes", "Codes"], ["sampler", "Invalid sampler"]] }));
await writeRoute(`docs/${VERSION}/reference/limits`, docsPage({ title: "Limits", description: `Document and directive limits generated for AzeForge ${VERSION}.`, path: `${DOCS_ROOT}/reference/limits/`, content: limitsContent, toc: [["document", "Document"], ["directives", "Directives"]] }));
await writeRoute(`docs/${VERSION}/reference/versioning`, docsPage({ title: "Version contract", description: "Compiler, source-language, document-schema, grammar, and plugin version boundaries.", path: `${DOCS_ROOT}/reference/versioning/`, content: versioningContent, toc: [["plugins", "Plugins"], ["future", "Future releases"], ["machine", "Machine report"]] }));
await writeRoute(`docs/${VERSION}/ai-authoring`, docsPage({ title: "AI authoring", description: `Rules and machine-readable contracts for generating AzeMark 2 for AzeForge ${VERSION}.`, path: `${DOCS_ROOT}/ai-authoring/`, content: aiContent, toc: [["rules", "Hard rules"], ["artifacts", "Artifacts"], ["unknowns", "Unknowns"]] }));

for (const example of examples) {
  await writePublicFile(`docs/${VERSION}/examples/${example.id}.aze.md`, example.source.endsWith("\n") ? example.source : `${example.source}\n`);
}
await writePublicFile(`docs/${VERSION}/ai/grammar.json`, json(grammar));
await writePublicFile(`docs/${VERSION}/ai/capabilities.json`, json(capabilities));
await writePublicFile(`docs/${VERSION}/ai/version.json`, json(versionReport));
await writePublicFile(`docs/${VERSION}/llms.txt`, llmsText);
await writePublicFile("llms.txt", llmsText);

process.stdout.write(`built public site for AzeForge ${VERSION}: ${grammar.directives.length} directives, ${examples.length} examples\n`);
