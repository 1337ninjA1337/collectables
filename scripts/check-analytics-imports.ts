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

const REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"] as const;
const SOURCE_FILE_PATTERN = /\.tsx?$/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (SOURCE_FILE_PATTERN.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function main(): void {
  const files = SCANNED_DIRS.flatMap((dir) =>
    listSourceFiles(path.join(REPO_ROOT, dir)),
  );

  const allMatches: AnalyticsImportMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    allMatches.push(...findAnalyticsEventsImports(rel, source));
  }

  if (allMatches.length === 0) {
    console.log(
      `check-analytics-imports: scanned ${files.length} file(s), no direct lib/analytics-events imports.`,
    );
    return;
  }

  console.error(formatAnalyticsImportReport(allMatches));
  process.exit(1);
}

main();
