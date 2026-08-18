#!/usr/bin/env tsx
/**
 * Fails when any `app/**` / `components/**` module imports
 * `@/lib/analytics-events` directly — screens must consume the taxonomy
 * through `lib/analytics.ts`. Run via `npm run lint:analytics-imports`
 * locally and via `npm run lint:ci` in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findAnalyticsEventsImports,
  formatAnalyticsImportReport,
  type AnalyticsImportMatch,
} from "../lib/check-analytics-imports";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-analytics-imports";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"] as const;
function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  assertScannedFloor(CHECK_NAME, files.length);

  const allMatches: AnalyticsImportMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    allMatches.push(...findAnalyticsEventsImports(file, source));
  }

  if (allMatches.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no direct lib/analytics-events imports.`,
    );
    return;
  }

  console.error(formatAnalyticsImportReport(allMatches));
  process.exit(1);
}

try {
  main();
} catch (error) {
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
