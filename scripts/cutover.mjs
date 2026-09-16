#!/usr/bin/env node
/**
 * The alpha cutover: run the acceptance evidence against one immutable image
 * and decide whether the alpha passes.
 *
 *   node scripts/cutover.mjs --image aze-forge-web:<tag> --catalog-report <path>
 *   node scripts/cutover.mjs --image aze-forge-web:<tag> --catalog-report <path> \
 *     --approve <consented-identifier>
 *
 * The rule is `aruzone/aze-forge#53` §8 and is evaluated in
 * `cutover/decision.mjs`: every automated semantic and deterministic-render
 * catalog entry green on the canonical host with no unpending drift, the
 * deployability smoke suite green against a staged container, and the owner's
 * Approve recorded on the walkthrough — all three against the same image
 * digest, because deployable means the staged image is the cutover image.
 *
 * The cutover runs the suites; it never re-implements them. Its record points
 * at their recorded output, which stays the evidence.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  createRecorder,
  evidenceStamp,
  numberOption,
  parseArgs,
  repeatedOption,
  stringOption,
} from "./cli.mjs";
import { imageIdentity } from "./containers.mjs";
import { APPROVED, DRIFT_REBASELINE, evaluateCatalog, evaluateCutover } from "./cutover/decision.mjs";
import { REPO } from "./pins.mjs";
import { spawnSync } from "node:child_process";

const USAGE = `AzeForge Web alpha cutover

  node scripts/cutover.mjs --image <image> [--catalog-report <path>] [--approve <identifier>]

Options
  --image <ref>              the immutable tag to stage and cut over (required)
  --catalog-report <path>    the compiler repository's acceptance report
                             (azeforge.acceptance-report/v1, from its
                             scripts/acceptance.mjs --json)
  --accept-drift <id>        an accepted unpending drift entry id (repeatable); the
                             azemark:2 re-baseline is the only one aruzone/aze-forge#53 §3 pre-approves
  --token <token>            deployment token (default: env AZEWEB_ACCESS_TOKEN)
  --timeout-ms <n>           per-job deadline for the walkthrough (default 300000)
  --approve <identifier>     the owner's Approve, recorded on the walkthrough entry
  --reject <identifier>      the owner's Not approved
  --note <text>              a note carried into the walkthrough entry
  --evidence-dir <dir>       where the cutover evidence goes (default acceptance/cutover)
  --keep                     leave staged containers running
  --no-evidence              print the report without recording it
  --help
`;

/** @type {Record<string, string | boolean>} */
let options;
try {
  options = parseArgs(process.argv.slice(2), { booleans: ["keep"] });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(2);
}

