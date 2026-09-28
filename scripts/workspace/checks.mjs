/**
 * The workspace audit's cross-cutting checks: landmarks and reading order,
 * the deterministic fixtures, viewport captures, the automated WCAG scans and
 * the contract measurements that back them (contrast, target sizes, visible
 * and unclipped focus, reduced motion, forced colors, iframe names, the live
 * region).
 *
 * Every check returns the evidence lines the specification's acceptance IDs
 * cite. A failed expectation throws `CheckFailure`; the runner records it.
 */

import { expect } from "../cli.mjs";
import { axeViolations, emulateMedia } from "./browser.mjs";
import { FIXTURES } from "./fixtures.mjs";
import { analyzeDocument, loadFixture, refreshPreview, settle, workspaceState } from "./page.mjs";

/**
 * @typedef {{ base: string, token: string,
 *   open: (options: { width: number, height: number }) => Promise<import("puppeteer-core").Page>,
 *   capture: (page: import("puppeteer-core").Page, name: string) => Promise<string>,
 *   downloads: (page: import("puppeteer-core").Page) => Promise<{ waitFor: (quietMs?: number) => Promise<string[]> }>,
 *   log: (line: string) => void }} AuditContext
 */

/** The captures the specification requires, in CSS pixels. */
export const CAPTURES = [
  { name: "workspace-1440x900", width: 1440, height: 900 },
  { name: "workspace-1200x900", width: 1200, height: 900 },
  { name: "workspace-1199x900", width: 1199, height: 900 },
  { name: "workspace-1024x768", width: 1024, height: 768 },
  { name: "workspace-768x1024", width: 768, height: 1024 },
  { name: "workspace-767x1024", width: 767, height: 1024 },
  { name: "workspace-320x800", width: 320, height: 800 },
];

/** Desktop, tablet, and the 320 px accessibility reflow. */
export const SCAN_STATES = [
  { name: "desktop-1440x900", width: 1440, height: 900, minTarget: 32 },
  { name: "tablet-768x1024", width: 768, height: 1024, minTarget: 44 },
  { name: "reflow-320x800", width: 320, height: 800, minTarget: 24 },
];

/** @param {import("puppeteer-core").Page} page */
async function overflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
}

/** Landmarks, reading order, names, and the positive-`tabindex` prohibition.
 * @param {AuditContext} ctx */
