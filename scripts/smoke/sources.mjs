/**
 * The Sources the acceptance suite runs, and the asset it uploads.
 *
 * They are generated here rather than pasted, so the suite cannot drift from
 * what it claims to exercise: the golden report is a file in the repository
 * (reviewable, and the same document every run), while the wedge is sized in
 * one place so the deadline and cancellation checks can reason about it.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

export const GOLDEN_REPORT_PATH = new URL("../../acceptance/golden-report.aze.md", import.meta.url);
export const FIGURE_PATH = new URL("../../acceptance/assets/figure.svg", import.meta.url);

/** The logical path the uploaded figure is bound to inside a job. */
export const FIGURE_ASSET_PATH = "figure.svg";

export function readGoldenReport() {
  return readFile(GOLDEN_REPORT_PATH, "utf8");
}

export function readFigure() {
  return readFile(FIGURE_PATH);
}

/**
 * A Source whose compile cost is dominated by browser launches: one diagram per
 * `mermaid` block, each rendered by a fresh pinned browser. It exists to be
 * killed — by a deadline or by cancellation — which is why its size is a
 * parameter rather than a constant.
 *
 * @param {number} diagramCount
 */
export function wedgeSource(diagramCount) {
  const lines = [
    "---",
    "azemark: 2",
    "title: Acceptance wedge",
    "---",
    "",
    "# Acceptance wedge",
    "",
    "This document is deliberately slow to render, and is never expected to",
    "finish: it exists so a deadline or a cancellation has something to",
    "interrupt while the pinned browser is genuinely running.",
    "",
  ];
  for (let index = 0; index < diagramCount; index += 1) {
    lines.push(
      ":::: mermaid",
      `id: wedge-${index}`,
      `title: Wedge diagram ${index}`,
      "----",
      "flowchart LR",
      `  start${index}[Start] --> inspect${index}[Inspect setup]`,
      `  inspect${index} --> safe${index}{Safe?}`,
      `  safe${index} -- No --> correct${index}[Correct setup]`,
      `  correct${index} --> inspect${index}`,
      `  safe${index} -- Yes --> record${index}[Record measurement]`,
      `  record${index} --> finish${index}[Finish]`,
      "::::",
      "",
    );
  }
  return lines.join("\n");
}

/** The document the asset round trip compiles: one bound project image. */
export function figureDocument() {
  return [
    "---",
    "azemark: 2",
    "title: Asset round trip",
    "---",
    "",
    "# Asset round trip",
    "",
    `![Acceptance figure](${FIGURE_ASSET_PATH})`,
    "",
  ].join("\n");
}

/**
 * A Source that renders without the browser, for the retention check: the
 * expiry is what is being observed, not the render.
 */
export function minimalDocument() {
  return [
    "---",
    "azemark: 2",
    "title: Retention probe",
    "---",
    "",
    "# Retention probe",
    "",
    "One paragraph, compiled so that the retention window has an Artifact to expire.",
    "",
  ].join("\n");
}

/** A fresh, unguessable canary for the privacy spot check. */
export function newCanary() {
  return `azeweb-canary-${randomBytes(12).toString("hex")}`;
}

/**
 * A Source that carries the canary through a job that also produces compiler
 * diagnostics, so Source text has every opportunity to reach a log line.
 *
 * @param {string} canary
 */
export function canarySource(canary) {
  return [
    "---",
    "azemark: 2",
    "title: Privacy canary",
    "---",
    "",
    "# Privacy canary",
    "",
    `The deployment must never log this Source. Canary: ${canary}.`,
    "",
    ":::: mystery",
    `body ${canary}`,
    "::::",
    "",
  ].join("\n");
}
