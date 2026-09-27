// @ts-nocheck — throwaway UI prototype: three workspace compositions via ?variant=.
const variants = [
  { key: "A", name: "Structured canvas" },
  { key: "B", name: "Document cockpit" },
  { key: "C", name: "Focused manuscript" },
];

const sourceOne = `# Introduction\n\nA circle is the set of all points at a fixed distance from a centre. This chapter develops its key measurements and gives a worked example.`;
const sourceTwo = `::equation{id="circle-area" number="1"}\nA = \\pi r^2\n::\n\nFor a radius of 4 cm, the area is approximately 50.27 cm².`;
const sourceThree = `## Worked example\n\nGiven **r = 4 cm**, substitute into Equation 1 and round only the final value to two decimal places.\n\n::callout{kind="note"}\nKeep units attached to every intermediate result.\n::`;

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function preview() {
  return `<section class="preview-panel" aria-label="Document preview">
    <div class="panel-heading"><div><span class="eyebrow">Document preview</span><strong>Geometry field guide</strong></div><div class="preview-actions"><span class="stale-dot"></span><span>Stale — 3 edits</span><button data-action="refresh">Refresh</button><button title="Expand preview">↗</button></div></div>
    <div class="paper"><p class="paper-kicker">FOUNDATIONS · GEOMETRY</p><h1>Understanding circles</h1><p>A circle is the set of all points at a fixed distance from a centre.</p><div class="formula">A = πr² <small>(1)</small></div><p>For a radius of 4 cm, the area is approximately <b>50.27 cm²</b>.</p></div>
    <button class="resize-handle" aria-label="Resize preview">•••</button>
  </section>`;
}

function cell(index, title, source, active = false) {
  return `<article class="cell ${active ? "active" : ""}">
    <header><div><span class="drag">⠿</span><span class="cell-number">${String(index).padStart(2, "0")}</span><strong>${title}</strong></div><div class="cell-actions"><button title="Move up">↑</button><button title="Move down">↓</button><button title="More">•••</button></div></header>
    <div class="editor-tabs"><button class="selected">Source</button><button>Describe with AI</button><span>${source.length} chars</span></div>
    <pre contenteditable="true" spellcheck="false" aria-label="${title} Source">${escapeHtml(source)}</pre>
    ${active ? `<footer><span class="ok">● Compiles</span><span>Ln 4, Col 18</span><button class="ai">✦ Describe with AI</button></footer>` : ""}
  </article>`;
}

function controls(orientation = "row") {
  return `<section class="document-controls ${orientation}">
    <label>Theme<select><option>Academic light</option></select></label>
    <button>Format Source</button><button>Analyze</button>
    <div class="export"><button>Export ▾</button></div>
  </section>`;
}

function rail(compact = false) {
  return `<aside class="dark-rail ${compact ? "compact" : ""}">
    <div class="logo">A</div>${compact ? "" : "<strong>AzeForge</strong>"}
    <nav><button class="current"><span>▤</span>${compact ? "" : "Author"}</button><button><span>◫</span>${compact ? "" : "Assets"}</button><button><span>⚙</span>${compact ? "" : "Settings"}</button></nav>
    <div class="rail-bottom"><span class="service-dot"></span>${compact ? "" : "Service online"}</div>
  </aside>`;
}

function documentNav(kind = "full") {
  return `<aside class="document-nav ${kind}">
    <div class="nav-title"><span class="eyebrow">Current document</span><button title="Document menu">•••</button></div>
    <button class="document-row"><span class="doc-icon">A<span>z</span></span><span><strong>Geometry field guide</strong><small>Unsaved session · 3 cells</small></span></button>
    <label class="search">⌕<input type="search" placeholder="Find in document"></label>
    <div class="outline"><span class="eyebrow">Cells</span><button class="selected"><b>01</b><span>Introduction<small>Markdown</small></span></button><button><b>02</b><span>Circle area<small>Directive + Markdown</small></span></button><button><b>03</b><span>Worked example<small>Markdown + callout</small></span></button></div>
    <button class="add">＋ Add cell</button>
  </aside>`;
}

