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
import { assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "verify-bundle-inlining";

function main(): void {
  // Shared premise (dist/ present, at least one chunk, newer than the source
  // tree). This check is the most exposed of the three: "the secret is not in
  // the bundle" is its FAILURE signal, so scanning a stale or empty bundle
  // reports the exact symptom of the bug it exists to catch — but from the
  // wrong cause, which is worse than reporting nothing at all.
  const bundleFiles = assertBundlePremise(CHECK_NAME);

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
