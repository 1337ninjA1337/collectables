#!/usr/bin/env tsx
/**
 * Prints what the exported web bundle is made of, per package and per module.
 *
 * A REPORT, not a gate: it has no budget, it fails nothing, and it is not a
 * leg of `npm run verify`. `check-bundle-size` says how big the bundle is and
 * how much of the last raise this build has spent; six rounds of suggestions
 * asked what spent it, and this is the answer — the input the next raise (or
 * the first round told to make the bundle SMALLER) wants and has never had.
 *
 * Needs a SOURCEMAPPED export, which `npm run build` is not: `expo export`
 * writes maps only with `--source-maps`, and the deploy workflow strips them
 * out of the published artifact. `npm run build:sourcemaps` is that export;
 * run it first, or this says so and exits rather than reporting a bundle it
 * could not read.
 *
 * Pure logic — the VLQ decoder, the attribution and the buckets — lives in
 * `lib/bundle-composition.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  attributeChunkBytes,
  BASELINE_BUCKET_FLOOR_BYTES,
  formatCompositionDriftReport,
  formatCompositionReport,
  summarizeComposition,
  type Composition,
  type SourceMapLike,
} from "../lib/bundle-composition";
import { COMPOSITION_BASELINE } from "../lib/composition-snapshot";
import { REPO_ROOT, assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "report-bundle-composition";

/** How a caller gets the maps this needs, named in one place. */
const SOURCEMAP_HINT =
  "Run `npm run build:sourcemaps` first — `npm run build` exports without them.";

function main(): void {
  // The same premise the post-build guards share: a report over a stale
  // `dist/` would describe yesterday's bundle with today's confidence.
  const bundlePaths = assertBundlePremise(CHECK_NAME);

  const mapped = bundlePaths.filter((full) => fs.existsSync(`${full}.map`));
  if (mapped.length === 0) {
    console.error(
      `${CHECK_NAME}: no sourcemaps beside the ${String(bundlePaths.length)} exported chunk(s) — ${SOURCEMAP_HINT}`,
    );
    process.exit(1);
  }
  if (mapped.length < bundlePaths.length) {
    console.log(
      `${CHECK_NAME}: ${String(bundlePaths.length - mapped.length)} chunk(s) have no sourcemap and are left out. ${SOURCEMAP_HINT}`,
    );
  }

  const wholeBundle = new Map<string, number>();
  const sections: string[] = [];
  for (const full of mapped) {
    const relative = path.relative(REPO_ROOT, full);
    const code = fs.readFileSync(full, "utf8");
    const map = JSON.parse(fs.readFileSync(`${full}.map`, "utf8")) as SourceMapLike;
    const perSource = attributeChunkBytes(code, map);
    for (const [source, bytes] of perSource) {
      wholeBundle.set(source, (wholeBundle.get(source) ?? 0) + bytes);
    }
    sections.push(
      formatCompositionReport(relative, summarizeComposition(perSource, REPO_ROOT)),
    );
  }

  const whole = summarizeComposition(wholeBundle, REPO_ROOT);

  // `--snapshot` prints the literal to paste into `lib/composition-snapshot.ts`
  // and nothing else, so re-taking the baseline is a copy rather than a
  // hand-transcription of twenty numbers off a report.
  if (process.argv.includes("--snapshot")) {
    console.log(formatSnapshotLiteral(whole));
    return;
  }

  // The whole bundle first: the budget is a sum over the chunks, so the
  // question "what spent the last raise" is asked of the sum before it is
  // asked of either half.
  if (mapped.length > 1) {
    console.log(formatCompositionReport(`all ${String(mapped.length)} chunks`, whole));
    console.log("");
  }
  console.log(sections.join("\n\n"));

  const drift = formatCompositionDriftReport(whole, COMPOSITION_BASELINE);
  console.log("");
  console.log(
    drift ??
      `${CHECK_NAME}: identical to the ${COMPOSITION_BASELINE.takenOn} measurement — nothing moved.`,
  );
}

/**
 * Today's buckets as the source of `lib/composition-snapshot.ts`.
 *
 * Only the buckets above the floor: below it the list is a long tail of
 * one-file packages that churn on every dependency bump, and a baseline that
 * churns is one nobody re-takes.
 */
function formatSnapshotLiteral(composition: Composition): string {
  const rows = composition.buckets
    .filter((entry) => entry.bytes >= BASELINE_BUCKET_FLOOR_BYTES)
    .map((entry) => `    ${JSON.stringify(entry.label)}: ${String(entry.bytes)},`);
  return [
    `  takenOn: ${JSON.stringify(new Date().toISOString().slice(0, 10))},`,
    `  totalBytes: ${String(composition.totalBytes)},`,
    "  buckets: {",
    ...rows,
    "  },",
  ].join("\n");
}

main();
