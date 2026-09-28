/**
 * Page-level helpers the workspace checks share: building a deterministic
 * fixture through the authoring controls, and reading back what the workspace
 * put on the screen.
 *
 * Every probe runs in the page. Nothing here reaches into the app's modules:
 * the audit sees only the DOM the product renders, which is what the
 * acceptance criteria are about.
 */

import { FIXTURES } from "./fixtures.mjs";

/**
 * Build a fixture through the real controls: set Document details, add or
 * remove Cells, then set each Cell's Source and Pending Description.
 * @param {import("puppeteer-core").Page} page @param {import("./fixtures.mjs").FixtureId} id
 */
export async function loadFixture(page, id) {
  const fixture = FIXTURES[id];
  await page.evaluate((data) => {
    const set = (/** @type {string} */ elementId, /** @type {string} */ value) => {
      const node = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (document.getElementById(elementId));
      if (node === null) throw new Error(`missing #${elementId}`);
      node.focus();
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("document-title", data.title);
    set("document-author", data.authors.join("\n"));
    set("document-date", data.date);
    set("document-metadata", data.metadata);
    const theme = /** @type {HTMLSelectElement | null} */ (document.getElementById("theme"));
    if (theme !== null && theme.value !== data.theme) {
      theme.value = data.theme;
      theme.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const cells = () => /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#notebook-cells .cell")]);
    while (cells().length > data.cells.length) {
      const last = cells().at(-1);
      const id = last?.dataset.cellId;
      const button = /** @type {HTMLElement | null} */ (last?.querySelector(`[data-action=delete][data-cell-id="${id}"]`));
      if (button === null) throw new Error("no delete control on the last Cell");
      button.click();
    }
    while (cells().length < data.cells.length) {
      const add = /** @type {HTMLElement | null} */ (document.getElementById("add-cell-bottom"));
      if (add === null) throw new Error("no Add Cell control");
      add.click();
    }
    const rendered = cells();
    data.cells.forEach((cell, index) => {
      const node = rendered[index];
      const cellId = node?.dataset.cellId ?? "";
      const source = /** @type {HTMLTextAreaElement | null} */ (node?.querySelector('[data-role=source]'));
      if (source === null) throw new Error(`no Source editor for Cell ${index + 1}`);
      source.focus();
      source.value = cell.source;
      source.dispatchEvent(new Event("input", { bubbles: true }));
      const description = /** @type {HTMLTextAreaElement | null} */ (node?.querySelector('[data-role=description]'));
      if (description === null) throw new Error(`no Description editor for Cell ${index + 1}`);
      description.value = cell.pendingDescription ?? "";
      description.dispatchEvent(new Event("input", { bubbles: true }));
      if (cellId === "") throw new Error(`Cell ${index + 1} has no stable identity`);
    });
    document.getElementById("document-metadata")?.blur();
  }, {
    theme: fixture.theme,
    title: fixture.title,
    authors: fixture.authors,
    date: fixture.date,
    metadata: fixture.metadata,
    cells: fixture.cells.map((cell) => ({ source: cell.source, pendingDescription: cell.pendingDescription ?? "" })),
  });
  await settle(page);
}

/**
 * Bring the workspace back to its top: building a fixture focuses each editor,
 * which scrolls, and a capture has to show the layout the specification
 * annotates rather than wherever the last focus landed.
 * @param {import("puppeteer-core").Page} page
 */
export async function resetScroll(page) {
  await page.evaluate(() => {
    const workspace = document.getElementById("main-workspace");
    if (workspace !== null) workspace.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await settle(page);
}

/** Wait for the frame the app's rAF-deferred updates land in. */
/** @param {import("puppeteer-core").Page} page */
export async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Refresh the Document preview and wait for it to settle, reporting the state
 * the toolbar shows.
 * @param {import("puppeteer-core").Page} page
 */
export async function refreshPreview(page) {
  await page.evaluate(() => /** @type {HTMLElement | null} */ (document.getElementById("refresh-preview"))?.click());
  await page.waitForFunction(
    () => document.getElementById("preview-state")?.dataset.state !== "refreshing",
    { timeout: 30_000 },
  );
  await settle(page);
  return page.evaluate(() => ({
    state: document.getElementById("preview-state")?.dataset.state ?? null,
    message: document.getElementById("preview-state")?.textContent ?? "",
  }));
}

/** Run Analyze from More and wait for the summary to settle. */
/** @param {import("puppeteer-core").Page} page */
export async function analyzeDocument(page) {
  await page.evaluate(() => {
    /** @type {HTMLElement | null} */ (document.getElementById("more-toggle"))?.click();
    /** @type {HTMLElement | null} */ (document.getElementById("analyze"))?.click();
  });
  await page.waitForFunction(
    () => !(document.getElementById("diagnostics-summary")?.textContent ?? "").includes("…"),
    { timeout: 30_000 },
  );
  await settle(page);
}

/**
 * Record every job submission the page makes, so "no compilation" is exact
 * rather than inferred from resource timings that also count polling.
 * @param {import("puppeteer-core").Page} page
 */
export async function recordJobSubmissions(page) {
  await page.evaluate(() => {
    const scope = /** @type {any} */ (window);
    if (scope.__jobSubmissions !== undefined) return;
    scope.__jobSubmissions = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (/** @type {any} */ input, /** @type {any} */ init) => {
      const url = typeof input === "string" ? input : "";
      if (url.endsWith("/v1/jobs") && typeof init?.body === "string") {
        scope.__jobSubmissions.push(JSON.parse(init.body));
      }
      return nativeFetch(input, init);
    };
  });
}

/** @param {import("puppeteer-core").Page} page @returns {Promise<any[]>} */
export async function jobSubmissions(page) {
  return page.evaluate(() => /** @type {any} */ (window).__jobSubmissions ?? []);
}

/** The keyboard-only walk recognises a control by its label. */
/** @param {import("puppeteer-core").Page} page @param {string} selector @param {number} [budget] */
export async function tabTo(page, selector, budget = 80) {
  for (let step = 0; step < budget; step += 1) {
    await page.keyboard.press("Tab");
    const reached = await page.evaluate((target) => {
      const active = document.activeElement;
      return active !== null && active.matches(target);
    }, selector);
    if (reached) return true;
  }
  return false;
}

/** Everything the workspace shows, as plain data for the record. */
/** @param {import("puppeteer-core").Page} page */
export async function workspaceState(page) {
  return page.evaluate(() => {
    /** @type {(selector: string) => HTMLElement | null} */
    const one = (selector) => /** @type {HTMLElement | null} */ (document.querySelector(selector));
    return {
      title: one("#nav-document-title")?.textContent ?? null,
      session: one("#document-session")?.textContent ?? null,
      cellCount: document.querySelectorAll("#notebook-cells .cell").length,
      outlineCount: document.querySelectorAll("#cell-list button").length,
      cellLabels: [...document.querySelectorAll("#notebook-cells .cell-heading strong")].map((node) => node.textContent ?? ""),
      preview: {
        state: one("#preview-state")?.dataset.state ?? null,
        message: one("#preview-state")?.textContent ?? null,
        artifact: one("#preview")?.getAttribute("src") ?? null,
      },
      diagnostics: {
        summary: one("#diagnostics-summary")?.textContent ?? null,
        heading: one("#diagnostics-title")?.textContent ?? null,
        open: one("#diagnostics-panel")?.hidden === false,
        severities: [...document.querySelectorAll("#diagnostics-list .diagnostic")].map(
          (node) => node.getAttribute("data-severity") ?? "",
        ),
      },
      details: { open: /** @type {HTMLDetailsElement | null} */ (one("document-details"))?.open === true },
    };
  });
}
