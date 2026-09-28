/**
 * The three deterministic fixtures of `docs/ui/authoring-workspace-redesign.md`
 * and the analysis result each one is verified against.
 *
 * The specification writes line breaks as `<br>` because a markdown table cell
 * cannot hold them, so `lines()` restores them. The stress fixture's 40-record
 * diagnostic set is specification input for the diagnostics surface, not
 * compiler output: the audit's fixture worker places it in the assembled Source
 * and returns it.
 */

/** @param {string} text */
const lines = (text) => text.split("<br>").join("\n");
/** @param {string} text @param {number} count */
const repeat = (text, count) => text.repeat(count);
/** @param {number} value */
const two = (value) => String(value).padStart(2, "0");

export const STRESS_TITLE = "Stress document with a deliberately long metadata title for truncation verification";
export const TYPICAL_TITLE = "Document basics";

/** @typedef {{ source: string, pendingDescription?: string }} FixtureCell */
/** @typedef {"minimum" | "typical" | "stress"} FixtureId */

/** The stress fixture's Cells: one stable identity per `cell-01`…`cell-30`. */
function stressCells() {
  /** @type {FixtureCell[]} */
  const cells = [];
  for (let index = 1; index <= 30; index += 1) {
    const nn = two(index);
    if (index === 1 || index === 2) cells.push({ source: "# Duplicate label" });
    else if (index === 3) cells.push({ source: "# This is the deterministic long derived label for cell 03 used to verify clipping without changing identity" });
    else if (index <= 10) cells.push({ source: lines(`:::: callout<br>Cell ${nn}<br>::::`) });
    else if (index <= 20) cells.push({ source: lines(`:::: equation<br>${nn} + ${nn} = 2${nn}<br>::::`) });
    else if (index === 25) cells.push({ source: "" });
    else if (index === 26) cells.push({ source: `Markdown body for cell ${nn}.${repeat("a", 4096)}` });
    else if (index === 27) cells.push({ source: `Markdown body for cell ${nn}.Unicode: α β γ 日本語 🚀` });
    else if (index === 28) cells.push({ source: `Markdown body for cell ${nn}.`, pendingDescription: `Explain ${repeat("p", 2048)}` });
    else if (index === 29) cells.push({ source: lines(`Markdown body for cell ${nn}.<br>:::: directive<br>mixed<br>::::`) });
    else if (index === 30) cells.push({ source: repeat("x", 102400) });
    else cells.push({ source: `Markdown body for cell ${nn}.` });
  }
  return cells;
}

/** @type {Record<FixtureId, { id: FixtureId, title: string, authors: string[], date: string, metadata: string, theme: string, cells: FixtureCell[] }>} */
export const FIXTURES = {
  minimum: {
    id: "minimum",
    title: "",
    authors: [],
    date: "",
    metadata: "",
    theme: "default",
    cells: [{ source: "" }],
  },
  typical: {
    id: "typical",
    title: TYPICAL_TITLE,
    authors: ["AzeForge examples"],
    date: "2026-09-28",
    metadata: "",
    theme: "default",
    cells: [
      { source: lines("# Thermal balance<br><br>Heat leaves the vessel through the wall.") },
      { source: lines(":::: equation<br>E = mc^2<br>::::") },
      {
        source: lines(":::: callout<br>The table uses SI units.<br>::::<br><br>Read each column before comparing values."),
        pendingDescription: "Explain the table in plain language.",
      },
      { source: lines("| Symbol | Value |<br>| --- | --- |<br>| α | 0.5 |<br>| β | 1.0 |") },
    ],
  },
  stress: {
    id: "stress",
    title: STRESS_TITLE,
    authors: ["Ada Example", "Babbage Example", "Curie Example"],
    date: "2026-09-28",
    metadata: `description: "${repeat("d", 512)}"`,
    theme: "default",
    cells: stressCells(),
  },
};

export const FIXTURE_IDS = /** @type {FixtureId[]} */ (["minimum", "typical", "stress"]);

/** @param {FixtureId} id @returns {FixtureCell[]} */
export function fixtureCells(id) {
  return FIXTURES[id].cells;
}

/**
 * The specification's `diag-01` through `diag-40`: severity by index, then
 * Source order, each pointing at the Cell `((index - 1) mod 30) + 1`.
 * @returns {{ cellIndex: number, severity: "error" | "warning" | "info", code: string, message: string }[]}
 */
export function stressDiagnostics() {
  return Array.from({ length: 40 }, (_, offset) => {
    const index = offset + 1;
    const nn = two(index);
    const severity = /** @type {"error" | "warning" | "info"} */ (
      index <= 16 ? "error" : index <= 32 ? "warning" : "info"
    );
    return {
      cellIndex: ((index - 1) % 30) + 1,
      severity,
      code: `fixture.${severity}.${nn}`,
      message: `Deterministic ${severity} diagnostic ${nn}`,
    };
  });
}

/** The fixture whose assembled Source is in front of the worker, or null. */
/** @param {string} source @returns {FixtureId | null} */
export function fixtureForSource(source) {
  if (source.includes(STRESS_TITLE)) return "stress";
  if (source.includes(`title: ${JSON.stringify(TYPICAL_TITLE)}`)) return "typical";
  if (source.trim() === "---\nazemark: 2\n---") return "minimum";
  return null;
}

/**
 * UTF-8 byte offset and 1-based line/column of `index` in `source`. The
 * compiler's coordinates are bytes, and `indexForPosition` prefers them.
 * @param {string} source @param {number} index
 */
export function positionAt(source, index) {
  const before = source.slice(0, index);
  const lines = before.split("\n");
  return {
    offset: Buffer.byteLength(before, "utf8"),
    line: lines.length,
    column: [...(lines.at(-1) ?? "")].length + 1,
  };
}