if (options.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const startedAt = new Date();
const stamp = evidenceStamp(startedAt);
const { lines, emit, heading } = createRecorder();

const imageRef = stringOption(options, "image");
if (imageRef === null) {
  process.stderr.write(`--image is required\n\n${USAGE}`);
  process.exit(2);
}

const evidenceDir = stringOption(options, "evidence-dir") ?? join(REPO, "acceptance", "cutover");
const timeoutMs = numberOption(options, "timeout-ms", 300_000);
const approve = stringOption(options, "approve");
const reject = stringOption(options, "reject");
const note = stringOption(options, "note");
const keep = options.keep === true;
const acceptedDrift = repeatedOption(process.argv, "accept-drift");
const token = stringOption(options, "token");
/** The suites stage their own containers; a token given here is the one they use. */
const tokenArgs = token === null ? [] : ["--token", token];

if (approve !== null && reject !== null) {
  process.stderr.write("--approve and --reject are exclusive\n");
  process.exit(2);
}

/**
 * Run one of the suites as the process it is, so its own recorded output stays
 * the evidence and this orchestrator only reads it.
 *
 * @param {string[]} args
 * @param {string} label
 */
function runSuite(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: REPO, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  emit(`  ${label} exited ${result.status ?? "without a status"}`);
  return result.status ?? 1;
}

/** The single evidence JSON a suite wrote into its own directory. */
/** @param {string} directory */
async function readOnlyJson(directory) {
  const entries = (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort();
  const last = entries.at(-1);
  if (last === undefined) throw new Error(`no evidence was recorded in ${relative(REPO, directory)}`);
  return { path: join(directory, last), value: JSON.parse(await readFile(join(directory, last), "utf8")) };
}

/** @param {string} path */
async function digestOf(path) {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

try {
  const image = imageIdentity(imageRef);

  // Each cutover run keeps the suites' own recorded output under its own
  // stamp, so a later run can never read an earlier run's evidence.
  const smokeDir = join(evidenceDir, "smoke", stamp);
  const walkthroughDir = join(evidenceDir, "walkthrough", stamp);
  await mkdir(smokeDir, { recursive: true });
  await mkdir(walkthroughDir, { recursive: true });

  heading("AzeForge Web alpha cutover");
  heading(`  started     ${startedAt.toISOString()}`);
  heading(`  image       ${imageRef} (${image.id})`);
  for (const digest of image.digests) heading(`  digest      ${digest}`);
  heading("");

  emit("[1/2] deployability smoke suite");
  const smokeStatus = runSuite(
    ["scripts/smoke.mjs", "--image", imageRef, "--evidence-dir", smokeDir, ...tokenArgs, ...(keep ? ["--keep"] : [])],
    "smoke",
  );
  const smokeEvidence = await readOnlyJson(smokeDir);
  emit("");

  emit("[2/2] owner walkthrough (Checkpoint B)");
  const walkthroughArgs = [
    "scripts/walkthrough.mjs",
    "--image",
    imageRef,
    "--evidence-dir",
    walkthroughDir,
    "--timeout-ms",
    String(timeoutMs),
    ...tokenArgs,
  ];
  if (approve !== null) walkthroughArgs.push("--approve", approve);
  if (reject !== null) walkthroughArgs.push("--reject", reject);
  if (note !== null) walkthroughArgs.push("--note", note);
  if (keep) walkthroughArgs.push("--keep");
  runSuite(walkthroughArgs, "walkthrough");
  const walkthroughEvidence = await readOnlyJson(walkthroughDir);
  const entry = walkthroughEvidence.value.manualEvidence;
  emit("");

  const catalogPath = stringOption(options, "catalog-report");
  const catalog =
    catalogPath === null
      ? null
      : await (async () => {
          const resolved = resolve(catalogPath);
          return {
            report: JSON.parse(await readFile(resolved, "utf8")),
            sha256: await digestOf(resolved),
            path: relative(REPO, resolved),
            acceptedDrift,
          };
        })();
  const catalogClause = evaluateCatalog(catalog);

  heading("AzeForge Web alpha cutover result");
  heading(`  smoke       ${smokeEvidence.value.passed} passed, ${smokeEvidence.value.failed} failed ` +
    `(${relative(REPO, smokeEvidence.path)})`);
  heading(`  walkthrough ${walkthroughEvidence.value.passed} passed, ${walkthroughEvidence.value.failed} failed ` +
    `(${relative(REPO, walkthroughEvidence.path)})`);
  heading(
    `  catalog     ${catalog === null ? "no report supplied" : `${catalog.path} (${catalogClause.detail})`}`,
  );
  if (acceptedDrift.length > 0) heading(`  drift       accepted: ${acceptedDrift.join(", ")}`);

  const evaluation = evaluateCutover({
    image: { reference: imageRef, ...image },
    catalog: catalogClause,
    smoke: {
      path: relative(REPO, smokeEvidence.path),
      passed: smokeEvidence.value.passed,
      failed: smokeEvidence.value.failed,
      imageId: smokeEvidence.value.image?.id ?? null,
    },
    walkthrough: {
      path: relative(REPO, walkthroughEvidence.path),
      passed: walkthroughEvidence.value.passed,
      failed: walkthroughEvidence.value.failed,
      imageId: walkthroughEvidence.value.image?.id ?? null,
      entry,
    },
  });

  for (const [clause, value] of Object.entries(evaluation.clauses)) {
    heading(`  clause ${clause.padEnd(12)} ${value.ok ? "ok" : "not ok"} · ${value.detail}`);
  }
  heading(`  decision    ${evaluation.decision}`);
  for (const reason of evaluation.reasons) heading(`  reason      ${reason}`);

  const finishedAt = new Date();
  heading(`  finished    ${finishedAt.toISOString()} (${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s)`);

  if (options.evidence !== false) {
    await mkdir(evidenceDir, { recursive: true });
    const base = join(evidenceDir, `${stamp}-${evaluation.decision}`);
    await writeFile(`${base}.txt`, `${lines.join("\n")}\n`);
    await writeFile(
      `${base}.json`,
      `${JSON.stringify(
        {
          schema: "azeforge.web.cutover-evidence/v1",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          image: { reference: imageRef, ...image },
          catalog: { report: catalog?.path ?? null, ...catalogClause },
          smoke: {
            evidence: relative(REPO, smokeEvidence.path),
            status: smokeStatus,
            passed: smokeEvidence.value.passed,
            failed: smokeEvidence.value.failed,
          },
          walkthrough: {
            evidence: relative(REPO, walkthroughEvidence.path),
            passed: walkthroughEvidence.value.passed,
            failed: walkthroughEvidence.value.failed,
            manualEvidence: entry,
          },
          approvedDriftExceptions: acceptedDrift,
          preApprovedBaseline: DRIFT_REBASELINE,
          decision: evaluation.decision,
          clauses: evaluation.clauses,
          reasons: evaluation.reasons,
        },
        null,
        2,
      )}\n`,
    );
    emit(`  evidence    ${relative(REPO, base)}.json`);
  }

  process.exitCode = evaluation.decision === APPROVED ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
