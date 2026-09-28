/**
 * The keyboard-only walkthrough of every essential workflow, in one pass over
 * a real page: search, outline navigation, Cell insert/move/delete/Undo, the
 * editor mode switch, generation and cancellation, the Draft Gate, preview
 * refresh/sizing/expansion, diagnostics navigation, format review, export,
 * the service dialog, and the preview frame.
 *
 * Activation is always a keyboard event. A control is reached by Tab when the
 * tab order allows it, and otherwise focused directly and then activated from
 * the keyboard; the record says which, so "keyboard-only" is never assumed.
 */

import { expect } from "../cli.mjs";
import { loadFixture, refreshPreview, settle, tabTo } from "./page.mjs";

/** @param {import("puppeteer-core").Page} page */
async function activeElement(page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    return {
      id: node?.id ?? "",
      role: node instanceof HTMLElement ? node.dataset.role ?? null : null,
      action: node instanceof HTMLElement ? node.dataset.action ?? null : null,
      label: node?.getAttribute("aria-label") ?? "",
      tag: node?.tagName ?? "",
      text: (node?.textContent ?? "").trim().slice(0, 40),
      cellId: node instanceof HTMLElement ? node.dataset.cellId ?? null : null,
    };
  });
}

/**
 * Reach a control and activate it with the keyboard, preferring Tab.
 * @param {import("puppeteer-core").Page} page @param {string} selector @param {string} [key]
 */
async function activate(page, selector, key = "Enter", budget = 120) {
  const reachedByTab = await tabTo(page, selector, budget);
  if (!reachedByTab) {
    await page.focus(selector);
    const matched = await page.evaluate((target) => document.activeElement?.matches(target) === true, selector);
    expect(matched, `${selector} cannot be focused`);
  }
  await page.keyboard.press(/** @type {any} */ (key));
  await settle(page);
  return reachedByTab ? "tab" : "focus";
}

/** @param {import("puppeteer-core").Page} page @param {string} text */
async function announce(page, text) {
  try {
    await page.waitForFunction(
      (expected) => (document.getElementById("workspace-status")?.textContent ?? "").includes(expected),
      { timeout: 30_000 },
      text,
    );
  } catch {
    const seen = await page.evaluate(() => ({
      announcement: document.getElementById("workspace-status")?.textContent ?? "",
      response: document.querySelector(".generation-response h3")?.textContent ?? "",
      proposal: document.querySelector("[data-proposal-cell] h3")?.textContent ?? "",
    }));
    throw new Error(
      `no announcement containing ${JSON.stringify(text)}; last announcement ${JSON.stringify(seen.announcement)}` +
        `${seen.response === "" ? "" : `, response ${JSON.stringify(seen.response)}`}` +
        `${seen.proposal === "" ? "" : `, proposal ${JSON.stringify(seen.proposal)}`}`,
    );
  }
  return page.evaluate(() => document.getElementById("workspace-status")?.textContent ?? "");
}

