// @ts-nocheck — throwaway browser prototype; deliberately untyped.
// Three Draft Gate interaction variants, switchable via ?variant=. Throwaway prototype.
const variants = [
  ["A", "Review-first panel"],
  ["B", "Side-by-side comparison"],
  ["C", "Workflow timeline"],
];
const scenarios = {
  math: { description: "Create a numbered equation for the area of a circle.", source: "::::: equation\nid: circle-area\nnumber: true\n----\nA = pi r^2\n:::::", kind: "Mathematics", status: "valid", diagnostic: "No diagnostics. The draft is ready to apply." },
  geometry: { description: "Draw a triangle with an altitude from A.", source: "::::: geometry\n----\n- kind: point\n  name: a\n  x: 0\n  y: 4\n- kind: point\n  name: b\n  x: -3\n  y: 0\n- kind: segment\n  from: a\n  to: b\n:::::", kind: "Geometry", status: "valid", diagnostic: "No diagnostics. The draft is ready to apply." },
  chemistry: { description: "Write the precipitation reaction for silver chloride.", source: "::::: reaction\nbalance: check\n----\nAg+(aq) + Cl-(aq) -> AgCl(s)\n:::::", kind: "Chemistry", status: "valid", diagnostic: "No diagnostics. The draft is ready to apply." },
  "tex-ready": { description: "Make a TikZ commutative square.", source: "::::: tex\nprofile: tikz-cd\n----\n\\begin{tikzcd} A \\arrow[r] \\arrow[d] & B \\arrow[d] \\ \\ C \\arrow[r] & D \\end{tikzcd}\n:::::", kind: "TeX · TikZ-CD", status: "valid", diagnostic: "TikZ-CD is available in this deployment. No diagnostics." },
  "tex-missing": { description: "Make a Chemfig structure for caffeine.", source: "", kind: "TeX · Chemfig", status: "unavailable", diagnostic: "Chemfig is not available in this deployment. No draft was created." },
  invalid: { description: "Create a labelled reaction for water formation.", source: "::::: reaction\nbalance: check\n----\nH2 + O2 -> H2O\n:::::", kind: "Chemistry", status: "invalid", diagnostic: "Line 4: reaction is not balanced. The editor Source is unchanged." },
};
const initialEditor = "# Existing report\n\nThis Source stays unchanged until you choose Apply draft.\n";
const state = { editor: initialEditor, draft: null, scenario: "math", variant: new URLSearchParams(location.search).get("variant") ?? "A", acknowledged: false };
const $ = (id) => document.getElementById(id);
const source = (value) => `<pre>${escape(value)}</pre>`;
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function current() { return scenarios[state.scenario]; }
function statusBlock(item) {
  if (item.status === "unavailable") return `<div class="banner error"><strong>Not available in this deployment</strong><br>${item.diagnostic}<br>Try a supported native authoring type instead.</div>`;
  const tone = item.status === "invalid" ? "error" : "ok";
  return `<div class="diagnostics"><strong class="${tone}">${item.status === "invalid" ? "Compiler diagnostics" : "Draft Gate analysis"}</strong><p class="${tone}">${item.diagnostic}</p></div>`;
}
function draftView() { const item = state.draft; return item ? `<section class="card"><div class="title-row"><h2>AzeMark Source draft</h2><span class="meta">${item.kind} · ${item.status}</span></div>${source(item.source)}${statusBlock(item)}${item.status === "valid" ? `<div class="actions"><button data-action="discard" class="quiet">Discard draft</button><button data-action="apply">Apply draft to editor</button></div>` : `<div class="actions"><button data-action="discard" class="quiet">Keep editing current Source</button><button data-action="revise">Revise Description</button></div>`}</section>` : `<section class="card empty-preview"><p>Generate a draft to enter Draft Gate. Current editor Source remains editable.</p></section>`; }
function editorView() { return `<section class="card"><div class="title-row"><h2>Current editor Source</h2><span class="meta">${state.editor === initialEditor ? "unchanged" : "draft applied"}</span></div>${source(state.editor)}<div class="diagnostics"><strong>Preview and export</strong><p>Continue to existing analysis, preview, and export only after applying a valid draft.</p></div></section>`; }
function render() {
  const selected = variants.find(([key]) => key === state.variant) ?? variants[0]; state.variant = selected[0];
  $("variant-label").textContent = `${selected[0]} · ${selected[1]}`;
  const item = current();
  let content;
  if (state.variant === "A") content = `<div class="title-row"><div><h1>Draft Gate</h1><p class="meta">Review generated Source before it replaces the editor.</p></div><span class="meta">${item.kind}</span></div>${state.draft && item.status === "unavailable" ? statusBlock(item) : ""}${draftView()}<div style="height:1rem"></div>${editorView()}`;
  if (state.variant === "B") content = `<div class="title-row"><div><h1>Compare before applying</h1><p class="meta">The generated proposal is always separate from the current Source.</p></div><span class="meta">${item.kind}</span></div>${state.draft && item.status === "unavailable" ? statusBlock(item) : ""}<div class="source-and-gate">${editorView()}${draftView()}</div>`;
  if (state.variant === "C") content = `<div class="title-row"><div><h1>Authoring workflow</h1><p class="meta">Make the explicit Apply boundary visible as a step.</p></div><span class="meta">${item.kind}</span></div><section class="card timeline"><aside><strong>Steps</strong><ol><li>Description</li><li>Generate</li><li class="active">Draft Gate</li><li>Apply</li><li>Preview & export</li></ol></aside><div class="gate-panel">${state.draft && item.status === "unavailable" ? statusBlock(item) : draftView()}${editorView()}</div></section>`;
  $("surface").innerHTML = content;
  for (const control of $("surface").querySelectorAll("[data-action]")) control.addEventListener("click", () => act(control.dataset.action));
  stateDump();
}
function act(action) {
  if (action === "apply" && state.draft?.status === "valid") { state.editor = state.draft.source; $("activity").textContent = "Draft applied. Existing analysis, preview, and export now operate on the new editor Source."; state.draft = null; }
  if (action === "discard") { state.draft = null; $("activity").textContent = "Draft discarded. Current editor Source was preserved."; }
  if (action === "revise") { $("description").focus(); $("activity").textContent = "Description kept for revision; invalid Source was not applied."; }
  render();
}
function stateDump() { document.body.dataset.prototypeState = JSON.stringify({ scenario: state.scenario, variant: state.variant, acknowledged: state.acknowledged, draft: state.draft?.status ?? null, editor: state.editor === initialEditor ? "unchanged" : "applied" }); }
$("scenario").addEventListener("change", (event) => { state.scenario = event.target.value; $("description").value = current().description; state.draft = null; $("activity").textContent = "Scenario changed; current editor Source remains unchanged."; render(); });
$("acknowledged").addEventListener("change", (event) => { state.acknowledged = event.target.checked; stateDump(); });
$("generate").addEventListener("click", () => { if (!state.acknowledged) { $("activity").textContent = "Acknowledge the model-transfer notice before generating."; return; } state.draft = current(); $("activity").textContent = state.draft.status === "unavailable" ? "No draft created because the selected TeX profile is unavailable." : "Generated proposal analyzed; review it at Draft Gate."; render(); });
$("reset").addEventListener("click", () => { state.editor = initialEditor; state.draft = null; $("activity").textContent = "Editor and Draft Gate reset."; render(); });
function cycle(direction) { const index = variants.findIndex(([key]) => key === state.variant); state.variant = variants[(index + direction + variants.length) % variants.length][0]; const params = new URLSearchParams(location.search); params.set("variant", state.variant); history.replaceState(null, "", `?${params}`); render(); }
$("previous").addEventListener("click", () => cycle(-1)); $("next").addEventListener("click", () => cycle(1));
addEventListener("keydown", (event) => { if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return; if (event.key === "ArrowLeft") cycle(-1); if (event.key === "ArrowRight") cycle(1); });
render();
