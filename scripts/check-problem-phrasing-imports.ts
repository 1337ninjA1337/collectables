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
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-problem-phrasing-imports";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "lib", "scripts", "__tests__"] as const;
function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  // assertScannedWalk runs both premises in the order that matters: the
  // per-root check first, so a vanished root is named rather than reported as
  // a number that needs re-measuring.
  assertScannedWalk(CHECK_NAME, files);

  const allMatches: ProblemPhrasingMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    allMatches.push(...findUnjoinedProblemPhrasingImports(file, source));
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
