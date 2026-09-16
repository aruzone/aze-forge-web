/**
 * Regenerate the frontend's preloaded example library.
 *
 *   node scripts/examples.mjs --library ../aze-forge-3/docs/language
 *
 * The examples are the compiler's own reference library, reused verbatim: its
 * README declares the documents the preloaded examples of the AzeForge Web
 * authoring app, and every one of them except the deliberately invalid
 * diagnostics sampler is a complete Source the pinned release parses,
 * validates and renders. They are vendored into `src/web/examples.json`
 * because the published package ships `dist`, `schemas` and its logo only —
 * the library is not on the installed path.
 *
 * The generator is deliberately dumb: it reads the directory, takes the
 * document title from front matter and the id from the file name, and emits
 * the JSON the frontend fetches. Validity is not asserted here; the compiler
 * integration suite compiles every example through the real service.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(REPO, "src", "web", "examples.json");

/** The one document in the library that is intentionally invalid. */
const INVALID_STEM = "diagnostics";

/** @param {string[]} argv */
function parseArgs(argv) {
  const libraryIndex = argv.indexOf("--library");
  if (libraryIndex === -1 || argv[libraryIndex + 1] === undefined) {
    throw new Error("Usage: node scripts/examples.mjs --library <compiler docs/language directory>");
  }
  return { library: resolve(argv[libraryIndex + 1]) };
}

/**
 * `07-timing.aze.md` is the timing example; `13-diagnostics.aze.md` is the
 * invalid sampler. The numeric prefix is the reading order, not a name.
 *
 * @param {string} file
 */
function idFor(file) {
  return basename(file, ".aze.md").replace(/^\d+-/, "");
}

/** @param {string} text */
function titleFor(text) {
  const match = /^title:[ \t]*(.+)$/m.exec(text);
  if (match === null) throw new Error("an example has no title in its front matter");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const { library } = parseArgs(process.argv.slice(2));
  const files = (await readdir(library)).filter((file) => file.endsWith(".aze.md")).sort();
  if (files.length === 0) throw new Error(`${library} holds no .aze.md example documents`);

  const examples = [];
  for (const file of files) {
    const text = await readFile(join(library, file), "utf8");
    const id = idFor(file);
    const title = titleFor(text);
    examples.push({ id, name: id === INVALID_STEM ? `${title} (invalid)` : title, source: text });
  }

  await writeFile(OUTPUT, `${JSON.stringify(examples, null, 2)}\n`);
  process.stdout.write(`wrote ${examples.length} examples from ${library} to ${OUTPUT}\n`);
  for (const example of examples) process.stdout.write(`  ${example.id.padEnd(20)} ${example.name}\n`);
}

await main();
