/**
 * Browser plumbing for the workspace audit.
 *
 * The audit drives the deployment's own pinned browser when it is cached
 * (`@puppeteer/browsers` layout, 152.0.7977.75 as pinned by the compiler
 * release); `--chrome` or `CHROME_PATH` overrides it, and a system Chrome is
 * the last resort. Nothing here is specific to the audit's checks.
 */

import { readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

/** axe-core's bundled build, injected into the page for the scans. */
export function axeSource() {
  return readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
}

/** @param {string} path */
const isFile = async (path) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/** The newest cached `chrome-headless-shell` from the shared browser cache. */
async function cachedHeadlessShell() {
  const cache = process.env.PUPPETEER_CACHE_DIR ?? join(homedir(), ".cache", "puppeteer");
  const root = join(cache, "chrome-headless-shell");
  if (!existsSync(root)) return null;
  const versions = (await readdir(root)).sort();
  for (const version of versions.reverse()) {
    const directory = join(root, version);
    const builds = await readdir(directory).catch(() => []);
    for (const build of builds) {
      const candidate = join(directory, build, "chrome-headless-shell");
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

const SYSTEM = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * @param {string | null} explicit
 * @returns {Promise<string>}
 */
export async function resolveBrowser(explicit) {
  const candidates = [explicit, process.env.CHROME_PATH, await cachedHeadlessShell(), ...SYSTEM];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "" && existsSync(candidate)) return candidate;
  }
  throw new Error("no browser found: pass --chrome, set CHROME_PATH, or install Chrome");
}

/** @param {string} executablePath */
export async function startBrowser(executablePath) {
  const puppeteer = await import("puppeteer-core");
  return puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });
}

/**
 * A page past the access gate, with the workspace rendered.
 * @param {import("puppeteer-core").Browser} browser
 * @param {{ base: string, token: string, width: number, height: number }} options
 */
export async function openWorkspace(browser, { base, token, width, height }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(`${base}/`, { waitUntil: "networkidle0" });
  await page.type("#gate-token", token);
  await Promise.all([
    page.waitForSelector("#workspace:not([hidden])", { timeout: 30_000 }),
    page.evaluate(() => /** @type {HTMLElement | null} */ (document.querySelector("#gate-form button[type=submit]"))?.click()),
  ]);
  await page.waitForSelector("#notebook-cells");
  return page;
}

/**
 * axe-core over the WCAG 2.x A/AA tags this contract claims, plus the
 * target-size rule that WCAG 2.2 adds.
 * @param {import("puppeteer-core").Page} page
 */
export async function axeViolations(page) {
  // `Runtime.evaluate` is not subject to the page's `script-src 'self'`, which
  // is exactly the policy the deployment ships.
  await page.evaluate(axeSource());
  return page.evaluate(async () => {
    const axe = /** @type {any} */ (window).axe;
    const results = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations"],
      // The preview iframe is a sandboxed blob document the audit renders
      // itself; axe scans the workspace, not inside the Artifact.
      iframes: false,
    });
    return results.violations.map((/** @type {any} */ violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((/** @type {any} */ node) => ({
        target: node.target.join(" "),
        summary: node.failureSummary,
      })),
    }));
  });
}

/**
 * The CDP media override, which supports the features puppeteer's
 * `emulateMediaFeatures` rejects (`forced-colors`).
 * @param {import("puppeteer-core").Page} page
 * @param {{ name: string, value: string }[]} features
 */
export async function emulateMedia(page, features) {
  const client = await page.createCDPSession();
  await client.send("Emulation.setEmulatedMedia", { features });
  return client;
}
