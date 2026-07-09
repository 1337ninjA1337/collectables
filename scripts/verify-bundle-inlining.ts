#!/usr/bin/env tsx
/**
 * Post-build check that every watched EXPO_PUBLIC_* secret set in the
 * current env was actually inlined into the exported web bundle. Run by the
 * deploy workflow right after `expo export` (with the same env), and
 * runnable locally via `npm run verify:bundle-inlining`.
 *
 * Exit 1 when a set secret is absent from the bundle — a deploy that would
 * ship `dsnPresent: false` despite CI printing `[set]`. Never prints values.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  checkBundleInlining,
  formatBundleInliningReport,
  WATCHED_INLINED_VAR_NAMES,
} from "../lib/bundle-inlining";

const REPO_ROOT = path.join(__dirname, "..");
const BUNDLE_DIR = path.join(REPO_ROOT, "dist", "_expo", "static", "js", "web");

function main(): void {
  let bundleFiles: string[];
  try {
    bundleFiles = fs
      .readdirSync(BUNDLE_DIR)
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(BUNDLE_DIR, name));
  } catch {
    console.error(
      `verify-bundle-inlining: no exported bundle at ${BUNDLE_DIR} — run \`npm run build\` first.`,
    );
    process.exit(1);
    return;
  }
  if (bundleFiles.length === 0) {
    console.error(`verify-bundle-inlining: no .js bundles found in ${BUNDLE_DIR}.`);
    process.exit(1);
    return;
  }

  const bundleSource = bundleFiles
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  // Node script, not bundled by Metro — dynamic env access is fine here.
  const env: Record<string, string | undefined> = {};
  for (const name of WATCHED_INLINED_VAR_NAMES) {
    env[name] = process.env[name];
  }

  const results = checkBundleInlining(bundleSource, env);
  const { report, failed } = formatBundleInliningReport(results);
  console.log(`verify-bundle-inlining: checked ${bundleFiles.length} bundle file(s)`);
  console.log(report);
  if (failed) process.exit(1);
}

main();
