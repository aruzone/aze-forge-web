/**
 * Static public-site and Playground assets.
 *
 * Both trees are read once at startup. The public tree is generated as a
 * standalone bundle; the authoring tree is mounted only below `/playground`.
 */

import { readFile, readdir } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";

/** @type {Readonly<Record<string, string>>} */
const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
});

export const PUBLIC_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

/**
 * The Playground is inert by construction: no remote origins, no inline
 * scripts beyond the module it ships, and it may frame only the blob preview
 * it builds from an Artifact it fetched itself.
 */
export const FRONTEND_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

/**
 * @typedef {{ body: Buffer, contentType: string, contentSecurityPolicy: string }} StaticAsset
 */

/**
 * @param {{ publicRoot: string, playgroundRoot: string }} input
 * @returns {Promise<Map<string, StaticAsset>>}
 */
export async function loadWebAssets({ publicRoot, playgroundRoot }) {
  const assets = await loadDirectory(publicRoot, "", PUBLIC_CONTENT_SECURITY_POLICY);
  for (const route of assets.keys()) {
    if (route === "/playground" || route.startsWith("/playground/")) {
      throw new Error(`public asset route ${route} is reserved for the Playground`);
    }
  }

  const playgroundAssets = await loadDirectory(
    playgroundRoot,
    "/playground",
    FRONTEND_CONTENT_SECURITY_POLICY,
  );
  playgroundAssets.delete("/playground/");
  playgroundAssets.delete("/playground/index.html");
  for (const [route, asset] of playgroundAssets) assets.set(route, asset);
  return assets;
}

/**
 * @param {string} directory
 * @param {string} prefix
 * @param {string} contentSecurityPolicy
 * @returns {Promise<Map<string, StaticAsset>>}
 */
async function loadDirectory(directory, prefix, contentSecurityPolicy) {
  /** @type {Map<string, StaticAsset>} */
  const assets = new Map();
  await visit(directory);
  return assets;

  /** @param {string} current */
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = extname(entry.name);
      const contentType = CONTENT_TYPES[extension];
      if (contentType === undefined) throw new Error(`unsupported static asset type: ${entry.name}`);

      const name = relative(directory, path).split(sep).join(posix.sep);
      const route = `${prefix}/${name}`;
      const asset = {
        body: await readFile(path),
        contentType,
        contentSecurityPolicy,
      };
      assets.set(route, asset);

      if (entry.name === "index.html") {
        const directoryRoute = route.slice(0, -"index.html".length);
        assets.set(directoryRoute, asset);
        assets.set(directoryRoute === "/" ? "/" : directoryRoute.slice(0, -1), asset);
      }
    }
  }
}
