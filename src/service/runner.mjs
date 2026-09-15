/**
 * Compiler-backed operation execution.
 *
 * This module runs inside the per-job child process, never inside the HTTP
 * service. It mirrors the operation contract of "Define the compiler library
 * and web service boundary" as closely as the pinned compiler's public API
 * allows, and never reaches past that API.
 *
 * Semantic results are established independently of rendering. `compile`
 * therefore validates first: the library returns Document data and
 * `contentHash` only from a successful render, so a render failure would
 * otherwise lose the semantic result the contract requires be retained.
 * The pinned release exposes no public way to compute `contentHash` without
 * rendering, so a failed render reports `valid: true` with a null
 * `contentHash` rather than inventing one.
 */

/**
 * @param {import("@aruzone/aze-forge").Compiler} compiler
 * @param {import("./types.mjs").JobSpec & { projectRoot?: string }} spec
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import("./types.mjs").WorkerResult>}
 */
export async function runOperation(compiler, spec, options = {}) {
  const { source } = spec;
  const parseOptions = source.name === undefined ? {} : { sourceName: source.name };

  if (spec.operation === "format") {
    const formatted = compiler.format(source.text, parseOptions);
    return {
      ok: formatted.source !== undefined,
      semantic: null,
      diagnostics: [...formatted.diagnostics],
      proposal:
        formatted.source === undefined
          ? null
          : { kind: "formatted-source", source: formatted.source },
    };
  }

  const parsed = compiler.parse(source.text, parseOptions);
  const validation = compiler.validate(parsed);

  if (spec.operation === "analyze") {
    return {
      ok: validation.document !== undefined,
      semantic: semanticFrom(validation.document, null, spec.includeDocument === true),
      diagnostics: [...validation.diagnostics],
      proposal: null,
    };
  }

  if (spec.operation !== "compile") {
    throw new Error(`Unsupported operation reached the compiler runner: ${spec.operation}`);
  }
  if (spec.format === undefined) {
    throw new Error("A compile job reached the compiler runner without an Artifact format.");
  }

  if (validation.document === undefined) {
    return {
      ok: false,
      semantic: { valid: false, contentHash: null },
      diagnostics: [...validation.diagnostics],
      proposal: null,
    };
  }

  const compiled = await compiler.compile(source.text, {
    ...parseOptions,
    format: spec.format,
    ...(spec.theme === null || spec.theme === undefined ? {} : { theme: spec.theme }),
    ...(spec.projectRoot === undefined ? {} : { projectRoot: spec.projectRoot }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  // The library drops Document data and `contentHash` when rendering fails, but
  // the Document this job already validated stays valid: report what was
  // established semantically rather than regressing to "unknown".
  const semanticDocument = compiled.document ?? validation.document;
  return {
    ok: compiled.artifact !== undefined,
    semantic: semanticFrom(semanticDocument, compiled.contentHash ?? null, spec.includeDocument === true),
    diagnostics: [...compiled.diagnostics],
    proposal: null,
    artifact:
      compiled.artifact === undefined
        ? null
        : {
            format: compiled.artifact.metadata.format,
            mimeType: compiled.artifact.metadata.mimeType,
            metadata: compiled.artifact.metadata,
            bytes: compiled.artifact.bytes,
          },
  };
}

/**
 * @param {object | undefined} document
 * @param {string | null} contentHash
 * @param {boolean} includeDocument
 * @returns {import("./types.mjs").WorkerResult["semantic"]}
 */
function semanticFrom(document, contentHash, includeDocument) {
  if (document === undefined) return { valid: false, contentHash: null };
  return {
    valid: true,
    contentHash,
    ...(includeDocument ? { document } : {}),
  };
}
