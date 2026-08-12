#!/usr/bin/env tsx
/**
 * Fails when any 6-digit hex literal slips into `app/**`, `components/**`
 * or `lib/**` (`.ts` and `.tsx` alike). Run via `npm run lint:hex` locally
 * and via `npm run lint:ci` in CI.
 *
 * The few modules that legitimately produce color values (the design-tokens
 * source itself, the deterministic placeholder palette, the standalone HTML
 * templates) are exempted by exact path via `HEX_ALLOWLIST` in
 * `lib/check-inline-hex.ts` — the matcher skips them, so the walk stays dumb.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findInlineHexLiterals,
  formatGitHubAnnotations,
  formatHexReport,
  type HexMatch,
} from "../lib/check-inline-hex";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { guardScanRoot, listDirEntries } from "./guard-io";

const CHECK_NAME = "check-inline-hex";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCAN_ROOTS = ["app", "components", "lib"];
const SOURCE_FILE_PATTERN = /\.tsx?$/;

function walkSources(dir: string, out: string[]): void {
  for (const entry of listDirEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSources(full, out);
    } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
      out.push(full);
    }
  }
}

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walkSources(path.join(repoRoot, root), files);
  }
  files.sort();

  // Before reading a single byte: a walk that found nothing (or almost
  // nothing) reports "no inline hex literals" just as cheerfully as a full one.
  assertScannedFloor(CHECK_NAME, files.length);

  const allMatches: HexMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(repoRoot, file);
    allMatches.push(...findInlineHexLiterals(rel, source));
  }

  if (allMatches.length === 0) {
    console.log(`${CHECK_NAME}: scanned ${files.length} file(s), no inline hex literals.`);
    return;
  }

  console.error(formatHexReport(allMatches));
  if (process.env.GITHUB_ACTIONS === "true") {
    // Surface each finding as a line-level annotation on the PR diff.
    for (const annotation of formatGitHubAnnotations(allMatches)) {
      console.log(annotation);
    }
  }
  process.exit(1);
}

try {
  main();
} catch (error) {
  // The floor failure is a guard result, not a crash — print the one line,
  // not a stack trace pointing at a helper the reader did not call.
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
