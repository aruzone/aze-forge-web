// @ts-nocheck — throwaway responsive prototype: three tablet transformations via ?variant=&width=.
const variants = [
  { key: "A", name: "Document drawer" },
  { key: "B", name: "Compact outline" },
  { key: "C", name: "Document strip" },
];
const params = new URLSearchParams(location.search);
let variantIndex = Math.max(0, variants.findIndex(({key}) => key === params.get("variant")));
let width = [768, 1024, 1440].includes(Number(params.get("width"))) ? Number(params.get("width")) : 1024;

const source = [
  ["Introduction", "Markdown", `# Introduction\n\nA circle is the set of all points at a fixed distance from a centre. This chapter develops the measurements used in the worked example.`],
  ["Circle area", "Directive + Markdown", `::equation{id="circle-area" number="1"}\nA = \\pi r^2\n::\n\nFor a radius of 4 cm, the area is approximately 50.27 cm².`],
  ["Worked example with a deliberately long label", "Markdown + callout", `## Worked example\n\nGiven **r = 4 cm**, substitute into Equation 1 and round only the final value to two decimal places.\n\n::callout{kind="note"}\nKeep units attached to every intermediate result.\n::`],
];
const esc = (value) => value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

function rail(){return `<aside class="rail"><div class="logo">A</div><button class="selected" title="Author">▤</button><span></span><button title="Service online" class="health">●</button></aside>`;}
function docNav(kind="sidebar"){return `<aside class="doc-nav ${kind}"><div class="doc-label"><span>Current document</span><button>×</button></div><button class="document"><b>Az</b><span><strong>Geometry field guide</strong><small>This session · 3 cells</small></span></button><label class="find">⌕ <input placeholder="Find in document"></label><nav><span>Cells</span>${source.map((item,i)=>`<button class="${i===1?"active":""}"><b>0${i+1}</b><span>${item[0]}<small>${item[1]}</small></span></button>`).join("")}</nav><button class="add">＋ Add cell</button></aside>`;}
function utility(){return `<header class="utility"><button class="doc-toggle">☰ <span>Geometry field guide</span></button><div class="desktop-title"><span>Authoring /</span><strong>Geometry field guide</strong></div><div class="actions"><label>Theme <select><option>Academic light</option></select></label><button class="valid">● Valid</button><button>Export⌄</button><button>•••</button></div></header>`;}
function preview(){return `<section class="preview"><header><div><span>Document preview</span><strong>Geometry field guide</strong></div><div><i></i><b>Out of date</b><button>Refresh preview</button><button>↗</button></div></header><div class="paper"><small>FOUNDATIONS · GEOMETRY</small><h1>Understanding circles</h1><p>A circle is the set of all points at a fixed distance from a centre.</p><p class="equation">A = πr² <em>(1)</em></p></div><button class="divider">•••</button></section>`;}
function cell(item,index){return `<article class="cell ${index===1?"focused":""}"><header><div>⠿ <span>0${index+1}</span> <strong>${item[0]}</strong></div><button>•••</button></header><div class="tabs"><button>Source</button><button>Describe with AI</button><span>${item[2].length} chars</span></div><pre contenteditable="true">${esc(item[2])}</pre>${index===1?`<footer><span>● Compiles</span><small>Ln 4, Col 18</small><button>✦ Describe with AI</button></footer>`:""}</article>`;}
function canvas(){return `<section class="canvas"><details class="details"><summary><span><small>Document details</small><strong>Geometry field guide · K. Author · 2026</strong></span><b>⌄</b></summary></details><div class="canvas-title"><div><small>AzeMark Source</small><h2>Document cells</h2></div><span>3 cells · 684 words</span></div>${source.map(cell).join("")}<button class="add-bottom">＋ Add cell</button></section>`;}
function diagnostics(){return `<aside class="diagnostics"><header><div><small>Document diagnostics</small><strong>2 notices</strong></div><button>×</button></header><div><b>ⓘ Cell 02 · Line 4</b><p>Consider adding accessible equation text.</p></div><div><b>ⓘ Cell 03 · Line 7</b><p>Callout has no explicit title.</p></div></aside>`;}
function tokenLegend(){return `<aside class="token-legend"><b>Measured contract</b><span>Rail <i>64</i></span><span>Sidebar <i>248</i></span><span>Utility <i>56</i></span><span>Preview <i>30%</i></span><span>Canvas max <i>920</i></span><span>Space <i>4·8·12·16·24·32</i></span></aside>`;}

function renderA(){return `<div class="workspace variant-a">${rail()}${docNav()}<main>${utility()}${preview()}${canvas()}</main><button class="drawer-scrim"></button>${diagnostics()}${tokenLegend()}</div>`;}
function renderB(){return `<div class="workspace variant-b">${rail()}${docNav("compact-outline")}<main>${utility()}${preview()}${canvas()}</main>${diagnostics()}${tokenLegend()}</div>`;}
function renderC(){return `<div class="workspace variant-c">${rail()}<main>${utility()}<section class="document-strip"><button><b>Az</b><span><small>Current document</small><strong>Geometry field guide</strong></span></button><label>⌕ <input placeholder="Find in document"></label><select aria-label="Current cell"><option>02 · Circle area</option><option>01 · Introduction</option><option>03 · Worked example</option></select><button>＋</button></section>${preview()}${canvas()}</main>${diagnostics()}${tokenLegend()}</div>`;}
const renders={A:renderA,B:renderB,C:renderC};
function render(){
 const variant=variants[variantIndex];
 document.documentElement.style.setProperty("--simulated-width",`${width}px`);
 document.querySelector("#frame").dataset.width=String(width);
 document.querySelector("#prototype").innerHTML=renders[variant.key]();
 document.querySelector("#variant-label").textContent=`${variant.key} — ${variant.name}`;
 params.set("variant",variant.key); params.set("width",String(width)); history.replaceState(null,"",`${location.pathname}?${params}`);
 document.querySelectorAll("[data-width]").forEach(button=>button.classList.toggle("active",Number(button.dataset.width)===width));
 const toggle=document.querySelector(".doc-toggle"), nav=document.querySelector(".doc-nav"), scrim=document.querySelector(".drawer-scrim");
 toggle?.addEventListener("click",()=>document.querySelector(".workspace").classList.toggle("nav-open"));
 scrim?.addEventListener("click",()=>document.querySelector(".workspace").classList.remove("nav-open"));
 document.querySelector(".doc-label button")?.addEventListener("click",()=>document.querySelector(".workspace").classList.remove("nav-open"));
}
function cycle(delta){variantIndex=(variantIndex+delta+variants.length)%variants.length;render();}
document.querySelector("#previous").addEventListener("click",()=>cycle(-1));
document.querySelector("#next").addEventListener("click",()=>cycle(1));
document.querySelectorAll("[data-width]").forEach(button=>button.addEventListener("click",()=>{width=Number(button.dataset.width);render();}));
addEventListener("keydown",event=>{if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;if(event.key==="ArrowLeft")cycle(-1);if(event.key==="ArrowRight")cycle(1);});
render();
