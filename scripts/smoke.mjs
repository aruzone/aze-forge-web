#!/usr/bin/env node
/**
 * The deployment acceptance smoke suite of the alpha operating envelope
 * (section 14): nine checks, run against a staged container, with the recorded
 * output as the evidence artifact.
 *
 *   node scripts/smoke.mjs --image aze-forge-web:<tag>
 *   node scripts/smoke.mjs --base-url https://… --probe-base-url https://… \
 *     --container <name> --probe-container <name>
 *
 * The image is staged the way it is deployed (hardening flags in
 * `smoke/containers.mjs`, documented in README.md), twice: the deployment
 * profile, and a probe profile whose compile deadline and result retention are
 * lowered so the deadline and expiry checks have something to interrupt. The
 * probe profile changes configuration only — it is the same image.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, CheckFailure } from "./smoke/checks.mjs";
import {
  CONTAINER_DEVIATIONS,
  CONTAINER_FLAGS,
  awaitReady,
  freePort,
  imageIdentity,
  startContainer,
  stopContainer,
} from "./smoke/containers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

const USAGE = `AzeForge Web deployment acceptance smoke suite

  node scripts/smoke.mjs --image <image>                     stage the image and run
  node scripts/smoke.mjs --base-url <url> --probe-base-url <url> \\
       --container <name> --probe-container <name>           run against a deployment

Options
  --image <ref>                   image to stage (docker run, never rebuilt here)
  --base-url <url>                staged deployment to check
  --probe-base-url <url>          the probe-profile deployment
  --container <name>              staged container (browser-process and log evidence)
  --probe-container <name>        probe-profile container
  --token <token>                 deployment token (default: env AZEWEB_ACCESS_TOKEN)
  --wedge-diagrams <n>            diagrams in the slow Source (default 100)
  --probe-compile-deadline-ms <n> probe profile compile deadline (default 5000)
  --probe-result-ttl-ms <n>       probe profile result retention (default 1000)
  --evidence-dir <dir>            where the recorded output goes (default acceptance/smoke)
  --keep                          leave staged containers running
  --no-evidence                   print the report without recording it
  --help
`;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--keep") {
      options.keep = true;
      continue;
    }
    if (argument === "--no-evidence") {
      options.evidence = false;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected argument ${argument}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} needs a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

/** @param {Record<string, string | boolean>} options @param {string} name @param {number} fallback */
function numberOption(options, name, fallback) {
  const raw = options[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

/** @param {Record<string, string | boolean>} options @param {string} name */
function stringOption(options, name) {
  const raw = options[name];
  return typeof raw === "string" ? raw : null;
}

async function repoPins() {
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  const { CHROME_HEADLESS_SHELL_VERSION } = await import("@aruzone/aze-forge/adapters");
  const compilerPin = packageJson.dependencies["@aruzone/aze-forge"];
  if (typeof compilerPin !== "string" || !/^\d+\.\d+\.\d+/.test(compilerPin)) {
    throw new Error(`package.json must pin an exact @aruzone/aze-forge release; found ${compilerPin}`);
  }
  return { compiler: compilerPin, browser: CHROME_HEADLESS_SHELL_VERSION };
}

const startedAt = new Date();

/** @param {string[]} command @param {string} secret */
function redact(command, secret) {
  return command.map((part) => part.split(secret).join("<redacted>")).join(" ");
}

/** @type {string[]} */
const lines = [];
/** @param {string} line */
function emit(line) {
  lines.push(line);
  process.stdout.write(`${line}\n`);
}

/** @param {string} text */
function heading(text) {
  emit(`${text}`);
}

/** @type {Record<string, string | boolean>} */
let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(2);
}

if (options.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const wedgeDiagrams = numberOption(options, "wedge-diagrams", 100);
const probeCompileDeadlineMs = numberOption(options, "probe-compile-deadline-ms", 5_000);
const probeResultTtlMs = numberOption(options, "probe-result-ttl-ms", 1_000);
const evidenceDir = stringOption(options, "evidence-dir") ?? join(REPO, "acceptance", "smoke");
const keep = options.keep === true;

const pin = await repoPins();
const token = stringOption(options, "token") ?? process.env.AZEWEB_ACCESS_TOKEN ?? randomBytes(24).toString("hex");

/** @type {{ base: string, probeBase: string, container: string | null, probeContainer: string | null }} */
const target = { base: "", probeBase: "", container: null, probeContainer: null };
/** @type {{ id: string, digests: string[] } | null} */
let image = null;
/** @type {string[]} */
const staged = [];
/** @type {string[]} */
const runCommands = [];

try {
  const imageRef = stringOption(options, "image");
  if (imageRef !== null) {
    image = imageIdentity(imageRef);
    const port = await freePort();
    const probePort = await freePort();
    const container = `azeweb-smoke-${process.pid}-a`;
    const probeContainer = `azeweb-smoke-${process.pid}-b`;

    emit("staging the deployment profile…");
    const first = startContainer({
      name: container,
      image: imageRef,
      port,
      env: { AZEWEB_ACCESS_TOKEN: token },
    });
    staged.push(container);
    runCommands.push(redact(first.command, token));
    await awaitReady({ base: first.base, container });

    emit("staging the probe profile (lowered compile deadline and result retention)…");
    const second = startContainer({
      name: probeContainer,
      image: imageRef,
      port: probePort,
      env: {
        AZEWEB_ACCESS_TOKEN: token,
        AZEWEB_DEADLINE_COMPILE_MS: String(probeCompileDeadlineMs),
        AZEWEB_RESULT_TTL_MS: String(probeResultTtlMs),
      },
    });
    staged.push(probeContainer);
    runCommands.push(redact(second.command, token));
    await awaitReady({ base: second.base, container: probeContainer });

    target.base = first.base;
    target.probeBase = second.base;
    target.container = container;
    target.probeContainer = probeContainer;
  } else {
    const base = stringOption(options, "base-url");
    if (base === null) {
      process.stderr.write(`--image or --base-url is required\n\n${USAGE}`);
      process.exit(2);
    }
    target.base = base.replace(/\/$/, "");
    target.probeBase = (stringOption(options, "probe-base-url") ?? base).replace(/\/$/, "");
    target.container = stringOption(options, "container");
    target.probeContainer = stringOption(options, "probe-container");
  }

  heading("AzeForge Web deployment acceptance smoke suite");
  heading(`  started     ${startedAt.toISOString()}`);
  if (image !== null) {
    heading(`  image       ${stringOption(options, "image")} (${image.id})`);
  }
  heading(`  staged      ${target.base}${target.container === null ? "" : ` (container ${target.container})`}`);
  heading(`  probe       ${target.probeBase}${target.probeContainer === null ? "" : ` (container ${target.probeContainer})`}`);
  heading(`  compiler    ${pin.compiler} (pinned by package.json)`);
  heading(`  browser     chrome-headless-shell ${pin.browser} (pinned by the compiler)`);
  heading(`  token       sha256:${tokenDigest(token)}… (hashed; never printed)`);
  heading(`  wedge       ${wedgeDiagrams} diagrams`);
  for (const command of runCommands) heading(`  docker run  docker ${command}`);
  heading(`  hardening   ${CONTAINER_FLAGS.join(" ")}`);
  for (const deviation of CONTAINER_DEVIATIONS) heading(`  deviation   ${deviation}`);
  heading("");

  /** @type {{ id: string, title: string, ok: boolean, detail: string | null, evidence: string[] }[]} */
  const results = [];
  const context = {
    base: target.base,
    probeBase: target.probeBase,
    token,
    container: target.container,
    probeContainer: target.probeContainer,
    wedgeDiagrams,
    pins: pin,
  };

  for (const [index, check] of CHECKS.entries()) {
    emit(`[${index + 1}/${CHECKS.length}] ${check.id} · ${check.title}`);
    /** @type {string[]} */
    const evidence = [];
    const record = (/** @type {string} */ line) => {
      evidence.push(line);
      emit(`    · ${line}`);
    };
    const checkStarted = Date.now();
    let ok = false;
    let detail = null;
    try {
      await check.run(context, record);
      ok = true;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      if (!(error instanceof CheckFailure)) {
        detail = `unexpected failure: ${detail}`;
      }
    }
    emit(`    ${ok ? "PASS" : "FAIL"} (${((Date.now() - checkStarted) / 1000).toFixed(1)}s)${ok ? "" : `: ${detail}`}`);
    emit("");
    results.push({ id: check.id, title: check.title, ok, detail, evidence });
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  heading(`${results.length} checks, ${passed} passed, ${failed} failed`);
  const finishedAt = new Date();
  heading(`  finished    ${finishedAt.toISOString()} (${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s)`);

  if (options.evidence !== false) {
    // The recorded output is published as evidence: a deployment credential in
    // it would be a leak, so this is checked rather than assumed.
    const report = lines.join("\n");
    if (report.includes(token)) {
      throw new Error("the smoke report contains the access token; refusing to record it");
    }
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-").replace(/-Z$/, "Z");
    const base = join(evidenceDir, `${stamp}-${failed === 0 ? "pass" : "fail"}`);
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(`${base}.txt`, `${report}\n`);
    await writeFile(
      `${base}.json`,
      `${JSON.stringify(
        {
          schema: "azeforge.web.smoke-evidence/v1",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          image: image === null ? null : { reference: stringOption(options, "image"), ...image },
          target: {
            base: target.base,
            probeBase: target.probeBase,
            container: target.container,
            probeContainer: target.probeContainer,
          },
          pins: pin,
          wedgeDiagrams,
          containerFlags: CONTAINER_FLAGS,
          containerDeviations: CONTAINER_DEVIATIONS,
          runCommands,
          passed,
          failed,
          checks: results,
        },
        null,
        2,
      )}\n`,
    );
    emit(`  evidence    ${relative(REPO, base)}.txt`);
    emit(`  evidence    ${relative(REPO, base)}.json`);
  }

  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
} finally {
  if (staged.length > 0 && !keep) {
    for (const name of staged) stopContainer(name);
  } else if (staged.length > 0) {
    for (const name of staged) process.stdout.write(`kept container ${name}\n`);
  }
}

/** @param {string} token */
function tokenDigest(token) {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12);
}