/** @type {{ name: string, ids: string[], run: (page: import("puppeteer-core").Page, ctx: any) => Promise<string> }[]} */
const STEPS = [
  {
    name: "skip links",
    ids: ["A11Y-01", "A11Y-02"],
    run: async (page) => {
      await page.keyboard.press("Tab");
      const first = await activeElement(page);
      expect(first.text === "Skip to editor", `the first Tab stop is ${JSON.stringify(first.text)}`);
      const injected = await page.evaluate(() => {
        const link = document.querySelector(".skip-link");
        return link === null ? "missing" : getComputedStyle(link).transform;
      });
      expect(injected === "none", `the skip link is not revealed on focus (${injected})`);
      await page.keyboard.press("Enter");
      await settle(page);
      const landed = await page.evaluate(() => ({
        id: document.activeElement?.id ?? "",
        tag: document.activeElement?.tagName ?? "",
      }));
      expect(landed.id === "cell-canvas", `Skip to editor landed on ${landed.id || landed.tag}`);
      let editor = await activeElement(page);
      for (let step = 0; step < 12 && editor.role !== "source" && editor.tag !== "TEXTAREA"; step += 1) {
        await page.keyboard.press("Tab");
        await settle(page);
        editor = await activeElement(page);
      }
      expect(editor.role === "source" || editor.tag === "TEXTAREA", `Tabbing from the Cell canvas never reached the editor (stopped on ${editor.role ?? editor.tag})`);
      return `first Tab stop is the revealed skip link; Enter moved focus to #${landed.id} and one more Tab reached the Cell editor (${editor.role ?? editor.tag})`;
    },
  },
  {
    name: "drawer",
    ids: ["NAV-03", "A11Y-02"],
    run: async (page) => {
      await page.setViewport({ width: 1024, height: 768 });
      await settle(page);
      const reached = await activate(page, "#open-document-nav");
      const open = await page.evaluate(() => ({
        open: document.getElementById("workspace")?.dataset.navOpen === "true",
        inert: document.getElementById("main-workspace")?.inert === true,
        focused: document.activeElement?.id ?? "",
      }));
      expect(open.open && open.inert, "the drawer did not open over an inert workspace");
      expect(open.focused === "document-nav-title", `the drawer opened with focus on ${open.focused || "nothing"}`);
      await page.keyboard.press("Escape");
      await settle(page);
      const closed = await activeElement(page);
      expect(closed.id === "open-document-nav", `Escape left focus on ${closed.id || "nothing"}`);
      return `drawer opened by ${reached} with heading focus and an inert workspace; Escape closed it and restored #${closed.id}`;
    },
  },
  {
    name: "search and outline",
    ids: ["NAV-03", "NAV-02"],
    run: async (page) => {
      await page.setViewport({ width: 1440, height: 900 });
      await loadFixture(page, "typical");
      const reachedSearch = await tabTo(page, "#cell-search", 120);
      expect(reachedSearch, "Tab never reached the search field");
      await page.keyboard.type("Thermal");
      await settle(page);
      const filtered = await page.evaluate(() => ({
        entries: document.querySelectorAll("#cell-list button").length,
        result: document.getElementById("search-result")?.textContent ?? "",
        cells: document.querySelectorAll("#notebook-cells .cell").length,
        origin: document.querySelector("#cell-list button small")?.textContent ?? "",
      }));
      expect(filtered.entries === 1 && filtered.cells === 4, `search filtered ${filtered.entries} outline entries and ${filtered.cells} Cells`);
      expect(filtered.result.includes("1 matching"), `search result reads ${JSON.stringify(filtered.result)}`);
      expect(filtered.origin.includes("match"), `the match origin is not exposed: ${JSON.stringify(filtered.origin)}`);
      const searchReach = "tab";
      await page.keyboard.press("Tab");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await settle(page);
      const focused = await activeElement(page);
      expect(focused.role === "source", `outline Enter focused ${focused.role ?? focused.tag}`);
      await page.focus("#cell-search");
      await page.keyboard.type("zzzz");
      await settle(page);
      const empty = await page.evaluate(() => ({
        result: document.getElementById("search-result")?.textContent ?? "",
        entries: document.querySelectorAll("#cell-list button").length,
      }));
      expect(empty.result === "No matching cells", `empty search reads ${JSON.stringify(empty.result)}`);
      await page.keyboard.press("Escape");
      await settle(page);
      const cleared = await page.evaluate(() => ({
        entries: document.querySelectorAll("#cell-list button").length,
        value: /** @type {HTMLInputElement | null} */ (document.getElementById("cell-search"))?.value,
      }));
      expect(cleared.entries === 4 && cleared.value === "", "Escape did not clear the query and restore the outline");
      return `search filtered the outline only (1 of 4 entries, 4 Cells rendered) and reported the origin; ArrowDown+Enter focused the Cell editor (${searchReach}); "No matching cells" then Escape restored all ${cleared.entries} entries`;
    },
  },
  {
    name: "Cell insert, move, delete, undo",
    ids: ["CELL-01"],
    run: async (page) => {
      await loadFixture(page, "typical");
      const before = await page.evaluate(() => document.querySelectorAll("#notebook-cells .cell").length);
      await activate(page, "#add-cell-bottom");
      const added = await activeElement(page);
      expect(added.role === "source", `insert focused ${added.role ?? added.tag}`);
      const afterInsert = await page.evaluate(() => document.querySelectorAll("#notebook-cells .cell").length);
      expect(afterInsert === before + 1, `insert produced ${afterInsert} Cells`);
      const moved = await activate(page, '[data-action="move-up"]:not([disabled])');
      expect(moved === "tab" || moved === "focus", "move-up was not activated");
      const afterMove = await activeElement(page);
      expect(afterMove.role === "source", `move left focus on ${afterMove.role ?? afterMove.tag}`);
      await activate(page, '[data-action="delete"]:not([disabled])');
      const afterDelete = await page.evaluate(() => ({
        cells: document.querySelectorAll("#notebook-cells .cell").length,
        undo: document.getElementById("undo-bar")?.hidden === false,
        focused: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.role ?? document.activeElement.id : "",
      }));
      expect(afterDelete.cells === afterInsert - 1, `delete left ${afterDelete.cells} Cells`);
      expect(afterDelete.undo, "delete did not offer Undo");
      expect(afterDelete.focused !== "", "focus disappeared after delete");
      await activate(page, "#undo-delete");
      const restored = await page.evaluate(() => ({
        cells: document.querySelectorAll("#notebook-cells .cell").length,
        undo: document.getElementById("undo-bar")?.hidden === false,
        focus: (document.activeElement?.textContent ?? "").trim().slice(0, 30),
        cellFocused: document.activeElement?.closest(".cell")?.getAttribute("data-cell-id") ?? null,
      }));
      expect(restored.cells === before + 1, `Undo restored ${restored.cells} Cells`);
      expect(!restored.undo, "the Undo bar stayed visible after Undo");
      expect(restored.cellFocused !== null, `Undo left focus outside the Cell (${restored.focus})`);
      return `insert focused the new editor; move kept editor focus; delete focused the following Cell and offered Undo; Undo restored ${restored.cells} Cells with focus on the restored Cell's heading`;
    },
  },
  {
    name: "editor mode switch",
    ids: ["CELL-03", "A11Y-02"],
    run: async (page) => {
      await loadFixture(page, "typical");
      await page.focus('[data-action="mode-source"][data-cell-id]');
      await page.keyboard.press("ArrowRight");
      const arrowed = await activeElement(page);
      expect(arrowed.action === "mode-description", `ArrowRight moved focus to ${arrowed.action ?? arrowed.tag}`);
      await page.keyboard.press("Enter");
      await settle(page);
      const switched = await page.evaluate(() => {
        const first = document.querySelector("#notebook-cells .cell");
        return {
          descriptionVisible: first?.querySelector("[data-panel=description]")?.hasAttribute("hidden") === false,
          selected: first?.querySelector('[data-action="mode-description"]')?.getAttribute("aria-selected") ?? "",
        };
      });
      expect(switched.descriptionVisible && switched.selected === "true", "the mode switch did not reveal the Description panel");
      await page.keyboard.press("Home");
      await settle(page);
      const back = await page.evaluate(() => document.querySelector("#notebook-cells .cell")?.querySelector("[data-panel=source]")?.hasAttribute("hidden") === false);
      expect(back === true, "Home did not return the tab list to Source");
      return "Left/Right moved the tab-list roving focus; Enter activated Description; Home returned to Source, both with aria-selected tracking";
    },
  },
  {
    name: "generation and cancellation",
    ids: ["DRAFT-01"],
    run: async (page) => {
      await loadFixture(page, "typical");
      await page.evaluate(() => {
        const id = document.querySelector("#notebook-cells .cell")?.getAttribute("data-cell-id") ?? "";
        /** @type {HTMLElement | null} */ (document.querySelector(`[data-action="mode-description"][data-cell-id="${id}"]`))?.click();
        const area = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`[data-role=description][data-cell-id="${id}"]`));
        if (area !== null) {
          area.focus();
          area.value = "Write a slow short worked example.";
          area.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await settle(page);
      await activate(page, '[data-action="generate"]:not([disabled])');
      const locked = await page.evaluate(() => ({
        locked: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("#notebook-cells [data-role=source]"))?.disabled === true,
        addCell: /** @type {HTMLButtonElement | null} */ (document.getElementById("add-cell"))?.disabled === true,
        field: /** @type {HTMLInputElement | null} */ (document.getElementById("document-title"))?.disabled === true,
        cancel: document.activeElement?.textContent?.includes("Cancel generation") === true,
        outlineUsable: /** @type {HTMLButtonElement | null} */ (document.querySelector("#cell-list button"))?.disabled === false,
      }));
      expect(locked.locked && locked.addCell && locked.field, "generation did not lock the document controls");
      expect(locked.cancel, "focus did not move to Cancel generation");
      expect(locked.outlineUsable, "generation disabled outline navigation");
      await activate(page, '[data-action="cancel-generation"]');
      const cancelled = await page.evaluate(() => ({
        textarea: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("#notebook-cells [data-role=description]"))?.value ?? "",
        focusedRole: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.role ?? null : null,
      }));
      expect(cancelled.textarea === "Write a slow short worked example.", "cancellation lost the Pending Description");
      expect(cancelled.focusedRole !== null, "cancellation left focus outside the editor");
      return `generate locked Source, Add Cell, and Document details while the outline stayed usable and focus moved to Cancel; cancelling restored Description focus and kept the Pending Description`;
    },
  },
  {
    name: "Draft Gate",
    ids: ["DRAFT-01", "DRAFT-02", "DRAFT-03"],
    run: async (page) => {
      await loadFixture(page, "typical");
      await page.evaluate(() => {
        const id = document.querySelector("#notebook-cells .cell")?.getAttribute("data-cell-id") ?? "";
        /** @type {HTMLElement | null} */ (document.querySelector(`[data-action="mode-description"][data-cell-id="${id}"]`))?.click();
        const area = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`[data-role=description][data-cell-id="${id}"]`));
        if (area !== null) {
          area.focus();
          area.value = "Explain it plainly.";
          area.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await settle(page);
      await activate(page, '[data-action="generate"]:not([disabled])');
      await announce(page, "Proposed Source is ready for review");
      const gate = await page.evaluate(() => ({
        status: document.querySelector("[data-proposal-cell] h3")?.textContent ?? "",
        applyDisabled: /** @type {HTMLButtonElement | null} */ (document.querySelector('[data-action="apply-proposal"]'))?.disabled === false,
        reviewed: /** @type {HTMLElement | null} */ (document.querySelector('[data-action="review-proposal"]')) !== null,
      }));
      expect(gate.status.startsWith("Draft Gate · valid"), `Draft Gate status is ${JSON.stringify(gate.status)}`);
      expect(gate.applyDisabled && gate.reviewed, "the Draft Gate is missing Apply or review");
      await activate(page, '[data-action="discard-proposal"]');
      const discarded = await page.evaluate(() => ({
        descriptionVisible: document.querySelector("#notebook-cells [data-panel=description]")?.hasAttribute("hidden") === false,
        description: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("#notebook-cells [data-role=description]"))?.value ?? "",
        proposal: document.querySelector("[data-proposal-cell]") !== null,
      }));
      expect(!discarded.proposal, "Discard left the proposal panel behind");
      expect(discarded.descriptionVisible && discarded.description === "Explain it plainly.", "Discard did not return to Description with the Pending Description");
      await activate(page, '[data-action="generate"]:not([disabled])');
      await announce(page, "Proposed Source is ready for review");
      await activate(page, '[data-action="apply-proposal"]');
      await announce(page, "Proposed Source applied");
      const applied = await activeElement(page);
      expect(applied.role === "source", `Apply left focus on ${applied.role ?? applied.tag}`);
      const selection = await page.evaluate(() => {
        const area = /** @type {HTMLTextAreaElement | null} */ (document.activeElement);
        return [area?.selectionStart ?? null, area?.selectionEnd ?? null];
      });
      expect(selection[0] === 0, `Apply focused offset ${selection[0]}`);
      return `generation produced a valid Draft Gate with Apply disabled-until-valid and a review affordance; Discard restored Description and the Pending Description; Apply replaced the Source, focused its start (${selection.join("-")}), and announced`;
    },
  },
  {
    name: "front matter boundary",
    ids: ["CELL-02"],
    run: async (page) => {
      await loadFixture(page, "typical");
      const before = await page.evaluate(() => ({
        title: /** @type {HTMLInputElement | null} */ (document.getElementById("document-title"))?.value ?? "",
        authors: /** @type {HTMLTextAreaElement | null} */ (document.getElementById("document-author"))?.value ?? "",
        date: /** @type {HTMLInputElement | null} */ (document.getElementById("document-date"))?.value ?? "",
      }));
      await page.evaluate(() => {
        const area = /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"));
        if (area === null) return;
        area.focus();
        area.value = "---\nazemark: 2\ntitle: Pasted title\nauthor:\n  - Pasted author\n---\n\n# Body only\n";
        area.dispatchEvent(new Event("input", { bubbles: true }));
        area.blur();
      });
      await announce(page, "Front matter removed from the Cell");
      const after = await page.evaluate(() => ({
        source: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"))?.value ?? "",
        title: /** @type {HTMLInputElement | null} */ (document.getElementById("document-title"))?.value ?? "",
        authors: /** @type {HTMLTextAreaElement | null} */ (document.getElementById("document-author"))?.value ?? "",
        date: /** @type {HTMLInputElement | null} */ (document.getElementById("document-date"))?.value ?? "",
      }));
      expect(after.source.trim() === "# Body only", `the Cell kept ${JSON.stringify(after.source)}`);
      expect(
        after.title === before.title && after.authors === before.authors && after.date === before.date,
        "pasted front matter leaked into Document details",
      );
      return `pasted front matter was stripped to "${after.source.trim()}" and announced; Document details stayed ${JSON.stringify(after.title)} / ${JSON.stringify(after.authors)} / ${JSON.stringify(after.date)}`;
    },
  },
  {
    name: "generation responses",
    ids: ["DRAFT-04"],
    run: async (page) => {
      await loadFixture(page, "typical");
      /** @param {string} description */
      const describe = async (description) => {
        await page.evaluate((value) => {
          const id = document.querySelector("#notebook-cells .cell")?.getAttribute("data-cell-id") ?? "";
          /** @type {HTMLElement | null} */ (document.querySelector(`[data-action="mode-description"][data-cell-id="${id}"]`))?.click();
          const area = /** @type {HTMLTextAreaElement | null} */ (document.querySelector(`[data-role=description][data-cell-id="${id}"]`));
          if (area === null) return;
          area.focus();
          area.value = value;
          area.dispatchEvent(new Event("input", { bubbles: true }));
        }, description);
        await settle(page);
        await activate(page, '[data-action="generate"]:not([disabled])');
      };
      const panel = async () => page.evaluate(() => {
        const section = document.querySelector(".generation-response");
        return {
          heading: section?.querySelector("h3")?.textContent ?? "",
          message: section?.querySelector("p")?.textContent ?? "",
          action: section?.querySelector("button")?.textContent ?? "",
          proposal: document.querySelector("[data-proposal-cell]") !== null,
        };
      });

      await describe("clarify the audience");
      await announce(page, "Which audience should this target?");
      const clarification = await panel();
      expect(!clarification.proposal, "a clarification opened a Draft Gate");
      expect(clarification.heading === "Clarification needed" && clarification.action === "Revise Description", `clarification rendered as ${JSON.stringify(clarification)}`);
      await activate(page, '[data-action="revise-description"]');
      const revised = await page.evaluate(() => ({
        description: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=description]"))?.value ?? "",
        panel: document.querySelector(".generation-response") !== null,
      }));
      expect(revised.panel === false && revised.description === "clarify the audience", "Revise Description lost the Pending Description");

      await describe("refuse this request");
      await announce(page, "outside the supported catalogue");
      const refusal = await panel();
      expect(refusal.heading === "Request refused" && refusal.action === "Dismiss", `refusal rendered as ${JSON.stringify(refusal)}`);
      await activate(page, '[data-action="dismiss-response"]');
      expect((await panel()).heading === "", "Dismiss left the refusal panel");

      await describe("fail this request");
      await announce(page, "Generation failed");
      const failure = await panel();
      expect(failure.heading === "Generation failed" && failure.action === "Return to Description", `failure rendered as ${JSON.stringify(failure)}`);
      const gate = await page.evaluate(() => document.querySelector("[data-proposal-cell]") !== null);
      expect(!gate, "a failed generation left a Draft Gate open");
      return `clarification ("${clarification.message}") offered Revise Description and kept the Pending Description; refusal offered Dismiss; provider failure offered Return to Description — none opened a Draft Gate`;
    },
  },
  {
    name: "preview refresh, sizing, expansion",
    ids: ["PREVIEW-01", "PREVIEW-04", "PREVIEW-05"],
    run: async (page) => {
      await loadFixture(page, "typical");
      const jobsBefore = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/v1/jobs")).length);
      await page.evaluate(() => {
        const area = /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"));
        if (area !== null) {
          area.focus();
          area.value = `${area.value}\n`;
          area.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await settle(page);
      const jobsAfterEdit = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/v1/jobs")).length);
      expect(jobsAfterEdit === jobsBefore, `an edit issued ${jobsAfterEdit - jobsBefore} compile request(s)`);
      const state = await refreshPreview(page);
      expect(state.state === "current", `refresh settled at ${state.state}`);
      await page.evaluate(() => document.getElementById("preview-separator")?.focus());
      const separator = async () => page.evaluate(() => ({
        min: document.getElementById("preview-separator")?.getAttribute("aria-valuemin") ?? "",
        max: document.getElementById("preview-separator")?.getAttribute("aria-valuemax") ?? "",
        now: document.getElementById("preview-separator")?.getAttribute("aria-valuenow") ?? "",
      }));
      const start = await separator();
      await page.keyboard.press("Home");
      const atMin = await separator();
      await page.keyboard.press("End");
      const atMax = await separator();
      await page.keyboard.press("ArrowUp");
      const raised = await separator();
      expect(atMin.now === atMin.min, `Home landed at ${atMin.now} instead of ${atMin.min}`);
      expect(atMax.now === atMax.max, `End landed at ${atMax.now} instead of ${atMax.max}`);
      expect(Number(raised.now) === Number(atMax.now) - 16, `ArrowUp moved to ${raised.now}`);
      const expanded = await activate(page, "#expand-preview");
      const dialog = await page.evaluate(() => ({
        open: /** @type {HTMLDialogElement | null} */ (document.getElementById("preview-dialog"))?.open === true,
        inside: document.getElementById("preview-dialog")?.contains(document.activeElement) === true,
        shared: document.getElementById("preview")?.getAttribute("src") === document.getElementById("expanded-preview")?.getAttribute("src"),
      }));
      expect(dialog.open && dialog.inside && dialog.shared, "the expanded preview did not open with shared state and contained focus");
      await page.keyboard.press("Escape");
      await settle(page);
      const closed = await activeElement(page);
      expect(closed.id === "refresh-preview", `Escape left focus on ${closed.id || "nothing"}`);
      return `an edit issued no compile request; refresh reached "current"; separator moved from ${start.now} through Home ${atMin.min} and End ${atMax.max} to ${raised.now} (opened by ${expanded}); the expanded preview shared the Artifact, contained focus, and Escape restored #${closed.id}`;
    },
  },
  {
    name: "preview failure retains the Artifact",
    ids: ["PREVIEW-03"],
    run: async (page) => {
      await loadFixture(page, "typical");
      const current = await refreshPreview(page);
      expect(current.state === "current", `the first refresh settled at ${current.state}`);
      const loaded = await page.evaluate(() => document.getElementById("preview")?.getAttribute("src") ?? null);
      expect(loaded !== null, "the first refresh produced no Artifact");
      await loadFixture(page, "stress");
      const jobs = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/v1/jobs")).length);
      const blocked = await refreshPreview(page);
      const after = await page.evaluate(() => ({
        src: document.getElementById("preview")?.getAttribute("src") ?? null,
        artifactVisible: document.getElementById("preview")?.hidden === false,
        recovery: document.getElementById("view-preview-diagnostics")?.hidden === false,
        jobs: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/v1/jobs")).length,
      }));
      expect(blocked.state === "blocked", `the failing refresh settled at ${blocked.state}`);
      expect(after.src === loaded, "the failing refresh discarded the previous Artifact");
      expect(after.artifactVisible, "the retained Artifact is not visible");
      expect(after.recovery, "the blocked preview offers no diagnostics recovery");
      expect(after.jobs > jobs, "the failing refresh issued no compile request");
      return `a refresh over an invalid document reported "${blocked.message}" and kept the previous Artifact visible with the diagnostics action, without discarding or re-fetching it`;
    },
  },
  {
    name: "diagnostics navigation",
    ids: ["DOC-02", "DOC-01"],
    run: async (page) => {
      // A warning-only analysis must not steal focus.
      await loadFixture(page, "typical");
      await page.evaluate(() => {
        /** @type {HTMLElement | null} */ (document.getElementById("more-toggle"))?.click();
        /** @type {HTMLElement | null} */ (document.getElementById("analyze"))?.click();
      });
      await announce(page, "Analysis complete with diagnostics");
      const warningOnly = await page.evaluate(() => ({
        open: document.getElementById("diagnostics-panel")?.hidden === false,
        summary: document.getElementById("diagnostics-summary")?.textContent ?? "",
        details: /** @type {HTMLDetailsElement | null} */ (document.getElementById("document-details"))?.open === true,
        invalid: document.getElementById("document-date")?.getAttribute("aria-invalid") ?? "",
        describedBy: document.getElementById("document-date")?.getAttribute("aria-describedby") ?? "",
        feedback: document.getElementById("feedback-date")?.textContent ?? "",
      }));
      expect(!warningOnly.open, "a warning-only analysis opened the dock and moved focus");
      expect(warningOnly.summary.includes("warning"), `the summary reads ${JSON.stringify(warningOnly.summary)}`);
      expect(warningOnly.details, "a metadata diagnostic did not expand Document details");
      expect(warningOnly.invalid === "true" && warningOnly.describedBy !== "", "the invalid field exposes no programmatic invalid state");
      expect(warningOnly.feedback !== "", "the invalid field has no local feedback");

      // Opening the dock by keyboard: non-modal, Escape restores the trigger.
      const reachedToggle = await activate(page, "#diagnostics-toggle");
      const opened = await page.evaluate(() => document.activeElement?.id ?? "");
      expect(opened === "diagnostics-title", `the dock opened with focus on ${opened || "nothing"}`);
      const left = await tabTo(page, "#cell-list button", 60);
      expect(left, `the ${reachedToggle === "tab" ? "Tab-walked" : "focused"} dock trapped focus`);
      await page.focus("#diagnostics-title");
      await page.keyboard.press("Escape");
      await settle(page);
      const closed = await page.evaluate(() => ({
        focused: document.activeElement?.id ?? "",
        hidden: document.getElementById("diagnostics-panel")?.hidden === true,
      }));
      expect(closed.hidden, "Escape did not close the dock");
      expect(closed.focused === "diagnostics-toggle", `Escape left focus on ${closed.focused || "nothing"}`);

      // Exact activation focuses the metadata field.
      await page.focus("#diagnostics-toggle");
      await page.keyboard.press("Enter");
      await settle(page);
      await activate(page, "#diagnostics-list button[data-diagnostic]");
      const targeted = await page.evaluate(() => ({
        panelOpen: document.getElementById("diagnostics-panel")?.hidden === false,
        focused: document.activeElement?.id ?? "",
        details: /** @type {HTMLDetailsElement | null} */ (document.getElementById("document-details"))?.open === true,
      }));
      expect(targeted.panelOpen, "activating an entry closed the dock");
      expect(targeted.focused === "document-date", `exact activation focused ${targeted.focused || "nothing"}`);
      expect(targeted.details, "exact activation left Document details collapsed");

      // An error analysis takes the author to the dock by itself.
      await loadFixture(page, "stress");
      await page.evaluate(() => {
        /** @type {HTMLElement | null} */ (document.getElementById("more-toggle"))?.click();
        /** @type {HTMLElement | null} */ (document.getElementById("analyze"))?.click();
      });
      // Wait for the analysis itself: the dock may already be open from the
      // previous assertion, so its visibility is not the signal.
      await page.waitForFunction(
        () => (document.getElementById("diagnostics-title")?.textContent ?? "") === "40 diagnostics",
        { timeout: 30_000 },
      );
      await settle(page);
      const errored = await page.evaluate(() => ({
        focused: document.activeElement?.id ?? "",
        summary: document.getElementById("diagnostics-summary")?.textContent ?? "",
        open: document.getElementById("diagnostics-panel")?.hidden === false,
      }));
      expect(errored.open, "an author-initiated analysis with errors did not reveal the dock");
      expect(errored.focused === "more-toggle", `analysis moved focus to ${errored.focused || "nothing"} instead of retaining the initiating surface`);
      return `a warning-only analysis left the dock closed (summary "${warningOnly.summary}") while expanding Document details and marking the Date field invalid with described feedback; the summary trigger opened the dock with heading focus and Tab could leave it; Escape closed it and restored #diagnostics-toggle; activating the entry focused the Date field; an error analysis (${errored.summary}) revealed the dock and retained focus on the initiating surface (#${errored.focused})`;
    },
  },
  {
    name: "format review",
    ids: ["FORMAT-01"],
    run: async (page) => {
      await loadFixture(page, "typical");
      // Document-wide formatting keeps one top-level heading per Cell, which is
      // the shape the Cell-boundary guard preserves; give every Cell one.
      await page.evaluate(() => {
        const areas = /** @type {HTMLTextAreaElement[]} */ ([...document.querySelectorAll("[data-role=source]")]);
        areas.forEach((area, index) => {
          area.focus();
          area.value = `# Cell ${index + 1}\n\nBody ${index + 1}.`;
          area.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
      await settle(page);
      const before = await page.evaluate(() => /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"))?.value ?? "");
      await activate(page, "#more-toggle", "Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await settle(page);
      await page.waitForFunction(() => document.querySelector("#proposal-dialog")?.hasAttribute("open") === true, { timeout: 30_000 });
      const dialog = await page.evaluate(() => ({
        title: document.getElementById("proposal-title")?.textContent ?? "",
        message: document.getElementById("proposal-message")?.textContent ?? "",
        inside: document.getElementById("proposal-dialog")?.contains(document.activeElement) === true,
        source: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"))?.value ?? "",
      }));
      expect(dialog.title === "Formatted Source", `the review dialog is titled ${JSON.stringify(dialog.title)}`);
      expect(!/ai\b|generated by/i.test(dialog.message), `the review is AI-labelled: ${JSON.stringify(dialog.message)}`);
      expect(dialog.source === before, "Format changed the Source before Apply");
      await page.keyboard.press("Escape");
      await settle(page);
      const escaped = await activeElement(page);
      expect(escaped.id === "more-toggle", `Escape left focus on ${escaped.id || "nothing"}`);
      const afterEscape = await page.evaluate(() => /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-role=source]"))?.value ?? "");
      expect(afterEscape === before, "Escape applied the Formatted Source");
      await activate(page, "#more-toggle", "Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#proposal-dialog")?.hasAttribute("open") === true, { timeout: 30_000 });
      await activate(page, "#apply-format");
      await announce(page, "Formatted Source applied");
      const applied = await activeElement(page);
      expect(applied.role === "source", `Apply left focus on ${applied.role ?? applied.tag}`);
      return `Format opened a compiler-labelled "Formatted Source" review with focus inside and the Source untouched; Escape discarded nothing and restored the invoking control; Apply replaced the Source and focused it`;
    },
  },
  {
    name: "export",
    ids: ["EXPORT-01", "EXPORT-02"],
    run: async (page, ctx) => {
      await loadFixture(page, "typical");
      await activate(page, "#export-toggle", "Enter");
      const menu = await page.evaluate(() => ({
        focused: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.format ?? document.activeElement.id : "",
        items: [...document.querySelectorAll("#export-menu button")].map((button) => button.textContent ?? ""),
      }));
      expect(menu.focused === "html", `the Export menu opened on ${menu.focused || "nothing"}`);
      const downloads = await ctx.downloads(page);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      const progress = await page.evaluate(() => [...document.querySelectorAll("#export-menu button")].map((button) => button.textContent ?? ""));
      expect(progress.some((item) => item.includes("exporting")), `no per-item progress: ${JSON.stringify(progress)}`);
      const done = await announce(page, "export complete");
      const files = await downloads.waitFor();
      expect(files.length === 1, `export downloaded ${files.length} files`);
      const restored = await activeElement(page);
      expect(restored.id === "export-toggle", `export left focus on ${restored.id || "nothing"}`);

      // Invalid Source: blocked, with diagnostics as the recovery.
      await loadFixture(page, "stress");
      await page.focus("#export-toggle");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await announce(page, "Export blocked by Source errors");
      const blocked = await page.evaluate(() => ({
        item: [...document.querySelectorAll("#export-menu button")].find((button) => (/** @type {HTMLElement} */ (button)).dataset.format === "html")?.textContent ?? "",
        diagnostics: document.getElementById("diagnostics-panel")?.hidden === false,
        announcement: document.getElementById("workspace-status")?.textContent ?? "",
        focused: document.activeElement?.id ?? "",
      }));
      expect(blocked.item.includes("failed"), `the owning item reads ${JSON.stringify(blocked.item)}`);
      expect(blocked.diagnostics, "a blocked export did not open diagnostics");
      expect(blocked.focused === "export-toggle", `a blocked export moved focus to ${blocked.focused || "nothing"}`);
      const afterBlocked = await downloads.waitFor(1_500);
      expect(afterBlocked.length === files.length, "a blocked export still downloaded bytes");
      return `Export opened on the first item with ${menu.items.length} capability-advertised formats; the chosen item showed per-item progress then "${done}" with one download and focus back on the trigger; the error fixture blocked export (item "${blocked.item}"), revealed diagnostics without taking focus (#${blocked.focused}), and downloaded nothing — keyboard throughout`;
    },
  },
  {
    name: "service dialog",
    ids: ["SERVICE-01"],
    run: async (page) => {
      await activate(page, "#service-health");
      const opened = await page.evaluate(() => ({
        open: /** @type {HTMLDialogElement | null} */ (document.getElementById("service-dialog"))?.open === true,
        inside: document.getElementById("service-dialog")?.contains(document.activeElement) === true,
        meta: document.getElementById("service-meta")?.textContent ?? "",
        label: document.getElementById("service-health")?.getAttribute("aria-label") ?? "",
      }));
      expect(opened.open, "the service dialog did not open");
      expect(opened.inside, "focus stayed outside the service dialog");
      expect(opened.meta.length > 0, "the service dialog shows no details");
      await page.keyboard.press("Escape");
      await settle(page);
      const closed = await page.evaluate(() => ({
        open: /** @type {HTMLDialogElement | null} */ (document.getElementById("service-dialog"))?.open === true,
        focused: document.activeElement?.id ?? "",
      }));
      expect(!closed.open, "Escape did not close the service dialog");
      expect(closed.focused === "service-health", `Escape left focus on ${closed.focused || "nothing"}`);
      return `health opened progressively disclosed details (rail label ${JSON.stringify(opened.label)}) with focus inside; Escape closed it and restored the trigger`;
    },
  },
  {
    name: "preview frame navigation",
    ids: ["A11Y-02"],
    run: async (page) => {
      await loadFixture(page, "typical");
      await refreshPreview(page);
      await page.focus("#refresh-preview");
      let entered = false;
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(() => {
          const frame = /** @type {HTMLIFrameElement | null} */ (document.getElementById("preview"));
          return frame !== null && frame.contentDocument !== null && frame.contentDocument.hasFocus();
        });
        if (inside) {
          entered = true;
          break;
        }
      }
      const leftFrame = async () => {
        for (let step = 0; step < 6; step += 1) {
          await page.keyboard.press("Tab");
          const outside = await page.evaluate(() => /** @type {HTMLIFrameElement | null} */ (document.getElementById("preview"))?.contentDocument?.hasFocus() === false);
          if (outside) return true;
        }
        return false;
      };
      const escaped = entered ? await leftFrame() : true;
      const landed = await activeElement(page);
      expect(escaped && landed.tag !== "BODY", "focus could not leave the preview frame");
      return entered
        ? `Tab reached the rendered preview frame and left it again, continuing to ${landed.id || landed.tag} — no iframe trap`
        : `the preview frame is skipped by Tab (frame content is not a Tab stop), and the walk continued to ${landed.id || landed.tag}`;
    },
  },
];

/** The walkthrough, as one check with a step-by-step record. */
export const WORKFLOW_CHECK = {
  id: "workflows",
  title: "Keyboard-only essential workflows",
  // Exactly the IDs its steps cite, so traceability cannot drift from the walk.
  ids: [...new Set(STEPS.flatMap((step) => step.ids))].sort(),
  /** @param {any} ctx */
  run: async (ctx) => {
    const page = await ctx.open({ width: 1440, height: 900 });
    /** @type {string[]} */
    const evidence = [];
    try {
      for (const step of STEPS) {
        try {
          const line = await step.run(page, ctx);
          evidence.push(`${step.name} [${step.ids.join(", ")}]: ${line}`);
        } catch (error) {
          throw new Error(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      await page.close();
    }
    return evidence;
  },
};