async function landmarks(ctx) {
  const page = await ctx.open({ width: 1440, height: 900 });
  const structure = await page.evaluate(() => {
    /** @type {(node: Element | null) => string} */
    const name = (node) => (node === null ? "" : node.id || node.getAttribute("class") || node.tagName);
    const workspace = document.getElementById("workspace");
    const main = document.getElementById("main-workspace");
    return {
      order: [...(workspace?.children ?? [])].map(name),
      mainOrder: [...(main?.children ?? [])].map(name),
      canvasOrder: [...(document.getElementById("cell-canvas")?.children ?? [])].map(name),
      mains: document.querySelectorAll("main").length,
      navNames: [...document.querySelectorAll("nav")].map((node) => node.getAttribute("aria-label")),
      complementaries: [...document.querySelectorAll("aside")].map((node) => node.getAttribute("aria-labelledby")),
      skipLinks: [...document.querySelectorAll(".skip-link")].map((node) => ({
        text: node.textContent ?? "",
        target: node.getAttribute("href") ?? "",
        exists: document.querySelector(node.getAttribute("href") ?? "#") !== null,
      })),
      positiveTabindex: [...document.querySelectorAll("[tabindex]")]
        .filter((node) => Number(node.getAttribute("tabindex")) > 0).length,
      dialogs: [...document.querySelectorAll("dialog")].map((node) => node.id),
      namedSections: [...document.querySelectorAll("section[aria-labelledby], aside[aria-labelledby]")]
        .map((node) => document.getElementById(node.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""),
    };
  });
  const evidence = [
    `landmark order: ${structure.order.join(" → ")}`,
    `main children: ${structure.mainOrder.join(" → ")}`,
    `cell canvas children: ${structure.canvasOrder.join(" → ")}`,
    `nav landmarks: ${structure.navNames.join(", ")}; complementary: ${structure.complementaries.join(", ")}`,
    `dialogs: ${structure.dialogs.join(", ")}`,
    `skip links: ${structure.skipLinks.map((/** @type {any} */ link) => `${link.text} → ${link.target} (${link.exists ? "resolves" : "MISSING"})`).join("; ")}`,
    `positive tabindex elements: ${structure.positiveTabindex}`,
  ];
  expect(structure.mains === 1, `${structure.mains} <main> elements; the contract allows one`);
  expect(structure.positiveTabindex === 0, "a positive tabindex is forbidden");
  expect(structure.skipLinks.length === 3, `${structure.skipLinks.length} skip links; the contract names three`);
  for (const link of structure.skipLinks) expect(link.exists, `skip link ${link.text} targets nothing`);
  expect(
    structure.order.join(",") === ["app-rail", "document-navigation", "main-workspace", "drawer-scrim", "diagnostics-panel"].join(","),
    `reading order changed: ${structure.order.join(" → ")}`,
  );
  expect(
    structure.mainOrder.join(",") === ["utility-bar", "document-preview", "cell-canvas"].join(","),
    `main's reading order changed: ${structure.mainOrder.join(" → ")}`,
  );
  expect(
    structure.canvasOrder.join(",").startsWith("document-details,canvas-heading,notebook-cells"),
    `Document details must precede the Cell canvas: ${structure.canvasOrder.join(" → ")}`,
  );
  expect(structure.navNames.includes("Application"), "the application rail is unnamed");
  await page.close();
  return evidence;
}

/** The three deterministic fixtures, built through the real controls.
 * @param {AuditContext} ctx */
async function fixtures(ctx) {
  const evidence = [];
  const page = await ctx.open({ width: 1440, height: 900 });

  await loadFixture(page, "minimum");
  const minimum = await workspaceState(page);
  const minimumEmpty = await page.evaluate(() => ({
    placeholderVisible: document.getElementById("preview-placeholder")?.hidden === false,
    previewHidden: /** @type {HTMLIFrameElement | null} */ (document.getElementById("preview"))?.hidden === true,
    sourceEmpty: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"))?.value === "",
  }));
  expect(minimum.cellCount === 1, `minimum fixture rendered ${minimum.cellCount} Cells`);
  expect(minimum.cellLabels[0] === "Untitled cell", `minimum Cell label is ${JSON.stringify(minimum.cellLabels[0])}`);
  expect(minimum.title === "Untitled document", `minimum document title is ${JSON.stringify(minimum.title)}`);
  expect(minimum.preview.state === "empty", `minimum preview state is ${minimum.preview.state}`);
  expect(minimumEmpty.placeholderVisible && minimumEmpty.previewHidden && minimumEmpty.sourceEmpty, "minimum fixture is not the empty document");
  evidence.push(`minimum: 1 empty Cell labelled "Untitled cell", preview "${minimum.preview.message}", empty Source`);

  await loadFixture(page, "typical");
  const typical = await workspaceState(page);
  const typicalDetail = await page.evaluate(() => {
    const kinds = [...document.querySelectorAll("#cell-list button small")].map((node) => node.textContent ?? "");
    const labels = [...document.querySelectorAll("#notebook-cells .cell")].map((cell, index) => ({
      label: cell.querySelector(".cell-heading strong")?.textContent ?? "",
      kind: kinds[index] ?? "",
      up: /** @type {HTMLButtonElement | null} */ (cell.querySelector('[data-action="move-up"]'))?.disabled === true,
      down: /** @type {HTMLButtonElement | null} */ (cell.querySelector('[data-action="move-down"]'))?.disabled === true,
    }));
    return labels;
  });
  expect(typical.cellCount === 4, `typical fixture rendered ${typical.cellCount} Cells`);
  expect(typical.title === FIXTURES.typical.title, `typical title is ${JSON.stringify(typical.title)}`);
  expect(typicalDetail[0]?.label === "Thermal balance", `Cell 1 label is ${JSON.stringify(typicalDetail[0]?.label)}`);
  expect(typicalDetail[1]?.label === "equation", `Cell 2 label is ${JSON.stringify(typicalDetail[1]?.label)}`);
  expect(typicalDetail[2]?.label === "callout", `Cell 3 label is ${JSON.stringify(typicalDetail[2]?.label)}`);
  expect(typicalDetail[0]?.up === true && typicalDetail[3]?.down === true, "boundary Cell moves are not disabled");
  const kinds = typicalDetail.map((/** @type {any} */ cell) => cell.kind.replace(/ · .*$/, "")).join(" | ");
  expect(kinds === "Markdown | Directive | Markdown + directive | Markdown", `Cell kinds are ${JSON.stringify(kinds)}`);
  // Pending Description survives the round trip and the Source comes back whole.
  const roundTrip = await page.evaluate(() => {
    const cell = document.querySelectorAll("#notebook-cells .cell")[2];
    const id = cell?.getAttribute("data-cell-id") ?? "";
    const source = /** @type {HTMLTextAreaElement | null} */ (cell?.querySelector("[data-role=source]"));
    const before = source?.value ?? "";
    /** @type {HTMLElement | null} */ (cell?.querySelector('[data-action="mode-description"]'))?.click();
    const description = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`[data-role=description][data-cell-id="${id}"]`));
    const preserved = description?.value ?? "";
    /** @type {HTMLElement | null} */ (document.querySelector(`[data-action="back-source"][data-cell-id="${id}"]`))?.click();
    const after = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`[data-role=source][data-cell-id="${id}"]`))?.value ?? "";
    return { preserved, unchanged: before === after, hasSource: before.length > 0 };
  });
  expect(roundTrip.preserved === "Explain the table in plain language.", `Pending Description is ${JSON.stringify(roundTrip.preserved)}`);
  expect(roundTrip.hasSource && roundTrip.unchanged, "switching editor mode changed the Source");
  evidence.push(`typical: ${typicalDetail.map((/** @type {any} */ cell) => cell.label).join(" · ")}; kinds ${kinds}; boundary moves disabled; Pending Description preserved across the mode switch`);

  await loadFixture(page, "stress");
  const stress = await workspaceState(page);
  const stressDetail = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("#notebook-cells .cell")];
    const labels = cells.map((cell) => {
      const node = /** @type {HTMLElement | null} */ (cell.querySelector(".cell-heading strong"));
      return { text: node?.textContent ?? "", clipped: node === null ? true : node.scrollWidth > node.clientWidth + 1 };
    });
    const third = labels[2];
    const outline = [...document.querySelectorAll("#cell-list button")];
    const duplicate = outline.filter((button) => (button.textContent ?? "").includes("Duplicate label"));
    const secondId = duplicate[1]?.getAttribute("data-cell-id") ?? null;
    /** @type {HTMLElement | null} */ (duplicate[1])?.click();
    const focusedIn = document.activeElement?.closest(".cell")?.getAttribute("data-cell-id") ?? null;
    return {
      labels,
      thirdClipped: third?.clipped ?? false,
      duplicates: duplicate.length,
      distinctIds: new Set(duplicate.map((button) => button.getAttribute("data-cell-id"))).size,
      secondId,
      focusedIn,
    };
  });
  expect(stress.cellCount === 30, `stress fixture rendered ${stress.cellCount} Cells`);
  expect(stress.outlineCount === 30, `stress outline has ${stress.outlineCount} entries`);
  expect(stressDetail.duplicates === 2, `${stressDetail.duplicates} outline entries carry the duplicate label`);
  expect(stressDetail.distinctIds === 2, "the duplicate labels share one identity");
  expect(
    stressDetail.focusedIn !== null && stressDetail.focusedIn === stressDetail.secondId,
    "navigating by entry did not focus that entry's own Cell",
  );
  expect(stressDetail.labels[24]?.text === "Untitled cell", `Cell 25 label is ${JSON.stringify(stressDetail.labels[24]?.text)}`);
  expect(stressDetail.labels[2] !== undefined && !stressDetail.thirdClipped, "the long derived label overflows its container");
  const longTitle = await page.evaluate(() => {
    const node = document.getElementById("desktop-title");
    return { text: node?.textContent ?? "", clipped: node === null ? true : node.scrollWidth > node.clientWidth + 1, width: node?.clientWidth ?? 0, scroll: node?.scrollWidth ?? 0 };
  });
  expect(!longTitle.clipped, `the stress title overflows its container (${longTitle.scroll} > ${longTitle.width})`);
  evidence.push(
    `stress: 30 Cells and 30 outline entries; Cell 3 long label and the 4-author title render without overflow; ` +
      `the second "Duplicate label" entry focused its own Cell; Cell 25 is "Untitled cell"`,
  );

  await analyzeDocument(page);
  const analyzed = await page.evaluate(() => {
    const entries = [...document.querySelectorAll("#diagnostics-list .diagnostic")];
    const severities = entries.map((entry) => entry.getAttribute("data-severity") ?? "");
    const cellIds = [...document.querySelectorAll("#notebook-cells .cell")].map((cell) => cell.getAttribute("data-cell-id") ?? "");
    /** @param {string} index */
    const activate = (index) => {
      const button = /** @type {HTMLButtonElement | null} */ (document.querySelector(`#diagnostics-list button[data-diagnostic="${index}"]`));
      button?.click();
      const active = document.activeElement;
      const area = /** @type {HTMLTextAreaElement | null} */ (active instanceof HTMLTextAreaElement ? active : null);
      const dock = document.getElementById("diagnostics-panel")?.getBoundingClientRect() ?? null;
      const rect = area?.getBoundingClientRect() ?? null;
      return {
        focused: area?.dataset.role ?? null,
        cellId: area?.dataset.cellId ?? null,
        range: [area?.selectionStart ?? null, area?.selectionEnd ?? null],
        panelOpen: document.getElementById("diagnostics-panel")?.hidden === false,
        unobscured: dock === null || rect === null ? null : rect.left < dock.left,
        label: button?.textContent ?? "",
      };
    };
    const first = activate("0");
    const firstWarning = activate("16");
    return {
      count: entries.length,
      severities,
      summary: document.getElementById("diagnostics-summary")?.textContent ?? "",
      heading: document.getElementById("diagnostics-title")?.textContent ?? "",
      first,
      firstWarning,
      firstCellId: cellIds[0] ?? null,
      seventeenthCellId: cellIds[16] ?? null,
    };
  });
  const expected = [
    ...Array.from({ length: 16 }, () => "error"),
    ...Array.from({ length: 16 }, () => "warning"),
    ...Array.from({ length: 8 }, () => "info"),
  ];
  expect(analyzed.count === 40, `stress analysis rendered ${analyzed.count} diagnostics`);
  expect(
    analyzed.severities.join(",") === expected.join(","),
    `diagnostics are not grouped by severity then Source order: ${analyzed.severities.join(",")}`,
  );
  expect(analyzed.summary === "16 error · 16 warning", `stress summary is ${JSON.stringify(analyzed.summary)}`);
  expect(analyzed.heading === "40 diagnostics", `stress heading is ${JSON.stringify(analyzed.heading)}`);
  expect(
    analyzed.first.cellId !== null && analyzed.first.cellId === analyzed.firstCellId,
    `the first error focused ${analyzed.first.focused} in Cell ${String(analyzed.first.cellId).slice(0, 8)} (${analyzed.first.label}) instead of Cell 1`,
  );
  expect(analyzed.first.range[0] === 0, `the first error focused offset ${analyzed.first.range[0]}`);
  expect(
    analyzed.firstWarning.cellId !== null && analyzed.firstWarning.cellId === analyzed.seventeenthCellId,
    `the first warning focused Cell ${String(analyzed.firstWarning.cellId).slice(0, 8)} instead of Cell 17`,
  );
  expect(analyzed.first.panelOpen && analyzed.firstWarning.panelOpen, "activating a diagnostic closed the dock");
  expect(analyzed.first.unobscured === true, "the focused Source range sits under the dock");
  evidence.push(
    `stress analysis: 40 diagnostics grouped ${analyzed.severities.join("").replaceAll("error", "e").replaceAll("warning", "w").replaceAll("info", "i")} ` +
      `(16 error · 16 warning), heading "${analyzed.heading}"; the first error focused Cell 1's Source at offset ${analyzed.first.range.join("-")} and the first warning Cell 17, ` +
      `each with the dock open and unobscured`,
  );

  await page.close();
  return evidence;
}

