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

const REPO_ROOT = path.join(__dirname, "..");
const BUNDLE_DIR = path.join(REPO_ROOT, "dist", "_expo", "static", "js", "web");

function main(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(BUNDLE_DIR);
  } catch {
    console.error(
      `check-bundle-size: ERROR — ${path.relative(REPO_ROOT, BUNDLE_DIR)} not found. Run \`npm run build\` first.`,
    );
    process.exit(1);
    return;
  }

  const files: BundleFile[] = entries
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({
      path: path.relative(REPO_ROOT, path.join(BUNDLE_DIR, name)),
      bytes: fs.statSync(path.join(BUNDLE_DIR, name)).size,
    }));

  if (files.length === 0) {
    console.error(
      "check-bundle-size: ERROR — no .js bundle files found. Run `npm run build` first.",
    );
    process.exit(1);
    return;
  }

  const budget = resolveBundleSizeBudget(process.env);
  const result = evaluateBundleSize(files, budget);
  console.log(formatBundleSizeReport(files, result));
  if (result.overBudget) process.exit(1);
}

main();
