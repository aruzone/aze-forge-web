#!/usr/bin/env node
/**
 * The Checkpoint B owner walkthrough (`aruzone/aze-forge#53` §6, §8).
 *
 *   node scripts/walkthrough.mjs --image aze-forge-web:<tag>
 *   node scripts/walkthrough.mjs --base-url http://127.0.0.1:8080 --container azeweb
 *   node scripts/walkthrough.mjs --image aze-forge-web:<tag> --approve <consented-identifier>
 *
 * The script performs the walkthrough's automated half against the deployed
 * service — open the representative ten-family Source, read live diagnostics,
 * toggle the three Themes, export HTML/SVG/PNG/PDF, spot-verify the golden
 * report by re-rendering it — and records the result as one manual-evidence
 * entry in `acceptance/manual-evidence/`. The owner performs the same pass in
 * the browser and records the binary decision with `--approve` or `--reject`;
 * until then the entry stays `pending-owner-approval`.
 *
 * The walkthrough never stages the image it was not given: `--image` runs the
 * tag as deployed, which is what "staged == cutover image" asks for.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRecorder,
  evidenceStamp,
  numberOption,
  parseArgs,
  redact,
  repeatedOption,
  stringOption,
  tokenDigest,
} from "./cli.mjs";
import { CONTAINER_DEVIATIONS, CONTAINER_FLAGS, awaitReady, freePort, imageIdentity, startContainer, stopContainer } from "./containers.mjs";
import { collectCompilerFacts } from "../src/service/compiler-facts.mjs";
import { GOLDEN_IDENTITY_SCHEMA, goldenIdentityFrom, readGoldenIdentity } from "./walkthrough/golden.mjs";
import { runWalkthrough } from "./walkthrough/checks.mjs";
import {
  OWNER_APPROVED,
  OWNER_NOT_APPROVED,
  WALKTHROUGH_ACCEPTANCE_ID,
  buildEntry,
} from "./walkthrough/record.mjs";
import { GOLDEN_REPORT, REPO, WALKTHROUGH_SOURCE, readSource } from "./walkthrough/sources.mjs";

const USAGE = `AzeForge Web owner walkthrough (Checkpoint B)

  node scripts/walkthrough.mjs --image <image>                 stage the image and walk through it
  node scripts/walkthrough.mjs --base-url <url> --container <name>   walk through a deployment

Options
  --image <ref>              image to stage (docker run, never rebuilt here)
  --base-url <url>           deployed service to walk through
  --container <name>         staged container behind --base-url
  --token <token>            deployment token (default: env AZEWEB_ACCESS_TOKEN)
  --source <path>            the representative Source (default acceptance/walkthrough.aze.md)
  --golden <path>            a golden Source to spot-verify (repeatable; default acceptance/golden-report.aze.md)
  --golden-identity <path>   the recorded golden identity to compare against
                             (default acceptance/golden-identity.json)
  --record-golden            re-record the golden identity from this (green) run
  --timeout-ms <n>           per-job deadline (default 300000)
  --out-dir <dir>            where exported Artifacts are written (default acceptance/walkthrough/<stamp>-artifacts)
  --evidence-dir <dir>       where the recorded run goes (default acceptance/walkthrough)
  --approve <identifier>     record the owner's Approve against this consent identifier
  --reject <identifier>      record the owner's Not approved against this consent identifier
  --note <text>              a note carried into the recorded run
  --keep                     leave the staged container running
  --no-evidence              print the report without recording it
  --help
`;

/** @type {Record<string, string | boolean>} */
let options;
try {
  options = parseArgs(process.argv.slice(2), { booleans: ["keep", "record-golden"] });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(2);
}