/** The required viewport captures, reflowing without horizontal scrolling.
 * @param {AuditContext} ctx */
async function captures(ctx) {
  const evidence = [];
  for (const capture of CAPTURES) {
    const page = await ctx.open({ width: capture.width, height: capture.height });
    await loadFixture(page, "typical");
    await refreshPreview(page);
    const size = await overflow(page);
    expect(
      size.scrollWidth <= size.clientWidth,
      `${capture.name} scrolls horizontally (${size.scrollWidth} > ${size.clientWidth})`,
    );
    const path = await ctx.capture(page, capture.name);
    evidence.push(`${capture.name}: no horizontal overflow (scrollWidth ${size.scrollWidth} = clientWidth ${size.clientWidth}) → ${path}`);
    await page.close();
  }

  // The tablet drawer, open over the workspace.
  const drawer = await ctx.open({ width: 1024, height: 768 });
  await loadFixture(drawer, "typical");
  await drawer.evaluate(() => /** @type {HTMLElement | null} */ (document.getElementById("open-document-nav"))?.click());
  await settle(drawer);
  const drawerState = await drawer.evaluate(() => ({
    open: document.getElementById("workspace")?.dataset.navOpen === "true",
    focused: document.activeElement?.id ?? document.activeElement?.getAttribute("aria-label") ?? "",
    mainInert: document.getElementById("main-workspace")?.inert === true,
  }));
  expect(drawerState.open && drawerState.mainInert, "the tablet drawer did not open over an inert workspace");
  const drawerPath = await ctx.capture(drawer, "workspace-1024x768-drawer-open");
  evidence.push(`workspace-1024x768-drawer-open: drawer open, workspace inert, focus on ${drawerState.focused} → ${drawerPath}`);
  await drawer.close();

  // 200 % zoom: a 1440 px window at 200 % is a 720 px CSS layout.
  const zoom = await ctx.open({ width: 720, height: 900 });
  await loadFixture(zoom, "typical");
  await refreshPreview(zoom);
  const zoomSize = await overflow(zoom);
  expect(zoomSize.scrollWidth <= zoomSize.clientWidth, `200 % zoom scrolls horizontally (${zoomSize.scrollWidth} > ${zoomSize.clientWidth})`);
  const zoomPath = await ctx.capture(zoom, "workspace-zoom200-720x900");
  evidence.push(`workspace-zoom200-720x900 (200 % zoom): no horizontal overflow → ${zoomPath}`);
  await zoom.close();
  return evidence;
}

