import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetStore } from "../../src/service/assets.mjs";
import { ServiceError } from "../../src/service/errors.mjs";

async function storeWith(overrides = {}) {
  const scratchDir = await mkdtemp(join(tmpdir(), "azeweb-assets-"));
  let clock = 1_000;
  const store = new AssetStore({
    scratchDir,
    maxAssetBytes: 64,
    maxTotalAssetBytes: 100,
    assetTtlMs: 1_000,
    now: () => clock,
    ...overrides,
  });
  await store.init();
  return {
    store,
    advance: (ms) => {
      clock += ms;
    },
    cleanup: () => rm(scratchDir, { recursive: true, force: true }),
  };
}

test("stores bytes under an opaque handle scoped to one client context", async () => {
  const { store, cleanup } = await storeWith();
  try {
    const record = await store.put(Buffer.from("png-bytes"), { mediaType: "image/png", contextId: "ctx-a" });
    assert.match(record.assetId, /^[0-9a-f-]{36}$/);
    assert.equal(record.byteLength, 9);
    assert.equal(store.lookup(record.assetId, "ctx-a")?.assetId, record.assetId);
    assert.equal(store.lookup(record.assetId, "ctx-b"), null, "another context cannot see the handle");
    assert.equal(store.lookup("missing", "ctx-a"), null);
    assert.equal((await store.read(record.assetId)).toString(), "png-bytes");
  } finally {
    await cleanup();
  }
});

test("refuses an empty upload and one above the per-asset ceiling", async () => {
  const { store, cleanup } = await storeWith();
  try {
    await assert.rejects(
      () => store.put(Buffer.alloc(0), { mediaType: null, contextId: "c" }),
      (error) => error instanceof ServiceError && error.code === "request-malformed",
    );
    await assert.rejects(
      () => store.put(Buffer.alloc(65), { mediaType: null, contextId: "c" }),
      (error) => error.code === "payload-too-large" && error.status === 413,
    );
  } finally {
    await cleanup();
  }
});

test("refuses an upload that would exceed the deployment asset budget", async () => {
  const { store, cleanup } = await storeWith();
  try {
    await store.put(Buffer.alloc(60), { mediaType: null, contextId: "c" });
    await assert.rejects(
      () => store.put(Buffer.alloc(60), { mediaType: null, contextId: "c" }),
      (error) => error.code === "payload-too-large" && error.data.scope === "total-asset-bytes",
    );
    assert.equal(store.bytesInUse, 60);
  } finally {
    await cleanup();
  }
});

test("revoking a handle frees its bytes and makes it not found", async () => {
  const { store, cleanup } = await storeWith();
  try {
    const record = await store.put(Buffer.alloc(10), { mediaType: null, contextId: "c" });
    assert.equal(await store.revoke(record.assetId, "other-context"), false, "another context cannot revoke");
    assert.equal(await store.revoke(record.assetId, "c"), true);
    assert.equal(store.lookup(record.assetId, "c"), null);
    assert.equal(store.bytesInUse, 0);
    assert.equal(await store.revoke(record.assetId, "c"), false, "revoking twice is not a success");
  } finally {
    await cleanup();
  }
});

test("an expired handle is indistinguishable from an unknown one and releases its budget", async () => {
  const { store, advance, cleanup } = await storeWith();
  try {
    const record = await store.put(Buffer.alloc(10), { mediaType: null, contextId: "c" });
    advance(1_001);
    assert.equal(store.lookup(record.assetId, "c"), null);
    await store.pruneExpired();
    assert.equal(store.bytesInUse, 0);
    assert.equal(store.count, 0);
  } finally {
    await cleanup();
  }
});
