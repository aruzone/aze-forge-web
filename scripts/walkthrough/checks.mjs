/**
 * The automated half of the Checkpoint B owner walkthrough.
 *
 * The acceptance decision (`aruzone/aze-forge#53` §6) scripts one pass over the
 * deployed service: open a representative Source spanning all ten native
 * families plus composition, read the live diagnostics, toggle the three
 * Themes, export each to HTML/SVG/PNG/PDF, and spot-verify a sampling of golden
 * artifacts. Every step here performs exactly that against the deployment and
 * records what it saw; the owner performs the same pass in the browser and
 * decides.
 *
 * Nothing in this file reads compiler policy: capabilities, Themes, formats and
 * every diagnostic come from the deployment under test.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CheckFailure, expect } from "../cli.mjs";
import {
  capabilitiesOf,
  diagnosticList,
  downloadArtifact,
  jobRequest,
  runToTerminal,
} from "../jobs.mjs";
import { sha256 } from "../http.mjs";
import { coverageReport, uncoveredUnits } from "./families.mjs";
import { goldenDifferences } from "./golden.mjs";
import { ARTIFACT_FORMATS } from "./record.mjs";

/**
 * @typedef {object} WalkthroughContext
 * @property {string} base             the deployed service
 * @property {string} token            the deployment token
 * @property {{ compiler: string, browser: string, capabilityFingerprint: string | null }} pins
 * @property {number} timeoutMs        per-job deadline for the walkthrough run
 * @property {string} outDir           where exported Artifacts are written for the owner
 * @property {{ name: string, path: string, text: string }} source
 * @property {{ name: string, path: string, text: string }[]} goldens
 * @property {import("./golden.mjs").GoldenIdentity | null} goldenIdentity
 * @property {string} goldenIdentityPath
 * @property {boolean} [recordGolden] recording mode: write the identity instead of comparing against it
 */

/** @typedef {(line: string) => void} RecordLine */

/**
 * What the steps observed. The record is built from this, never from the log
 * text, so the manual-evidence entry carries facts rather than prose.
 *
 * @typedef {object} Findings
 * @property {{ release: string, fingerprint: string, themes: { id: string, title: string }[], formats: string[], runtime: { os: string, arch: string, node: number } | null } | null} capabilities
 * @property {{ name: string, diagnostics: string[], kinds: string[], coverage: any[] } | null} source
 * @property {{ id: string, contentHash: string | null, artifactHash: string, byteLength: number }[]} themes
 * @property {{ format: string, mimeType: string, byteLength: number, artifactHash: string, contentHash: string | null, path: string }[]} formats
 * @property {import("./golden.mjs").GoldenRender[]} determinism
 * @property {{ name: string, contentHash: string | null } | null} fixture
 */

/** @returns {Findings} */
export function emptyFindings() {
  return {
    capabilities: null,
    source: null,
    themes: [],
    formats: [],
    determinism: [],
    fixture: null,
  };
}

/**
 * @typedef {object} WalkthroughStep
 * @property {string} id
 * @property {string} title
 * @property {(context: WalkthroughContext, record: RecordLine, findings: Findings) => Promise<void>} run
 */

/** The three Themes, the four exports and the ten-family Source, in the order
 * the owner performs them. The Theme count is the approved alpha's contract
 * (`aruzone/aze-forge#55`: three built-in Themes), asserted against what the
 * deployment advertises rather than assumed. */
const APPROVED_THEME_COUNT = 3;
const EXPORT_FORMATS = ARTIFACT_FORMATS;

/**
 * The approved alpha operating matrix (`aruzone/aze-forge#53` §4, §54): the
 * canonical platform the compiler publishes for. Evidence collected on a
 * deployment that advertises another one would not describe the alpha.
 */
const APPROVED_RUNTIME = Object.freeze({ os: "ubuntu", arch: "x64", node: 24 });

/**
 * A job's Source is `{ text, name }` and nothing else: the service rejects any
 * other field, and the walkthrough's own Source object carries the path it was
 * read from.
 *
 * @param {{ name: string, text: string }} source
 */
function jobSource(source) {
  return { text: source.text, name: source.name };
}