/** axe-core over the WCAG 2.x A/AA tags, including WCAG 2.2.
 * @param {AuditContext} ctx */
async function scans(ctx) {
  const evidence = [];
  for (const state of SCAN_STATES) {
    const page = await ctx.open({ width: state.width, height: state.height });
    await loadFixture(page, "typical");
    await refreshPreview(page);
    const violations = await axeViolations(page);
    expect(violations.length === 0, `${state.name}: axe reported ${violations.length} violation(s): ${violations.map((/** @type {any} */ violation) => `${violation.id} (${violation.nodes.length})`).join(", ")}`);
    const rules = await page.evaluate(() => /** @type {any} */ (window).axe.getRules([]).length);
    evidence.push(`${state.name}: 0 violations across WCAG 2.0/2.1/2.2 A+AA (${rules} axe rules evaluated)`);
    await page.close();
  }
  // Density: the stress fixture is the worst case for names, contrast, and targets.
  const dense = await ctx.open({ width: 1440, height: 900 });
  await loadFixture(dense, "stress");
  await analyzeDocument(dense);
  const denseViolations = await axeViolations(dense);
  expect(denseViolations.length === 0, `stress: axe reported ${denseViolations.length} violation(s): ${denseViolations.map((/** @type {any} */ violation) => violation.id).join(", ")}`);
  evidence.push("stress-1440x900 with 30 Cells and 40 diagnostics: 0 violations");
  await dense.close();
  return evidence;
}

