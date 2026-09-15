import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArtifactCache } from "../../src/service/cache.mjs";

async function cacheWith(overrides = {}) {
  const scratchDir = await mkdtemp(join(tmpdir(), "azeweb-cache-"));
  let clock = 1_000;
  const cache = new ArtifactCache({
    scratchDir,
    maxBytes: 20,
    maxAgeMs: 1_000,
    now: () => clock,
    ...overrides,
  });
  await cache.init();
  return {
    cache,
    advance: (ms) => {
      clock += ms;
    },
    cleanup: () => rm(scratchDir, { recursive: true, force: true }),
  };
}

const identity = { contentHash: "sha256:content", rendererFingerprint: "sha256:renderer" };

test("an admitted entry serves the same bytes back and records its compiler identity", async () => {
  const { cache, cleanup } = await cacheWith();
  try {
    const entry = await cache.admit({
      contextId: "ctx",
      fingerprint: "fp-1",
      identity,
      bytes: Buffer.from("artifact-bytes"),
      result: { ok: true },
    });
    assert.ok(entry);
    assert.deepEqual(entry.identity, identity, "the authoritative identity is inspectable, not assumed");
    const hit = cache.lookup("ctx", "fp-1");
    assert.equal(hit, entry);
    assert.equal((await cache.read(hit)).toString(), "artifact-bytes");
    assert.equal(cache.bytesInUse, 14);
  } finally {
    await cleanup();
  }
});

test("a fingerprint from another client context never selects an entry", async () => {
  const { cache, cleanup } = await cacheWith();
  try {
    await cache.admit({ contextId: "ctx-a", fingerprint: "fp", identity, bytes: Buffer.from("x"), result: {} });
    assert.equal(cache.lookup("ctx-b", "fp"), null);
    assert.equal(cache.lookup("ctx-a", "other-fingerprint"), null);
  } finally {
    await cleanup();
  }
});

test("expired entries are not served and release their budget", async () => {
  const { cache, advance, cleanup } = await cacheWith();
  try {
    await cache.admit({ contextId: "c", fingerprint: "fp", identity, bytes: Buffer.from("12345"), result: {} });
    advance(1_001);
    assert.equal(cache.lookup("c", "fp"), null);
    await cache.pruneExpired();
    assert.equal(cache.bytesInUse, 0);
  } finally {
    await cleanup();
  }
});

test("evicts least-recently-used entries to stay inside the byte budget", async () => {
  const { cache, cleanup } = await cacheWith();
  try {
    await cache.admit({ contextId: "c", fingerprint: "old", identity, bytes: Buffer.from("1234567890"), result: {} });
    await cache.admit({ contextId: "c", fingerprint: "new", identity, bytes: Buffer.from("1234567890"), result: {} });
    assert.equal(cache.bytesInUse, 20);

    const third = await cache.admit({
      contextId: "c",
      fingerprint: "third",
      identity,
      bytes: Buffer.from("12345"),
      result: {},
    });
    assert.ok(third, "the new entry is admitted");
    assert.equal(cache.lookup("c", "old"), null, "the least recently used entry was evicted");
    assert.ok(cache.lookup("c", "new"));
    assert.ok(cache.bytesInUse <= 20);
  } finally {
    await cleanup();
  }
});

test("refuses to cache an Artifact larger than the whole cache rather than failing the job", async () => {
  const { cache, cleanup } = await cacheWith();
  try {
    const entry = await cache.admit({
      contextId: "c",
      fingerprint: "big",
      identity,
      bytes: Buffer.alloc(21),
      result: {},
    });
    assert.equal(entry, null);
    assert.equal(cache.bytesInUse, 0);
  } finally {
    await cleanup();
  }
});

test("re-admitting the same fingerprint replaces the previous entry", async () => {
  const { cache, cleanup } = await cacheWith({ maxBytes: 1024 });
  try {
    await cache.admit({ contextId: "c", fingerprint: "fp", identity, bytes: Buffer.from("first"), result: {} });
    await cache.admit({ contextId: "c", fingerprint: "fp", identity, bytes: Buffer.from("second!"), result: {} });
    assert.equal(cache.size, 1);
    assert.equal((await cache.read(cache.lookup("c", "fp"))).toString(), "second!");
    assert.equal(cache.bytesInUse, 7);
  } finally {
    await cleanup();
  }
});
