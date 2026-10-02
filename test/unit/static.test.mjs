import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadWebAssets } from "../../src/service/static.mjs";

test("refuses public assets inside the reserved Playground route tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "azeweb-static-"));
  const publicRoot = join(root, "public");
  const playgroundRoot = join(root, "playground");

  try {
    await mkdir(join(publicRoot, "playground"), { recursive: true });
    await mkdir(playgroundRoot, { recursive: true });
    await writeFile(join(publicRoot, "playground", "index.html"), "public");
    await writeFile(join(playgroundRoot, "index.html"), "playground");

    await assert.rejects(
      () => loadWebAssets({ publicRoot, playgroundRoot }),
      /public asset route \/playground\/index\.html is reserved for the Playground/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
