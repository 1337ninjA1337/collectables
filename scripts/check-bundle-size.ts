#!/usr/bin/env tsx
/**
 * Fails when the exported web bundle (`dist/_expo/static/js/web/*.js`)
 * exceeds the size budget. Run via `npm run lint:bundle-size` — a
 * post-build CI step (sibling of `lint:secrets:bundle`), so it requires
 * `npm run build` to have produced `dist/` first.
 *
 * Budget: DEFAULT_BUNDLE_BUDGET_BYTES in lib/check-bundle-size.ts,
 * overridable via the BUNDLE_BUDGET_BYTES env var (positive integer bytes;
 * anything unparsable falls back to the default).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  evaluateBundleBudget,
  formatBundleSizeReport,
  resolveBundleBudgetBytes,
  type BundleFile,
} from "../lib/check-bundle-size";

const REPO_ROOT = path.join(__dirname, "..");
const BUNDLE_DIR = path.join("dist", "_expo", "static", "js", "web");

function main(): void {
  const dir = path.join(REPO_ROOT, BUNDLE_DIR);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    console.error(
      `check-bundle-size: ${BUNDLE_DIR} not found — run \`npm run build\` first (this is a post-build check).`,
    );
    process.exit(1);
    return;
  }

  const files: BundleFile[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      const full = path.join(dir, entry.name);
      files.push({
        file: path.join(BUNDLE_DIR, entry.name),
        bytes: fs.statSync(full).size,
      });
    }
  }

  if (files.length === 0) {
    console.error(
      `check-bundle-size: no .js files in ${BUNDLE_DIR} — the export looks broken.`,
    );
    process.exit(1);
    return;
  }

  const budget = resolveBundleBudgetBytes(process.env.BUNDLE_BUDGET_BYTES);
  const result = evaluateBundleBudget(files, budget);
  const report = formatBundleSizeReport(result);

  if (result.overBudget) {
    console.error(report);
    process.exit(1);
    return;
  }
  console.log(report);
}

main();
