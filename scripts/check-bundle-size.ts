#!/usr/bin/env tsx
/**
 * Bundle-size budget gate. Fails when the exported web JS bundle
 * (`dist/_expo/static/js/web/*.js`, sourcemaps excluded) exceeds the budget
 * (default 4.5 MiB, override via BUNDLE_SIZE_BUDGET_BYTES).
 *
 * Runs as its own CI step right after `npm run build` (the bundle must exist
 * first). Pure logic lives in `lib/bundle-size.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  evaluateBundleSize,
  formatBundleSizeReport,
  resolveBundleSizeBudget,
  type BundleFile,
} from "../lib/bundle-size";
import { REPO_ROOT, assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "check-bundle-size";

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
  if (result.overBudget) process.exit(1);
}

main();
