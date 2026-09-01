#!/usr/bin/env tsx
/**
 * Fails when a block comment ends inside its own body — a doc-comment line
 * that closes the comment and leaves prose behind it, which the compiler then
 * parses as code. Run via `npm run lint:comment-terminators` locally and as
 * part of `lint:ci`.
 *
 * The rule and the reason it is worth having live in
 * `lib/check-comment-terminators.ts`. The short version: the typecheck already
 * catches this and reports it as a list of syntax errors pointing at English,
 * in a file whose only change was a paragraph. This says the cause instead.
 *
 * It walks every source root, not the three or four most guards take: the
 * hazard is a property of doc comments, this repository writes them everywhere,
 * and the file that tripped it was in `scripts/`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  EARLY_TERMINATOR_ADVICE,
  findEarlyTerminators,
  formatEarlyTerminatorReport,
  type EarlyTerminator,
} from "../lib/check-comment-terminators";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-comment-terminators";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Everything in this repository written by hand in TypeScript.
 *
 * Wider than most guards here on purpose. The rules about hex literals and
 * console swaps are about code that SHIPS, so they stop at `lib/`; this one is
 * about prose, every one of these roots is full of it, and the file that
 * demonstrated the failure lives in `scripts/`.
 */
const SCANNED_DIRS = ["app", "components", "data", "lib", "scripts", "__tests__"] as const;

/** Escape a workflow-command property value (file=..., etc.). */
function escapeAnnotationProperty(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

/** Escape a workflow-command message (the part after the double colon). */
function escapeAnnotationMessage(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * One `::error` per finding, so CI puts it on the line of the PR diff.
 *
 * This guard wants the annotation more than most: the compiler's own errors
 * land on the lines BELOW the real one, so a reviewer reading the diff sees
 * complaints about code and nothing at all on the comment that caused them.
 */
function annotations(found: readonly EarlyTerminator[]): string[] {
  return found.map(
    (entry) =>
      `::error file=${escapeAnnotationProperty(entry.file)},line=${entry.line},col=${entry.column}::` +
      escapeAnnotationMessage(
        `This block comment ends here; "${entry.trailing}" after it is parsed as code — ${EARLY_TERMINATOR_ADVICE}`,
      ),
  );
}

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: EarlyTerminator[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    found.push(...findEarlyTerminators(file, source));
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no block comment ends inside its own body.`,
    );
    return;
  }

  console.error(formatEarlyTerminatorReport(found));
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const annotation of annotations(found)) console.log(annotation);
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