/** @param {any} job @param {string} label */
function settle(job, label) {
  expect(job.status === "completed", `${label}: the job settled as ${job.status}`);
  return job.result;
}

/** @type {WalkthroughStep[]} */
export const STEPS = [
  {
    id: "capabilities",
    title: "Capabilities: the exact build, the three Themes and the four exports",
    async run(context, record, findings) {
      const capabilities = await capabilitiesOf(context.base, context.token);

      expect(
        capabilities.compatibility?.compilerRelease === context.pins.compiler,
        `the deployment reports compiler ${capabilities.compatibility?.compilerRelease}; this repository pins ` +
          `${context.pins.compiler}. A walkthrough must be performed against the build that ships.`,
      );
      const fingerprint = capabilities.compatibility?.capabilityFingerprint;
      expect(
        /^sha256:[0-9a-f]{64}$/.test(fingerprint ?? ""),
        `the capability fingerprint is missing: ${fingerprint}`,
      );
      // The fingerprint is taken over the unprobed registry document, so the
      // pinned release has exactly one and a deployment advertising another set
      // of capabilities is not the build this repository ships.
      expect(
        context.pins.capabilityFingerprint === null || fingerprint === context.pins.capabilityFingerprint,
        `the deployment's capability fingerprint ${fingerprint} is not the pinned release's ${context.pins.capabilityFingerprint}`,
      );
      expect(
        (capabilities.compatibility?.sourceLanguages ?? []).includes(2),
        `the deployment does not advertise azemark:2; it reports ${JSON.stringify(capabilities.compatibility?.sourceLanguages)}`,
      );
      record(`compiler ${capabilities.compatibility.compilerRelease} · fingerprint ${fingerprint}`);

      const themes = capabilities.compiler?.themes ?? [];
      expect(
        themes.length === APPROVED_THEME_COUNT,
        `the walkthrough toggles the ${APPROVED_THEME_COUNT} built-in Themes; the deployment advertises ${themes.length}`,
      );
      record(`themes ${themes.map((/** @type {any} */ theme) => theme.id).join(", ")}`);

      const formats = capabilities.compiler?.formats ?? [];
      for (const format of EXPORT_FORMATS) {
        expect(formats.includes(format), `the deployment does not advertise the ${format} export`);
      }
      record(`formats ${formats.join(", ")}`);

      const runtime = capabilities.compiler?.runtime?.canonical ?? null;
      expect(runtime !== null, "the deployment advertises no canonical runtime matrix");
      expect(
        runtime.os === APPROVED_RUNTIME.os && runtime.arch === APPROVED_RUNTIME.arch && runtime.node === APPROVED_RUNTIME.node,
        `the deployment's canonical runtime is ${runtime.os}/${runtime.arch} · node ${runtime.node}; ` +
          `the approved matrix is ${APPROVED_RUNTIME.os}/${APPROVED_RUNTIME.arch} · node ${APPROVED_RUNTIME.node}`,
      );
      record(`canonical runtime ${runtime.os}/${runtime.arch} · node ${runtime.node}`);

      findings.capabilities = {
        release: capabilities.compatibility.compilerRelease,
        fingerprint,
        themes: themes.map((/** @type {any} */ theme) => ({ id: theme.id, title: theme.title })),
        formats: [...formats],
        runtime,
      };
    },
  },

  {
    id: "source",
    title: "The representative Source: live diagnostics and ten-family coverage",
    async run(context, record, findings) {
      const job = await runToTerminal(
        context.base,
        context.token,
        jobRequest("analyze", jobSource(context.source), { includeDocument: true }, "walkthrough"),
        { timeoutMs: context.timeoutMs },
      );
      const result = settle(job, context.source.name);

      const diagnostics = job.result?.diagnostics ?? [];
      const errors = diagnostics.filter((/** @type {any} */ diagnostic) => diagnostic.severity === "error");
      const warnings = diagnostics.filter((/** @type {any} */ diagnostic) => diagnostic.severity !== "error");
      for (const diagnostic of warnings) {
        record(`warning ${diagnostic.code}: ${diagnostic.message}`);
      }
      expect(
        errors.length === 0,
        `${context.source.name} must open without errors; ` +
          `saw ${errors.map((/** @type {any} */ diagnostic) => diagnostic.code).join(", ") || "none"}`,
      );
      expect(result?.semantic?.valid === true, `${context.source.name} did not validate into a Document`);
      record(`diagnostics: ${diagnostics.length} (${warnings.length} warning(s), no errors)`);

      const coverage = coverageReport(result.semantic.document);
      const uncovered = uncoveredUnits(result.semantic.document);
      for (const unit of coverage) {
        record(
          `${unit.covered ? "covered" : "MISSING"} ${unit.id}: ` +
            unit.kinds.map((entry) => `${entry.kind}${entry.present ? "" : "?"}`).join(", "),
        );
      }
      expect(
        uncovered.length === 0,
        `${context.source.name} does not span the required capability families: ${uncovered.join(", ")}`,
      );

      findings.source = {
        name: context.source.name,
        diagnostics: diagnosticList(job),
        kinds: coverage.flatMap((unit) => unit.kinds.filter((entry) => entry.present).map((entry) => entry.kind)),
        coverage,
      };
    },
  },

  {
    id: "themes",
    title: "Theme toggle: one semantic identity, three layouts",
    async run(context, record, findings) {
      const themes = findings.capabilities?.themes ?? [];
      expect(themes.length > 0, "the capabilities step did not report any Theme");

      for (const theme of themes) {
        const job = await runToTerminal(
          context.base,
          context.token,
          jobRequest("compile", jobSource(context.source), { format: "html", theme: theme.id }, "walkthrough"),
          { timeoutMs: context.timeoutMs },
        );
        const result = settle(job, `theme ${theme.id}`);
        expect(result.ok === true, `theme ${theme.id}: the compile failed`);
        const contentHash = result.semantic?.contentHash ?? null;
        expect(contentHash !== null, `theme ${theme.id}: the compile published no contentHash`);
        record(`${theme.id}: contentHash ${contentHash}, layout ${result.artifact.artifactHash.slice(0, 22)}…`);
        findings.themes.push({
          id: theme.id,
          contentHash,
          artifactHash: result.artifact.artifactHash,
          byteLength: result.artifact.byteLength,
        });
      }

      const identities = new Set(findings.themes.map((theme) => theme.contentHash));
      expect(
        identities.size === 1,
        `a Theme is a layout input and cannot change Document identity; saw ${[...identities].join(", ")}`,
      );
      expect(
        new Set(findings.themes.map((theme) => theme.artifactHash)).size === findings.themes.length,
        "the Themes produced identical bytes: the Theme choice did not reach the render",
      );
    },
  },

  {
    id: "exports",
    title: "Export: HTML, SVG, PNG and PDF from one Document",
    async run(context, record, findings) {
      for (const format of EXPORT_FORMATS) {
        const job = await runToTerminal(
          context.base,
          context.token,
          jobRequest("compile", jobSource(context.source), { format }, "walkthrough"),
          { timeoutMs: context.timeoutMs },
        );
        const result = settle(job, `export ${format}`);
        expect(
          result.ok === true,
          `export ${format}: the compile failed with ${diagnosticList(job).join(", ") || "no diagnostics"}`,
        );

        const downloaded = await downloadArtifact(context.base, context.token, job, {
          label: `export ${format}`,
          timeoutMs: context.timeoutMs,
        });
        const path = join(context.outDir, `${context.source.name.replace(/\.aze\.md$/, "")}.${format}`);
        await writeFile(path, downloaded.bytes);

        record(
          `${format}: ${downloaded.bytes.byteLength} bytes, ${downloaded.artifact.mimeType}, ` +
            `${downloaded.artifact.artifactHash.slice(0, 22)}… verified`,
        );
        findings.formats.push({
          format,
          mimeType: downloaded.artifact.mimeType,
          byteLength: downloaded.bytes.byteLength,
          artifactHash: downloaded.artifact.artifactHash,
          contentHash: downloaded.contentHash,
          path,
        });
      }

      const identities = new Set(findings.formats.map((entry) => entry.contentHash));
      expect(
        identities.size === 1 && !identities.has(null),
        `one Document must keep one identity across formats; saw ${[...identities].join(", ")}`,
      );
      findings.fixture = { name: context.source.name, contentHash: findings.formats[0]?.contentHash ?? null };
      record(`contentHash identical across all four exports: ${findings.fixture.contentHash}`);
    },
  },

  {
    id: "golden",
    title: "Golden spot-check: a re-render is byte-identical and matches the recording",
    async run(context, record, findings) {
      expect(context.goldens.length > 0, "no golden Source was sampled");

      for (const golden of context.goldens) {
        /** @type {Buffer[]} */
        const renders = [];
        for (const pass of [1, 2]) {
          const job = await runToTerminal(
            context.base,
            context.token,
            jobRequest("compile", jobSource(golden), { format: "html" }, "walkthrough"),
            { timeoutMs: context.timeoutMs },
          );
          const result = settle(job, `${golden.name} pass ${pass}`);
          expect(result.ok === true, `${golden.name} pass ${pass}: the compile failed`);
          const downloaded = await downloadArtifact(context.base, context.token, job, {
            label: `${golden.name} pass ${pass}`,
            timeoutMs: context.timeoutMs,
          });
          renders.push(downloaded.bytes);
          findings.determinism.push({
            source: golden.name,
            format: "html",
            contentHash: downloaded.contentHash,
            artifactHash: downloaded.artifact.artifactHash,
            byteLength: downloaded.bytes.byteLength,
          });
        }

        const [first, second] = renders;
        if (first === undefined || second === undefined) throw new CheckFailure(`${golden.name}: no render`);
        expect(
          first.equals(second),
          `${golden.name}: two renders of the same Source differ (${sha256(first)} vs ${sha256(second)})`,
        );
        record(`${golden.name}: two renders byte-identical at ${sha256(first).slice(0, 22)}…`);

        if (context.recordGolden === true) {
          // Recording is not verifying: the run that records the identity has
          // nothing to compare against yet, and a deliberate re-record must not
          // be blocked by the drift it is re-recording.
          record(`${golden.name}: recording this render as the golden identity`);
          continue;
        }

        const render = findings.determinism.at(-1);
        if (render === undefined) throw new CheckFailure(`${golden.name}: no render to compare`);
        const differences = goldenDifferences(context.goldenIdentity, render, {
          path: context.goldenIdentityPath,
        });
        expect(
          differences.length === 0,
          `${golden.name} drifted from the recorded golden: ${differences.join("; ")}`,
        );
        record(
          `${golden.name}: matches the identity recorded on ${context.goldenIdentity?.image ?? "unknown"} ` +
            `at ${render.artifactHash.slice(0, 22)}…`,
        );
      }
    },
  },
];