if (options.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

/** @param {string} name @param {string} fallback */
function pathOption(name, fallback) {
  const value = stringOption(options, name);
  return value === null ? fallback : resolve(value);
}

const startedAt = new Date();
const stamp = evidenceStamp(startedAt);
const { lines, emit, heading } = createRecorder();

const timeoutMs = numberOption(options, "timeout-ms", 300_000);
const evidenceDir = pathOption("evidence-dir", join(REPO, "acceptance", "walkthrough"));
const manualEvidenceDir = join(REPO, "acceptance", "manual-evidence");
const outDir = pathOption("out-dir", join(evidenceDir, `${stamp}-artifacts`));
const sourcePath = pathOption("source", WALKTHROUGH_SOURCE);
const goldenArguments = repeatedOption(process.argv, "golden").map((path) => resolve(path));
const goldenPaths = goldenArguments.length === 0 ? [GOLDEN_REPORT] : goldenArguments;
const goldenIdentityPath = pathOption("golden-identity", join(REPO, "acceptance", "golden-identity.json"));
const approve = stringOption(options, "approve");
const reject = stringOption(options, "reject");
const keep = options.keep === true;
const recordGolden = options["record-golden"] === true;

if (approve !== null && reject !== null) {
  process.stderr.write("--approve and --reject are exclusive\n");
  process.exit(2);
}

/** The exact release this repository pins; a walkthrough against another build
 * would approve something that does not ship. */
async function repoPins() {
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  const { CHROME_HEADLESS_SHELL_VERSION } = await import("@aruzone/aze-forge/adapters");
  const compilerPin = packageJson.dependencies["@aruzone/aze-forge"];
  if (typeof compilerPin !== "string" || !/^\d+\.\d+\.\d+/.test(compilerPin)) {
    throw new Error(`package.json must pin an exact @aruzone/aze-forge release; found ${compilerPin}`);
  }
  // The fingerprint the pinned release computes over its own registry: a
  // deployment advertising another set of capabilities is not this build, even
  // when it advertises the same release string.
  const { capabilityFingerprint } = await collectCompilerFacts();
  return { compiler: compilerPin, browser: CHROME_HEADLESS_SHELL_VERSION, capabilityFingerprint };
}

const pins = await repoPins();
const token = stringOption(options, "token") ?? process.env.AZEWEB_ACCESS_TOKEN ?? randomBytes(24).toString("hex");

/** @type {{ id: string, digests: string[] } | null} */
let image = null;
/** @type {string | null} */
let staged = null;

try {
  const imageRef = stringOption(options, "image");
  /** @type {string} */
  let base;
  /** @type {string | null} */
  let container;
  /** @type {string[]} */
  const runCommands = [];

  if (imageRef !== null) {
    image = imageIdentity(imageRef);
    const port = await freePort();
    container = `azeweb-walkthrough-${process.pid}`;
    emit("staging the deployment profile…");
    const started = startContainer({ name: container, image: imageRef, port, env: { AZEWEB_ACCESS_TOKEN: token } });
    staged = container;
    runCommands.push(redact(started.command, token));
    await awaitReady({ base: started.base, container });
    base = started.base;
  } else {
    const url = stringOption(options, "base-url");
    if (url === null) {
      process.stderr.write(`--image or --base-url is required\n\n${USAGE}`);
      process.exit(2);
    }
    base = url.replace(/\/$/, "");
    container = stringOption(options, "container");
  }

  const source = await readSource(sourcePath);
  const goldens = await Promise.all(goldenPaths.map(readSource));

  heading("AzeForge Web owner walkthrough (Checkpoint B)");
  heading(`  started     ${startedAt.toISOString()}`);
  if (image !== null) heading(`  image       ${stringOption(options, "image")} (${image.id})`);
  heading(`  staged      ${base}${container === null ? "" : ` (container ${container})`}`);
  heading(`  compiler    ${pins.compiler} (pinned by package.json)`);
  heading(`  browser     chrome-headless-shell ${pins.browser} (pinned by the compiler)`);
  heading(`  token       sha256:${tokenDigest(token)}… (hashed; never printed)`);
  heading(`  source      ${relative(REPO, source.path)}`);
  for (const golden of goldens) heading(`  golden      ${relative(REPO, golden.path)}`);
  for (const command of runCommands) heading(`  docker run  docker ${command}`);
  if (imageRef !== null) {
    heading(`  hardening   ${CONTAINER_FLAGS.join(" ")}`);
    for (const deviation of CONTAINER_DEVIATIONS) heading(`  deviation   ${deviation}`);
  }
  heading("");


  const goldenIdentity = await readGoldenIdentity(goldenIdentityPath);
  const context = {
    base,
    token,
    pins,
    timeoutMs,
    outDir,
    source,
    goldens,
    imageId: image?.id ?? null,
    goldenIdentity,
    goldenIdentityPath,
    recordGolden,
  };
  const { results, findings, passed, failed } = await runWalkthrough(context, (line) => {
    lines.push(line);
    process.stdout.write(`${line}\n`);
  });

  heading(`${results.length} steps, ${passed} passed, ${failed} failed`);

  /** @type {{ result: string, consentedIdentifier: string } | null} */
  let decision = null;
  let decisionDetail = "owner decision not recorded in this run";
  if (approve !== null && failed > 0) {
    decisionDetail = `refusing to record Approve: ${failed} automated step(s) failed`;
    process.exitCode = 2;
  } else if (approve !== null) {
    decision = { result: OWNER_APPROVED, consentedIdentifier: approve };
    decisionDetail = `owner ${approve} recorded ${OWNER_APPROVED}`;
  } else if (reject !== null) {
    decision = { result: OWNER_NOT_APPROVED, consentedIdentifier: reject };
    decisionDetail = `owner ${reject} recorded ${OWNER_NOT_APPROVED}`;
  }
  heading(`  owner       ${decisionDetail}`);

  if (recordGolden) {
    // The identity comes from the golden renders, so their step is what has to
    // be green: a walkthrough blocked elsewhere still renders the golden.
    const goldenStep = results.find((result) => result.id === "golden");
    if (goldenStep === undefined || !goldenStep.ok) {
      process.stderr.write(
        `refusing to record a golden identity: the golden step ${goldenStep?.detail ?? "did not run"}\n`,
      );
      process.exitCode = 2;
    } else {
      await writeFile(
        goldenIdentityPath,
        `${JSON.stringify(
          goldenIdentityFrom({
            recordedAt: new Date().toISOString(),
            image: image?.id ?? null,
            findings,
          }),
          null,
          2,
        )}\n`,
      );
      emit(`  recorded    ${relative(REPO, goldenIdentityPath)} (${GOLDEN_IDENTITY_SCHEMA})`);
    }
  }

  const automated = {
    date: startedAt.toISOString(),
    os: `${process.platform} ${process.arch} · node ${process.version}`,
    canonicalRuntime: findings.capabilities?.runtime ?? null,
    containerDeviations: image === null ? null : [...CONTAINER_DEVIATIONS],
    compilerRelease: findings.capabilities?.release ?? "unknown",
    compilerFingerprint: findings.capabilities?.fingerprint ?? "unknown",
    fixture: findings.fixture ?? { name: source.name, contentHash: null },
    fixtureArtifactHashes: Object.fromEntries(findings.formats.map((entry) => [entry.format, entry.artifactHash])),
    commands: [
      imageRef === null
        ? `npm run walkthrough -- --base-url ${base}`
        : `npm run walkthrough -- --image ${imageRef}`,
    ],
  };
  const entry = buildEntry(automated, decision, {
    note:
      "One scripted owner pass over the deployed alpha: a Source spanning all ten native capability families plus composition, live diagnostics, the three Themes, HTML/SVG/PNG/PDF exports, and a re-render spot-check of the golden report. The owner performs the same pass in the browser and records the binary decision.",
    unresolvedNotes: results
      .filter((result) => !result.ok)
      .map((result) => `${result.id}: ${result.detail}`),
  });

  const finishedAt = new Date();
  heading(`  finished    ${finishedAt.toISOString()} (${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s)`);

  if (options.evidence !== false) {
    const report = lines.join("\n");
    if (report.includes(token)) {
      throw new Error("the walkthrough report contains the access token; refusing to record it");
    }
    await mkdir(evidenceDir, { recursive: true });
    await mkdir(manualEvidenceDir, { recursive: true });
    const base_ = join(evidenceDir, `${stamp}-${failed === 0 ? "pass" : "fail"}`);
    await writeFile(`${base_}.txt`, `${report}\n`);
    await writeFile(
      `${base_}.json`,
      `${JSON.stringify(
        {
          schema: "azeforge.web.walkthrough-evidence/v1",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          image: image === null ? null : { reference: stringOption(options, "image"), ...image },
          target: { base, container },
          pins,
          containerFlags: image === null ? null : CONTAINER_FLAGS,
          containerDeviations: image === null ? null : CONTAINER_DEVIATIONS,
          sources: {
            walkthrough: relative(REPO, source.path),
            goldens: goldens.map((golden) => relative(REPO, golden.path)),
          },
          outDir: relative(REPO, outDir),
          passed,
          failed,
          steps: results,
          findings,
          manualEvidence: entry,
        },
        null,
        2,
      )}\n`,
    );
    const manualPath = join(manualEvidenceDir, `${WALKTHROUGH_ACCEPTANCE_ID.toLowerCase()}.json`);
    await writeFile(manualPath, `${JSON.stringify(entry, null, 2)}\n`);
    emit(`  evidence    ${relative(REPO, base_)}.json`);
    emit(`  entry       ${relative(REPO, manualPath)} (${entry.schema}, status ${entry.status})`);
    emit(`  artifacts   ${relative(REPO, outDir)}/`);
  }

  if (failed > 0 && process.exitCode !== 2) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
} finally {
  if (staged !== null) {
    if (keep) process.stdout.write(`kept container ${staged}\n`);
    else stopContainer(staged);
  }
}
