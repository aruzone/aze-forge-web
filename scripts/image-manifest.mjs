#!/usr/bin/env node
/**
 * The image dependency manifest: what this image actually contains, by exact
 * pin, for the deployment acceptance evidence (operating envelope section 14,
 * check 9).
 *
 * It is generated inside the image at build time and is deterministic: same
 * inputs, same bytes. No timestamps, no host facts, no floating ranges — the
 * point is to be able to say which compiler release, which browser build and
 * which resolved dependency tree an acceptance run was collected against.
 *
 * The browser is looked up where the compiler will look for it rather than
 * through a second copy of its platform mapping, so the manifest can only ever
 * describe the executable that is really in the image — and a build that baked
 * no pinned browser fails here instead of shipping.
 *
 * Run from the image work directory:
 *   AZEWEB_BASE_IMAGE=node:24-bookworm-slim@sha256:… node scripts/image-manifest.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_HEADLESS_SHELL_VERSION } from "@aruzone/aze-forge/adapters";

export const IMAGE_MANIFEST_SCHEMA_ID = "azeforge.web.image-manifest/v1";

/** @param {string} path */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {Record<string, any>} packages @param {string} name */
function resolved(packages, name) {
  const entry = packages[`node_modules/${name}`];
  if (entry === undefined) return null;
  return {
    version: entry.version,
    integrity: entry.integrity ?? null,
  };
}

/**
 * The baked pinned browser, as the compiler's own cache holds it:
 * `chrome-headless-shell/<platform>-<buildId>/chrome-headless-shell-<archive>/chrome-headless-shell`.
 *
 * @param {string} cacheDir
 * @param {string} buildId
 * @returns {{ executable: string, archive: string }}
 */
function findPinnedBrowser(cacheDir, buildId) {
  const root = join(cacheDir, "chrome-headless-shell");
  /** @type {string[]} */
  let builds;
  try {
    builds = readdirSync(root).filter((entry) => entry.endsWith(`-${buildId}`)).sort();
  } catch {
    builds = [];
  }
  if (builds.length === 0) {
    throw new Error(`the pinned chrome-headless-shell ${buildId} is not in ${root}`);
  }
  const build = join(root, /** @type {string} */ (builds[0]));
  const archives = readdirSync(build).filter((entry) => entry.startsWith("chrome-headless-shell-")).sort();
  if (archives.length === 0) {
    throw new Error(`the pinned chrome-headless-shell ${buildId} has no executable in ${build}`);
  }
  return {
    executable: join(build, /** @type {string} */ (archives[0]), "chrome-headless-shell"),
    archive: /** @type {string} */ (archives[0]),
  };
}

/**
 * @param {{ cwd?: string, cacheDir?: string, baseImage?: string | null, nodeVersion?: string,
 *           platform?: string }} [options]
 */
export function buildImageManifest(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const lock = readJson(join(cwd, "package-lock.json"));
  const packages = lock.packages ?? {};

  const cacheDir = options.cacheDir ?? join(homedir(), ".cache", "puppeteer");
  const browser = findPinnedBrowser(cacheDir, CHROME_HEADLESS_SHELL_VERSION);
  const browserBytes = readFileSync(browser.executable);

  /** @type {Record<string, { version: string, integrity: string | null }>} */
  const dependencies = {};
  for (const [path, entry] of Object.entries(packages)) {
    if (path === "" || entry === null || typeof entry !== "object") continue;
    if (entry.dev === true || entry.version === undefined) continue;
    dependencies[path.slice("node_modules/".length)] = {
      version: entry.version,
      integrity: entry.integrity ?? null,
    };
  }

  const compiler = packages["node_modules/@aruzone/aze-forge"] ?? {};

  return {
    schema: IMAGE_MANIFEST_SCHEMA_ID,
    image: { base: options.baseImage ?? process.env.AZEWEB_BASE_IMAGE ?? null },
    runtime: {
      node: options.nodeVersion ?? process.version,
      platform: options.platform ?? `${process.platform}-${process.arch}`,
    },
    compiler: {
      package: "@aruzone/aze-forge",
      ...resolved(packages, "@aruzone/aze-forge"),
      engines: compiler.engines?.node ?? null,
    },
    browser: {
      name: "chrome-headless-shell",
      version: CHROME_HEADLESS_SHELL_VERSION,
      // The archive the executable came from, e.g. `chrome-headless-shell-linux64`.
      // It is what makes an image whose browser cannot run on its own platform
      // — an arm64 image carrying the x64-only headless shell build — visible
      // without launching anything.
      archive: browser.archive,
      executable: browser.executable,
      byteLength: browserBytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(browserBytes).digest("hex")}`,
    },
    fonts: {
      "@fontsource/inter": resolved(packages, "@fontsource/inter"),
      "@fontsource/jetbrains-mono": resolved(packages, "@fontsource/jetbrains-mono"),
    },
    dependencies,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.stdout.write(`${JSON.stringify(buildImageManifest(), null, 2)}\n`);
}
