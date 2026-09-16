/**
 * The ten native capability families plus document composition.
 *
 * The list is the owner-approved alpha catalog (`aruzone/aze-forge#51`), and
 * each family names the catalog areas and the Document Block kinds that prove
 * it. The walkthrough Source is checked against this map: a family with no
 * Block of its own is not covered, whatever the diagnostics say, so coverage is
 * measured on the semantic Document rather than inferred from a successful
 * render.
 */

/**
 * @typedef {object} Family
 * @property {string} id
 * @property {string} title
 * @property {readonly string[]} areas catalog areas this family's evidence lives in
 * @property {readonly string[]} kinds Block kinds that belong to the family
 */

/** @type {readonly Family[]} */
export const FAMILIES = Object.freeze([
  Object.freeze({
    id: "mathematics",
    title: "Native mathematics",
    areas: Object.freeze(["equation", "derivation"]),
    kinds: Object.freeze(["equation", "derivation"]),
  }),
  Object.freeze({
    id: "plotting",
    title: "Native plots and data charts",
    areas: Object.freeze(["plot", "chart"]),
    kinds: Object.freeze(["plot", "chart"]),
  }),
  Object.freeze({
    id: "geometry",
    title: "Native geometry constructions and measurements",
    areas: Object.freeze(["geometry"]),
    kinds: Object.freeze(["geometry"]),
  }),
  Object.freeze({
    id: "diagrams",
    title: "Native general diagrams",
    areas: Object.freeze(["diagram"]),
    kinds: Object.freeze(["diagram"]),
  }),
  Object.freeze({
    id: "models",
    title: "Native software and data models",
    areas: Object.freeze(["models"]),
    kinds: Object.freeze(["sequence", "state", "entity", "class"]),
  }),
  Object.freeze({
    id: "circuit",
    title: "Native analog and digital circuits",
    areas: Object.freeze(["circuit"]),
    kinds: Object.freeze(["circuit"]),
  }),
  Object.freeze({
    id: "timing",
    title: "Native digital timing",
    areas: Object.freeze(["timing"]),
    kinds: Object.freeze(["timing"]),
  }),
  Object.freeze({
    id: "chemistry",
    title: "Native chemistry",
    areas: Object.freeze(["chemistry"]),
    kinds: Object.freeze(["formula", "reaction", "structure"]),
  }),
  Object.freeze({
    id: "engineering",
    title: "Native control and free-body diagrams",
    areas: Object.freeze(["engineering"]),
    kinds: Object.freeze(["control", "free-body"]),
  }),
  Object.freeze({
    id: "content",
    title: "Native structured content",
    areas: Object.freeze(["structured-content"]),
    kinds: Object.freeze(["table", "algorithm", "statement", "example"]),
  }),
]);

/**
 * Composition is not an eleventh family: it is the document-level numbering,
 * reference and citation layer every family rides on, proven by the `figure`
 * wrapper and the bibliography.
 */
export const COMPOSITION = Object.freeze({
  id: "composition",
  title: "Document composition, references and citations",
  areas: Object.freeze(["composition"]),
  kinds: Object.freeze(["figure", "bibliography"]),
});

/** Every covered unit, in reporting order. */
export const COVERAGE_UNITS = Object.freeze([...FAMILIES, COMPOSITION]);

/**
 * Every Block kind the walkthrough Source is expected to produce, in a stable
 * order. Extras are allowed: prose, callout and mermaid Blocks are ordinary
 * document furniture, not proof of a family.
 */
export const REQUIRED_KINDS = Object.freeze(
  COVERAGE_UNITS.flatMap((unit) => unit.kinds),
);

/**
 * The Block kinds present in a Document, including nested content.
 *
 * @param {any} document
 * @returns {Set<string>}
 */
export function collectKinds(document) {
  /** @type {Set<string>} */
  const kinds = new Set();
  /** @param {any} block */
  const visit = (block) => {
    if (block === null || typeof block !== "object") return;
    if (typeof block.kind === "string") kinds.add(block.kind);
    for (const value of Object.values(block)) {
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
      } else if (value !== null && typeof value === "object") {
        visit(value);
      }
    }
  };
  if (Array.isArray(document?.blocks)) for (const block of document.blocks) visit(block);
  return kinds;
}

/**
 * Per-unit coverage of one Document.
 *
 * A unit is covered when at least one of its kinds is present: the walkthrough
 * spans all ten families and composition, it does not have to exercise every
 * directive of every family.
 *
 * @param {any} document
 * @returns {{ id: string, title: string, covered: boolean, kinds: { kind: string, present: boolean }[] }[]}
 */
export function coverageReport(document) {
  const kinds = collectKinds(document);
  return COVERAGE_UNITS.map((unit) => {
    const reported = unit.kinds.map((kind) => ({ kind, present: kinds.has(kind) }));
    return {
      id: unit.id,
      title: unit.title,
      covered: reported.some((entry) => entry.present),
      kinds: reported,
    };
  });
}

/**
 * The units the walkthrough Source failed to cover.
 *
 * @param {any} document
 * @returns {string[]}
 */
export function uncoveredUnits(document) {
  return coverageReport(document)
    .filter((unit) => !unit.covered)
    .map((unit) => unit.id);
}
