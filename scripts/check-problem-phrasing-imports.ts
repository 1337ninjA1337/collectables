#!/usr/bin/env tsx
/**
 * Fails when any module reads a `lib/scanned-floor` phrasing PART
 * (`scannedFloorProblemDetail`, `scannedFloorProblemSubject`) without also
 * importing a function that joins parts into a whole sentence. Run via
 * `npm run lint:problem-phrasing` locally and via `npm run lint:ci` in CI.
 *
 * Walks the roots that can import the module at all: `lib/`, `scripts/`,
 * `app/`, `components/` and `__tests__/`. Tests are deliberately IN scope —
 * they are the likeliest place for a hand-joined sentence, because a test
 * asserting what a refusal says is exactly the caller that wants both halves.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findUnjoinedProblemPhrasingImports,
  formatProblemPhrasingReport,
  type ProblemPhrasingMatch,
} from "../lib/check-problem-phrasing-imports";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { guardScanRoot, listDirEntries } from "./guard-io";

const CHECK_NAME = "check-problem-phrasing-imports";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "lib", "scripts", "__tests__"] as const;
const SOURCE_FILE_PATTERN = /\.tsx?$/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of listDirEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (SOURCE_FILE_PATTERN.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = SCANNED_DIRS.flatMap((dir) =>
    listSourceFiles(path.join(repoRoot, dir)),
  );

  assertScannedFloor(CHECK_NAME, files.length);

  const allMatches: ProblemPhrasingMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(repoRoot, file);
    allMatches.push(...findUnjoinedProblemPhrasingImports(rel, source));
  }

  if (allMatches.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} source file(s), every scanned-floor phrasing part is read beside a joiner.`,
    );
    return;
  }

  console.error(formatProblemPhrasingReport(allMatches));
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