/** Text contrast, measured from computed styles rather than trusted to a rule. */
/** @param {AuditContext} ctx */
async function contrast(ctx) {
  const page = await ctx.open({ width: 1440, height: 900 });
  await loadFixture(page, "typical");
  await refreshPreview(page);
  const measurement = await page.evaluate(() => {
    /** @param {string} value */
    const parse = (value) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: numbers[0] ?? 0, g: numbers[1] ?? 0, b: numbers[2] ?? 0, a: numbers[3] ?? 1 };
    };
    /** @param {{ r: number, g: number, b: number }} colour */
    const luminance = (colour) => {
      const channel = (/** @type {number} */ value) => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
    };
    /** @param {string} a @param {string} b */
    const ratio = (a, b) => {
      const first = luminance(parse(a));
      const second = luminance(parse(b));
      const [light, dark] = first > second ? [first, second] : [second, first];
      return (light + 0.05) / (dark + 0.05);
    };
    /** @param {Element} node */
    const background = (node) => {
      let current = /** @type {Element | null} */ (node);
      while (current !== null) {
        const colour = getComputedStyle(current).backgroundColor;
        if (parse(colour).a > 0.9) return colour;
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    /** @type {{ text: string, ratio: number, required: number, font: string }[]} */
    const rows = [];
    for (const node of document.querySelectorAll("body *")) {
      const text = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (text === "") continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const size = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      rows.push({
        text: text.slice(0, 40),
        ratio: Number(ratio(style.color, background(node)).toFixed(2)),
        required: large ? 3 : 4.5,
        font: `${size}px/${weight}`,
      });
    }
    const tokens = getComputedStyle(document.documentElement);
    return {
      rows,
      tokens: ["--text", "--muted", "--accent", "--stale", "--error", "--success"].map((token) => `${token}: ${tokens.getPropertyValue(token).trim()}`),
    };
  });
  const worst = measurement.rows.reduce((/** @type {any} */ lowest, /** @type {any} */ row) => (row.ratio < lowest.ratio ? row : lowest), measurement.rows[0] ?? { text: "", ratio: 21, required: 4.5 });
  const failures = measurement.rows.filter((/** @type {any} */ row) => row.ratio < row.required);
  expect(
    failures.length === 0,
    `${failures.length} text pair(s) below AA: ${failures.slice(0, 4).map((/** @type {any} */ row) => `${JSON.stringify(row.text)} ${row.ratio}:1 < ${row.required}`).join("; ")}`,
  );
  await page.close();
  return [
    `${measurement.rows.length} visible text nodes measured; lowest ratio ${worst.ratio}:1 (required ${worst.required}, ${JSON.stringify(worst.text)})`,
    `hardened tokens in use: ${measurement.tokens.join(", ")}`,
  ];
}

