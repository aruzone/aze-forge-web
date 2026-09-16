/**
 * The single-user frontend is served as bytes from the service's own
 * directory. Files are read once at startup: the frontend is part of the
 * image, not a mutable resource.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** @type {Record<string, string>} */
const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
});

const FILES = Object.freeze([
  "index.html",
  "app.js",
  "app.css",
  "coordinates.js",
  "examples.json",
  "azeforge-logo-03-2.jpg",
]);

/**
 * The frontend is inert by construction: no remote origins, no inline scripts
 * beyond the module it ships, and it may frame only the blob preview it
 * builds from an Artifact it fetched itself.
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
 * @param {string} directory
 * @returns {Promise<Map<string, { body: Buffer, contentType: string }>>}
 */
export async function loadWebAssets(directory) {
  /** @type {Map<string, { body: Buffer, contentType: string }>} */
  const assets = new Map();
  for (const file of FILES) {
    const body = await readFile(join(directory, file));
    const extension = /** @type {keyof typeof CONTENT_TYPES} */ (file.slice(file.lastIndexOf(".")));
    assets.set(`/${file}`, { body, contentType: CONTENT_TYPES[extension] });
  }
  const index = /** @type {{ body: Buffer, contentType: string }} */ (assets.get("/index.html"));
  assets.set("/", { body: index.body, contentType: index.contentType });
  return assets;
}