/**
 * Run every step against one deployment.
 *
 * @param {WalkthroughContext} context
 * @param {((line: string) => void) | null} [emitLine] called with each recorded line
 * @returns {Promise<{
 *   results: { id: string, title: string, ok: boolean, detail: string | null, evidence: string[] }[],
 *   findings: Findings,
 *   passed: number,
 *   failed: number,
 * }>}
 */
export async function runWalkthrough(context, emitLine = null) {
  await mkdir(context.outDir, { recursive: true });
  const findings = emptyFindings();
  /** @type {{ id: string, title: string, ok: boolean, detail: string | null, evidence: string[] }[]} */
  const results = [];

  for (const [index, step] of STEPS.entries()) {
    emitLine?.(`[${index + 1}/${STEPS.length}] ${step.id} · ${step.title}`);
    /** @type {string[]} */
    const evidence = [];
    const record = (/** @type {string} */ line) => {
      evidence.push(line);
      emitLine?.(`    · ${line}`);
    };
    const started = Date.now();
    let ok = false;
    let detail = null;
    try {
      await step.run(context, record, findings);
      ok = true;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    emitLine?.(
      `    ${ok ? "PASS" : "FAIL"} (${((Date.now() - started) / 1000).toFixed(1)}s)${ok ? "" : `: ${detail}`}`,
    );
    emitLine?.("");
    results.push({ id: step.id, title: step.title, ok, detail, evidence });
  }

  const passed = results.filter((result) => result.ok).length;
  return { results, findings, passed, failed: results.length - passed };
}