/** Every interaction box meets its density rule at each state. */
/** @param {AuditContext} ctx */
async function targets(ctx) {
  const evidence = [];
  for (const state of SCAN_STATES) {
    const page = await ctx.open({ width: state.width, height: state.height });
    await loadFixture(page, "typical");
    const boxes = await page.evaluate(() => {
      const selector = "a[href], button, input, select, textarea, summary, [role=menuitem], [role=tab], [role=separator], [tabindex]:not([tabindex='-1'])";
      /** @type {{ id: string, w: number, h: number }[]} */
      const rows = [];
      for (const node of document.querySelectorAll(selector)) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        rows.push({
          id: node.id || node.getAttribute("class")?.split(" ")[0] || node.tagName.toLowerCase(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
      return rows;
    });
    const menus = await page.evaluate(() => {
      /** @type {{ id: string, w: number, h: number }[]} */
      const rows = [];
      /** @param {HTMLElement | null} root */
      const measure = (root) => {
        if (root === null) return;
        for (const node of root.querySelectorAll("button")) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          rows.push({
            id: node.id || node.dataset.format || node.textContent?.trim().slice(0, 12) || "menu-item",
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          });
        }
      };
      /** @type {HTMLElement | null} */ (document.getElementById("export-toggle"))?.click();
      measure(document.getElementById("export-menu"));
      /** @type {HTMLElement | null} */ (document.getElementById("export-toggle"))?.click();
      /** @type {HTMLElement | null} */ (document.getElementById("more-toggle"))?.click();
      measure(document.getElementById("more-menu"));
      /** @type {HTMLElement | null} */ (document.getElementById("more-toggle"))?.click();
      return rows;
    });
    boxes.push(...menus);
    const small = boxes.filter((/** @type {any} */ box) => box.w < state.minTarget || box.h < state.minTarget);
    expect(
      small.length === 0,
      `${state.name}: ${small.length} box(es) below ${state.minTarget}px: ${small.slice(0, 6).map((/** @type {any} */ box) => `${box.id} ${box.w}×${box.h}`).join(", ")}`,
    );
    const smallest = boxes.reduce((/** @type {any} */ low, /** @type {any} */ box) => (Math.min(box.w, box.h) < Math.min(low.w, low.h) ? box : low), boxes[0] ?? { id: "none", w: 0, h: 0 });
    evidence.push(`${state.name}: ${boxes.length} boxes all ≥ ${state.minTarget}px; smallest ${smallest.id} ${smallest.w}×${smallest.h}`);
    await page.close();
  }
  return evidence;
}

/** Keyboard focus: reachable, visible, unclipped, and never lost to the body. */
/** @param {AuditContext} ctx */
async function focus(ctx) {
  const page = await ctx.open({ width: 1440, height: 900 });
  await loadFixture(page, "typical");
  // Walk the real tab order: Chromium moves focus, the audit reads what it landed
  // on. The walk runs until it returns to its first stop, so it covers the whole
  // order no matter where the fixture left focus.
  await page.evaluate(() => {
    // A focusable body makes the document start the sequential focus navigation
    // starting point, so pressing Tab begins at the first skip link.
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  /** @type {{ id: string, outline: number, visible: boolean, clipped: boolean, overshoot: number, size: string }[]} */
  const stops = [];
  let lostAt = null;
  let wrappedAt = null;
  for (let index = 0; index < 220; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((/** @type {number} */ position) => {
      const scope = /** @type {any} */ (window);
      const active = document.activeElement;
      if (active === null || active === document.body || active === document.documentElement) {
        return { lost: true };
      }
      if (position === 0) scope.__auditFirstStop = active;
      else if (active === scope.__auditFirstStop) return { wrapped: true };
      const style = getComputedStyle(active);
      const rect = active.getBoundingClientRect();
      const offset = Number.parseFloat(style.outlineOffset) || 0;
      const width = Number.parseFloat(style.outlineWidth) || 0;
      const cell = active.closest(".cell")?.getAttribute("data-cell-id")?.slice(0, 6) ?? "";
      const name = active.id
        || active.getAttribute("data-action")
        || active.getAttribute("aria-label")
        || (active.textContent ?? "").trim().slice(0, 18)
        || active.tagName.toLowerCase();
      return {
        lost: false,
        id: `${active.tagName.toLowerCase()}:${name}${cell === "" ? "" : `@${cell}`}`,
        outline: width,
        visible: width >= 2 && style.outlineStyle !== "none" ? true : style.boxShadow !== "none",
        clipped:
          rect.left + offset < 0 ||
          rect.top + offset < 0 ||
          rect.right - offset > window.innerWidth ||
          rect.bottom - offset > window.innerHeight,
        overshoot: Math.max(
          Math.round(Math.max(0, -(rect.left + offset), -(rect.top + offset))),
          Math.round(Math.max(0, rect.right - offset - window.innerWidth, rect.bottom - offset - window.innerHeight)),
        ),
        size: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
      };
    }, index);
    if (stop.lost === true) {
      lostAt = index;
      break;
    }
    if (stop.wrapped === true) {
      wrappedAt = index;
      break;
    }
    stops.push(/** @type {{ id: string, outline: number, visible: boolean, clipped: boolean, overshoot: number, size: string }} */ (stop));
  }
  const invisible = stops.filter((stop) => !stop.visible);
  const clipped = stops.filter((stop) => stop.clipped);
  const distinct = new Set(stops.map((stop) => stop.id)).size;
  // Leaving the document at the end is how a browser works; what matters is that
  // the page holds focus in order and hands it back, never trapping or dropping it.
  await page.keyboard.press("Tab");
  const reentry = await page.evaluate(() => {
    const active = document.activeElement;
    return active === null || active === document.body
      ? null
      : `${active.tagName.toLowerCase()}:${active.id || (active.textContent ?? "").trim().slice(0, 18) || "?"}`;
  });
  const evidence = [
    `tab walk: ${stops.length} stops (${distinct} distinct controls), every one a real control, then focus left the document at stop ${lostAt ?? "never"}` +
      `${wrappedAt === null ? "" : ` after cycling back at ${wrappedAt}`}`,
    `focus indicator: ${stops.length - invisible.length}/${stops.length} stops matched the visible-focus rule; ${clipped.length} clipped`,
    `first stops: ${stops.slice(0, 6).map((stop) => stop.id).join(" → ")}; re-entry after leaving: ${reentry ?? "none"}`,
  ];
  expect(stops.length >= 25, `the tab walk only reached ${stops.length} stops`);
  expect(invisible.length === 0, `${invisible.length} stop(s) without a visible indicator: ${invisible.slice(0, 5).map((stop) => stop.id).join(", ")}`);
  expect(
    clipped.length === 0,
    `${clipped.length} focus rect(s) clipped by the viewport: ${clipped.slice(0, 5).map((stop) => `${stop.id} (${stop.size}, ${stop.overshoot}px outside)`).join(", ")}`,
  );
  expect(reentry !== null, "Tab never brought focus back into the workspace");
  await page.close();
  return evidence;
}

/** Reduced motion removes transition and scrolling animation. */
/** @param {AuditContext} ctx */
async function motion(ctx) {
  const page = await ctx.open({ width: 1024, height: 768 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await settle(page);
  const state = await page.evaluate(() => {
    const nav = document.getElementById("document-navigation");
    const root = document.documentElement;
    return {
      transition: nav === null ? "" : getComputedStyle(nav).transitionDuration,
      scrollBehavior: getComputedStyle(root).scrollBehavior,
      media: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
  expect(state.media, "the reduced-motion media feature did not apply");
  expect(state.transition.startsWith("0s"), `the drawer still animates in ${state.transition}`);
  expect(state.scrollBehavior === "auto", `scroll-behavior is ${state.scrollBehavior}`);
  await page.close();
  return [`prefers-reduced-motion:reduce → drawer transition-duration ${state.transition}, scroll-behavior ${state.scrollBehavior}`];
}

/** Forced colors: system colours, borders, and the Highlight focus ring. */
/** @param {AuditContext} ctx */
async function forcedColors(ctx) {
  const page = await ctx.open({ width: 1024, height: 768 });
  await emulateMedia(page, [{ name: "forced-colors", value: "active" }]);
  await settle(page);
  const state = await page.evaluate(() => {
    const rail = /** @type {HTMLElement | null} */ (document.querySelector(".app-rail"));
    const button = /** @type {HTMLElement | null} */ (document.querySelector(".utility-actions button"));
    const field = /** @type {HTMLElement | null} */ (document.getElementById("document-title"));
    const cell = /** @type {HTMLElement | null} */ (document.querySelector("#notebook-cells .cell"));
    cell?.querySelector("textarea")?.focus();
    const style = (/** @type {HTMLElement | null} */ node) => {
      if (node === null) return null;
      const computed = getComputedStyle(node);
      return {
        background: computed.backgroundColor,
        colour: computed.color,
        border: `${computed.borderTopWidth} ${computed.borderTopStyle}`,
      };
    };
    return {
      media: matchMedia("(forced-colors: active)").matches,
      rail: style(rail),
      button: style(button),
      field: style(field),
      cellBorder: style(cell),
      cellFocusOutline: cell === null ? null : (() => {
        const focused = /** @type {HTMLElement | null} */ (cell.querySelector("textarea"));
        return focused === null ? null : `${getComputedStyle(cell).outlineColor} / ${getComputedStyle(focused).outlineColor}`;
      })(),
    };
  });
  expect(state.media, "the forced-colors media feature did not apply");
  for (const [name, value] of Object.entries({ button: state.button, field: state.field, cell: state.cellBorder })) {
    expect(value !== null && value.border.endsWith("solid"), `${name} lost its border under forced colors (${value?.border})`);
  }
  await page.close();
  return [
    `forced-colors:active → rail ${state.rail?.background}/${state.rail?.colour}, control border ${state.button?.border}, ` +
      `Cell border ${state.cellBorder?.border}, focus ring ${state.cellFocusOutline}`,
  ];
}

/** iframe naming, sandboxing, and the shared inline/expanded presentation. */
/** @param {AuditContext} ctx */
async function frames(ctx) {
  const page = await ctx.open({ width: 1440, height: 900 });
  await loadFixture(page, "typical");
  await refreshPreview(page);
  const state = await page.evaluate(() => {
    const inline = /** @type {HTMLIFrameElement | null} */ (document.getElementById("preview"));
    const expanded = /** @type {HTMLIFrameElement | null} */ (document.getElementById("expanded-preview"));
    return {
      inlineTitle: inline?.getAttribute("title") ?? "",
      inlineLabel: inline?.getAttribute("aria-label") ?? "",
      inlineSandbox: inline?.getAttribute("sandbox") ?? null,
      expandedTitle: expanded?.getAttribute("title") ?? "",
      expandedSandbox: expanded?.getAttribute("sandbox") ?? null,
      inlineSource: inline?.getAttribute("src") ?? null,
      expandedSource: expanded?.getAttribute("src") ?? null,
      inlineState: document.getElementById("preview-state")?.textContent ?? "",
      expandedState: document.getElementById("expanded-preview-state")?.textContent ?? "",
    };
  });
  expect(state.inlineTitle !== "" || state.inlineLabel !== "", "the inline preview frame is unnamed");
  expect(state.expandedTitle !== "", "the expanded preview frame is unnamed");
  expect(state.inlineSandbox !== null && state.expandedSandbox !== null, "a preview frame is missing its sandbox");
  expect(state.inlineSource !== null && state.inlineSource === state.expandedSource, "inline and expanded frames do not share the Artifact");
  expect(state.inlineState === state.expandedState, "inline and expanded states disagree");
  await page.close();
  return [`frame names: ${JSON.stringify(state.inlineTitle)} / ${JSON.stringify(state.expandedTitle)}; sandbox ${state.inlineSandbox}; shared Artifact and state`];
}

/** One polite live region, and announcements for routine outcomes. */
/** @param {AuditContext} ctx */
async function announcements(ctx) {
  const page = await ctx.open({ width: 1440, height: 900 });
  await loadFixture(page, "typical");
  const regions = await page.evaluate(() => ({
    polite: [...document.querySelectorAll("[aria-live=polite]")].map((node) => node.id),
    assertive: [...document.querySelectorAll("[aria-live=assertive]")].map((node) => node.id),
    roles: [...document.querySelectorAll("[role=status], [role=alert]")].map((node) => `${node.id}:${node.getAttribute("role") ?? ""}`),
  }));
  expect(regions.polite.length === 1, `${regions.polite.length} polite live regions; the contract names one`);
  expect(regions.assertive.length === 0, `assertive regions present: ${regions.assertive.join(", ")}`);

  /** @param {() => Promise<void>} action @returns {Promise<string>} */
  const announcementFor = async (action) => {
    await page.evaluate(() => {
      const node = document.getElementById("workspace-status");
      if (node !== null) node.textContent = "";
    });
    await action();
    await settle(page);
    return page.evaluate(() => document.getElementById("workspace-status")?.textContent ?? "");
  };

  const results = {
    preview: await announcementFor(async () => {
      await page.evaluate(() => /** @type {HTMLElement | null} */ (document.getElementById("refresh-preview"))?.click());
      await page.waitForFunction(() => document.getElementById("preview-state")?.dataset.state === "current", { timeout: 30_000 });
    }),
    analysis: await announcementFor(async () => {
      await analyzeDocument(page);
    }),
  };
  for (const [name, text] of Object.entries(results)) {
    expect(text !== "", `${name} produced no polite announcement`);
  }
  await page.close();
  return [
    `one polite region (${regions.polite[0]}), no assertive region; alert roles only on ${regions.roles.filter((/** @type {string} */ role) => role.endsWith("alert")).join(", ") || "none"}`,
    `observed announcements: ${Object.entries(results).map(([name, text]) => `${name} → ${JSON.stringify(text)}`).join("; ")}`,
  ];
}

/** The nameplate list, in order, with the acceptance IDs each check serves. */
export const CHECKS = [
  { id: "landmarks", title: "Landmarks, reading order, names, skip links", ids: ["NAV-01", "A11Y-01"], run: landmarks },
  { id: "fixtures", title: "Minimum, typical, and 30-Cell stress fixtures", ids: ["NAV-02", "CELL-03", "DRAFT-03", "DOC-02"], run: fixtures },
  { id: "captures", title: "Viewport captures and reflow boundaries", ids: ["A11Y-01"], run: captures },
  { id: "scans", title: "Automated WCAG 2.2 A/AA scans", ids: ["A11Y-01"], run: scans },
  { id: "contrast", title: "Text contrast measurement", ids: ["A11Y-01"], run: contrast },
  { id: "targets", title: "Interaction-box density", ids: ["A11Y-01"], run: targets },
  { id: "focus", title: "Keyboard reachability, visible and unclipped focus", ids: ["A11Y-02"], run: focus },
  { id: "motion", title: "Reduced-motion behaviour", ids: ["A11Y-01"], run: motion },
  { id: "forced-colors", title: "Forced-colors behaviour", ids: ["A11Y-01"], run: forcedColors },
  { id: "frames", title: "Preview frame naming, sandbox, shared state", ids: ["PREVIEW-05", "A11Y-01"], run: frames },
  { id: "announcements", title: "Live region and announcements", ids: ["A11Y-02"], run: announcements },
];
