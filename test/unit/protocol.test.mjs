import assert from "node:assert/strict";
import test from "node:test";
import { ServiceError } from "../../src/service/errors.mjs";
import { validateJobRequest } from "../../src/service/protocol.mjs";

const context = {
  maxSourceBytes: 1024,
  maxAssetsPerJob: 2,
  themes: new Set(["default", "academic"]),
  formats: new Set(["html", "svg", "png", "pdf"]),
};

const base = {
  protocolVersion: 1,
  requestId: "r-1",
  revision: "rev-1",
  operation: "analyze",
  source: { text: "# Title\n" },
};

function reject(request, code, contextOverride = {}) {
  assert.throws(
    () => validateJobRequest(request, { ...context, ...contextOverride }),
    (error) => error instanceof ServiceError && error.code === code,
    `expected ${code}`,
  );
}

test("accepts the documented common structure", () => {
  const spec = validateJobRequest({ ...base }, context);
  assert.deepEqual(
    { ...spec, source: { ...spec.source } },
    {
      protocolVersion: 1,
      operation: "analyze",
      requestId: "r-1",
      revision: "rev-1",
      source: { text: "# Title\n" },
      includeDocument: false,
    },
  );
});

test("rejects any protocol version other than 1, without translation", () => {
  reject({ ...base, protocolVersion: 2 }, "protocol-version-unsupported");
  reject({ ...base, protocolVersion: "1" }, "protocol-version-unsupported");
  reject({ ...base, protocolVersion: undefined }, "protocol-version-unsupported");
});

test("rejects unknown operations and unknown fields", () => {
  reject({ ...base, operation: "render" }, "request-malformed");
  reject({ ...base, allowRawLatex: true }, "option-unsupported");
  reject({ ...base, projectRoot: "/etc" }, "option-unsupported");
  reject({ ...base, source: { text: "x", path: "a.aze.md" } }, "option-unsupported");
});

test("reports migrate and composition payloads as compiler-unavailable, with a remedy", () => {
  assert.throws(
    () => validateJobRequest({ ...base, operation: "migrate", targetAzemarkVersion: 2 }, context),
    (error) => error.code === "operation-unsupported" && /no migrate operation/.test(error.message),
  );
  assert.throws(
    () => validateJobRequest({ ...base, includeComposition: true }, context),
    (error) => error.code === "option-unsupported" && /no shared composition results/.test(error.message),
  );
});

test("requires a format for compile and rejects unadvertised formats and themes", () => {
  reject({ ...base, operation: "compile" }, "request-malformed");
  reject({ ...base, operation: "compile", format: "docx" }, "option-unsupported");
  reject({ ...base, operation: "compile", format: "html", theme: "neon" }, "option-unsupported");
  const spec = validateJobRequest({ ...base, operation: "compile", format: "png", theme: "academic" }, context);
  assert.equal(spec.format, "png");
  assert.equal(spec.theme, "academic");
  assert.deepEqual(spec.assets, []);
});

test("rejects Source text above the deployment ceiling with a 413", () => {
  assert.throws(
    () => validateJobRequest({ ...base, source: { text: "x".repeat(2000) } }, context),
    (error) => error.code === "payload-too-large" && error.status === 413,
  );
});

test("keeps Source names as labels, never paths", () => {
  reject({ ...base, source: { text: "x", name: "notes/draft.aze.md" } }, "option-unsupported");
  reject({ ...base, source: { text: "x", name: "..\\escape" } }, "option-unsupported");
  const spec = validateJobRequest({ ...base, source: { text: "x", name: "report.aze.md" } }, context);
  assert.equal(spec.source.name, "report.aze.md");
});

test("validates asset bindings as root-relative logical paths", () => {
  const spec = validateJobRequest(
    {
      ...base,
      operation: "compile",
      format: "html",
      assets: [
        { path: "images/logo.svg", handle: "a" },
        { path: "Logo.PNG", handle: "b" },
      ],
    },
    context,
  );
  assert.deepEqual(
    spec.assets.map((asset) => asset.path),
    ["images/logo.svg", "Logo.PNG"],
  );

  reject({ ...base, operation: "compile", format: "html", assets: [{ path: "/etc/passwd", handle: "a" }] }, "option-unsupported");
  reject({ ...base, operation: "compile", format: "html", assets: [{ path: "../escape.png", handle: "a" }] }, "option-unsupported");
  reject({ ...base, operation: "compile", format: "html", assets: [{ path: "https://x/y.png", handle: "a" }] }, "option-unsupported");
  reject({ ...base, operation: "compile", format: "html", assets: [{ path: "a//b.png", handle: "a" }] }, "option-unsupported");
  reject(
    {
      ...base,
      operation: "compile",
      format: "html",
      assets: [
        { path: "same.png", handle: "a" },
        { path: "same.png", handle: "b" },
      ],
    },
    "request-malformed",
  );
  reject(
    {
      ...base,
      operation: "compile",
      format: "html",
      assets: [
        { path: "a.png", handle: "a" },
        { path: "b.png", handle: "b" },
        { path: "c.png", handle: "c" },
      ],
    },
    "payload-too-large",
  );
});

test("requires correlation identifiers to be non-empty, bounded and control-free", () => {
  reject({ ...base, requestId: "" }, "request-malformed");
  reject({ ...base, revision: "" }, "request-malformed");
  reject({ ...base, revision: "x".repeat(201) }, "request-malformed");
  reject({ ...base, revision: "bad\u0000value" }, "request-malformed");
  reject({ ...base, source: "just a string" }, "request-malformed");
});
