/**
 * The image dependency manifest is acceptance evidence, so it has to be
 * reproducible, it has to speak only about what the image actually carries, and
 * a build that baked no pinned browser must not produce one.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CHROME_HEADLESS_SHELL_VERSION } from "@aruzone/aze-forge/adapters";
import { buildImageManifest } from "../../scripts/image-manifest.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
const BASE = "node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553";
const BROWSER_BYTES = "headless-shell-bytes";

/**
 * A cache laid out the way the compiler's installer leaves it: the pinned build
 * in a platform-named directory, holding the archive-named directory, holding
 * the executable.
 */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "azeweb-manifest-"));
  await copyFile(join(REPO, "package-lock.json"), join(directory, "package-lock.json"));
  const cacheDir = join(directory, "cache");
  const executable = join(
    cacheDir,
    "chrome-headless-shell",
    `linux_arm-${CHROME_HEADLESS_SHELL_VERSION}`,
    "chrome-headless-shell-linux64",
    "chrome-headless-shell",
  );
  await mkdir(join(executable, ".."), { recursive: true });
  await writeFile(executable, BROWSER_BYTES);
  return { directory, cacheDir, executable };
}

test("the manifest is deterministic and its browser digest follows the bytes", async () => {
  const { directory, cacheDir, executable } = await fixture();
  try {
    const build = () => buildImageManifest({ cwd: directory, cacheDir, baseImage: BASE });
    const first = build();
    assert.deepEqual(build(), first, "two builds of the same inputs must be identical");
    assert.equal(first.browser.byteLength, BROWSER_BYTES.length);
    assert.equal(
      first.browser.sha256,
      `sha256:${createHash("sha256").update(BROWSER_BYTES).digest("hex")}`,
    );
    assert.equal(first.browser.archive, "chrome-headless-shell-linux64");
    assert.equal(first.browser.executable, executable);
    assert.equal(first.image.base, BASE);

    await writeFile(executable, "different-bytes");
    const swapped = build();
    assert.notEqual(swapped.browser.sha256, first.browser.sha256, "the digest must follow the executable's contents");
    assert.equal(swapped.browser.byteLength, "different-bytes".length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cache without the pinned browser is a build failure, not an empty pin", async () => {
  const { directory, cacheDir } = await fixture();
  try {
    await rm(join(cacheDir, "chrome-headless-shell", `linux_arm-${CHROME_HEADLESS_SHELL_VERSION}`), {
      recursive: true,
      force: true,
    });
    assert.throws(
      () => buildImageManifest({ cwd: directory, cacheDir, baseImage: BASE }),
      /is not in/,
      "an image without the pinned browser must fail the build",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the manifest pins the compiler, the browser, the fonts and every production dependency", async () => {
  const { directory, cacheDir } = await fixture();
  try {
    const manifest = buildImageManifest({ cwd: directory, cacheDir, baseImage: BASE });

    assert.equal(manifest.schema, "azeforge.web.image-manifest/v1");
    assert.equal(manifest.compiler.package, "@aruzone/aze-forge");
    assert.equal(manifest.compiler.version, packageJson.dependencies["@aruzone/aze-forge"]);
    assert.match(manifest.compiler.integrity, /^sha512-/);
    assert.equal(manifest.compiler.engines, packageJson.engines.node);

    assert.equal(manifest.browser.name, "chrome-headless-shell");
    assert.equal(manifest.browser.version, CHROME_HEADLESS_SHELL_VERSION);

    assert.equal(manifest.fonts["@fontsource/inter"].version, "5.3.0");
    assert.equal(manifest.fonts["@fontsource/jetbrains-mono"].version, "5.2.8");

    assert.equal(manifest.runtime.node, process.version);

    // The image installs runtime dependencies only: its development toolchain
    // must not appear as if it shipped.
    assert.equal(manifest.dependencies["typescript"], undefined);
    assert.equal(manifest.dependencies["@types/node"], undefined);
    assert.ok(Object.keys(manifest.dependencies).length > 50);

    for (const [name, entry] of Object.entries(manifest.dependencies)) {
      assert.match(entry.version, /^\d+\.\d+\.\d+/, `${name} must be an exact version`);
      assert.match(entry.integrity ?? "", /^sha512-/, `${name} must carry an integrity digest`);
    }
    assert.equal(manifest.dependencies["@aruzone/aze-forge"].version, packageJson.dependencies["@aruzone/aze-forge"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
