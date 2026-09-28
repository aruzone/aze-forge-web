/** Authoring Draft Gate HTTP boundary. */

import assert from "node:assert/strict";
import test from "node:test";
import { call, startTestService } from "./helpers/harness.mjs";

const SOURCE = "---\nazemark: 2\ntitle: Draft\nauthor:\n  - AzeForge Web\n---\n\n:::: equation\nid: generated-draft\n----\nx = 1\n::::\n";

test("analyzes an untrusted source draft before returning it", async () => {
  const service = await startTestService({
    authoringProvider: { async generate() { return { kind: "source", title: "Draft", blockType: "equation", text: "x = 1" }; } },
  });
  try {
    const response = await call(service.base, "POST", "/v1/authoring/drafts", {
      body: { protocolVersion: 1, requestId: "draft-1", description: "A title" },
      contentType: "application/json",
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.outcome, "source");
    assert.equal(response.json.source.text, SOURCE);
    assert.equal(response.json.analysis.valid, true);
    assert.deepEqual(response.json.analysis.diagnostics, []);
    assert.equal(response.json.requestId, "draft-1");
    assert.match(response.json.capabilityFingerprint, /^sha256:/);
  } finally {
    await service.close();
  }
});

test("does not call an unavailable authoring provider", async () => {
  const service = await startTestService({ authoringProvider: null });
  try {
    const response = await call(service.base, "POST", "/v1/authoring/drafts", {
      body: { protocolVersion: 1, requestId: "draft-1", description: "A title" },
      contentType: "application/json",
    });
    assert.equal(response.status, 503);
    assert.equal(response.json.error.code, "service-unavailable");
    assert.equal(response.json.error.data.code, "authoring-unavailable");
  } finally {
    await service.close();
  }
});

test("does not return a bare notation fragment as a source draft", async () => {
  const service = await startTestService({
    authoringProvider: { async generate() { return { kind: "source", text: "x = 1" }; } },
  });
  try {
    const response = await call(service.base, "POST", "/v1/authoring/drafts", {
      body: { protocolVersion: 1, requestId: "draft-1", description: "An equation" },
      contentType: "application/json",
    });
    assert.equal(response.status, 503);
    assert.equal(response.json.error.data.code, "authoring-incomplete-source-draft");
  } finally {
    await service.close();
  }
});

test("logs only the safe reason when a model outcome cannot form a Source draft", async () => {
  const lines = [];
  const service = await startTestService({
    lines,
    authoringProvider: { async generate() { return { kind: "source", text: "x = 1" }; } },
  });
  try {
    await call(service.base, "POST", "/v1/authoring/drafts", {
      body: { protocolVersion: 1, requestId: "draft-1", description: "A title" },
      contentType: "application/json",
    });
    assert.ok(lines.some((line) => line.includes("\"event\":\"authoring-draft-contract-rejected\"")));
    assert.ok(!lines.join("").includes("x = 1"));
  } finally {
    await service.close();
  }
});
