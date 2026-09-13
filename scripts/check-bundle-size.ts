#!/usr/bin/env tsx
/**
 * Bundle-size budget gate. Fails when the exported web JS bundle
 * (`dist/_expo/static/js/web/*.js`, sourcemaps excluded) exceeds the budget
 * (default 3.67 MiB, override via BUNDLE_SIZE_BUDGET_BYTES) — or when the
 * bytes OUTSIDE the entry chunk fall below `LAZY_CHUNK_FLOOR_BYTES`, which is
 * what a package that stopped being lazy looks like to a sum that did not
 * change.
 *
 * Runs as its own CI step right after `npm run build` (the bundle must exist
 * first). Pure logic lives in `lib/bundle-size.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  evaluateBundleSize,
  evaluateLazySplit,
  formatBundleSizeReport,
  formatLazySplitReport,
  lazySplitFailed,
  resolveBundleSizeBudget,
  type BundleFile,
} from "../lib/bundle-size";
import {
  formatCopyDriftLine,
  translationsFootprint,
} from "../lib/translations-footprint";
import { REPO_ROOT, assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "check-bundle-size";

/** The one file the copy measure reads, relative to the repo root. */
const I18N_SOURCE = "lib/i18n-context.tsx";

function main(): void {
  // Shared premise (dist/ present, at least one chunk, newer than the source
  // tree). A budget check that matched no chunks is 0 bytes — comfortably
  // under budget, and proof of nothing.
  const bundlePaths = assertBundlePremise(CHECK_NAME);

  const files: BundleFile[] = bundlePaths.map((full) => ({
    path: path.relative(REPO_ROOT, full),
    bytes: fs.statSync(full).size,
  }));

  const budget = resolveBundleSizeBudget(process.env);
  const result = evaluateBundleSize(files, budget);
  console.log(formatBundleSizeReport(files, result));

  // The copy half of the drift. Read from SOURCE rather than from `dist/`,
  // which is the honest thing and also the only possible one: the bundle is
  // one minified blob and no chunk boundary separates the string table from
  // the screens that read it. See `lib/translations-footprint.ts` for why the
  // delta is a fair proxy even though the absolute number is not a share.
  const copyLine = formatCopyDriftLine(
    translationsFootprint(fs.readFileSync(path.join(REPO_ROOT, I18N_SOURCE), "utf8")),
  );
  if (copyLine) console.log(copyLine);

  // The half of the guard the total cannot see: a package that stops being
  // lazy moves its bytes from a chunk nothing fetches into the one every page
  // load does, and leaves the sum above where it was. Reported after the
  // budget and before the exit, so a build that is both over budget and newly
  // eager says both things rather than the first one it hits.
  const split = evaluateLazySplit(files);
  const splitFailed = lazySplitFailed(split);
  console[splitFailed ? "error" : "log"](formatLazySplitReport(split));

  if (result.overBudget || splitFailed) process.exit(1);
}

main();