function variantA() {
  return `<div class="workspace variant-a">${rail()}${documentNav()}<main><header class="topbar"><div><span class="crumb">Authoring /</span><strong>Geometry field guide</strong><span class="dirty">Edited</span></div>${controls()}</header>${preview()}<section class="canvas"><div class="canvas-heading"><div><span class="eyebrow">AzeMark Source</span><h2>Document cells</h2></div><span>3 cells · 684 words</span></div>${cell(1,"Introduction",sourceOne)}${cell(2,"Circle area",sourceTwo,true)}${cell(3,"Worked example",sourceThree)}</section></main></div>`;
}

function variantB() {
  return `<div class="workspace variant-b">${rail(true)}<aside class="cockpit"><div><span class="eyebrow">Current document</span><h1>Geometry<br>field guide</h1><p>Edited in this session</p></div>${controls("column")}<div class="status-card"><span class="ok">● Source valid</span><strong>0 errors · 2 notices</strong><small>Analyzed moments ago</small></div><div class="mini-outline"><span class="eyebrow">Jump to cell</span><button>01 Introduction</button><button class="selected">02 Circle area</button><button>03 Worked example</button></div><button class="add">＋ Add cell</button></aside><main><header class="topbar"><strong>AzeMark workspace</strong><div><button>Diagnostics <b>2</b></button><button>Session ▾</button></div></header>${preview()}<section class="canvas compact-cells">${cell(1,"Introduction",sourceOne)}${cell(2,"Circle area",sourceTwo,true)}${cell(3,"Worked example",sourceThree)}</section></main></div>`;
}

function variantC() {
  return `<div class="workspace variant-c">${rail(true)}<main><header class="topbar"><button class="document-trigger"><span class="doc-icon">A<span>z</span></span><span><small>Current document</small><strong>Geometry field guide⌄</strong></span></button>${controls()}</header>${preview()}<div class="manuscript-layout"><aside class="margin-outline"><span class="eyebrow">Outline</span><button class="selected">01</button><button>02</button><button>03</button><button class="add-round">＋</button></aside><section class="canvas manuscript"><div class="canvas-heading"><div><span class="eyebrow">Editing source</span><h2>Geometry field guide</h2></div><button>⌕ Find</button></div>${cell(1,"Introduction",sourceOne)}${cell(2,"Circle area",sourceTwo,true)}${cell(3,"Worked example",sourceThree)}</section><aside class="context-panel"><span class="eyebrow">Document</span><dl><dt>Theme</dt><dd>Academic light</dd><dt>Source</dt><dd>Valid</dd><dt>Diagnostics</dt><dd>2 notices</dd><dt>Preview</dt><dd class="stale-text">Stale</dd></dl><button>View diagnostics</button><button>Front matter</button><button>Export document</button></aside></div></main></div>`;
}

const renderers = { A: variantA, B: variantB, C: variantC };
const params = new URLSearchParams(location.search);
let current = variants.findIndex(({ key }) => key === params.get("variant"));
if (current < 0) current = 0;

function render() {
  const variant = variants[current];
  document.querySelector("#prototype").innerHTML = renderers[variant.key]();
  document.querySelector("#variant-label").textContent = `${variant.key} — ${variant.name}`;
  params.set("variant", variant.key);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  document.querySelectorAll('[data-action="refresh"]').forEach((button) => button.addEventListener("click", () => {
    button.closest(".preview-actions").innerHTML = '<span class="fresh-dot"></span><span>Up to date</span><button data-action="refresh">Refresh</button><button title="Expand preview">↗</button>';
  }));
}

function cycle(delta) { current = (current + delta + variants.length) % variants.length; render(); }
document.querySelector("#previous").addEventListener("click", () => cycle(-1));
document.querySelector("#next").addEventListener("click", () => cycle(1));
addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  if (event.key === "ArrowLeft") cycle(-1);
  if (event.key === "ArrowRight") cycle(1);
});
render();
