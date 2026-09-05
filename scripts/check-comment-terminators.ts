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
 *
 * The two annotation builders used to be here, private, and are
 * `earlyTerminatorAnnotations` and `orphanTerminatorAnnotations` in that module
 * now. Same reason the audit gate's decisions moved: a function only a script
 * can reach is checkable by reading the file for an exact expression and no
 * other way, and these two had never been run — this was the third producer of
 * workflow commands in the tree and the only one whose output had never been
 * past the classifier that tells them from log lines.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  earlyTerminatorAnnotations,
  findEarlyTerminators,
  findOrphanTerminators,
  formatEarlyTerminatorReport,
  formatOrphanTerminatorReport,
  orphanTerminatorAnnotations,
  orphansWithoutCause,
  type EarlyTerminator,
  type OrphanTerminator,
} from "../lib/check-comment-terminators";
import { runningUnderActions } from "../lib/github-annotations";
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

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: EarlyTerminator[] = [];
  const allOrphans: OrphanTerminator[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    found.push(...findEarlyTerminators(file, source));
    allOrphans.push(...findOrphanTerminators(file, source));
  }
  // Symptoms of a cause already named are dropped rather than printed beside
  // it: a file with an early terminator has orphans BECAUSE of it.
  const orphans = orphansWithoutCause(found, allOrphans);

  if (found.length === 0 && orphans.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no block comment ends inside its own body and no terminator stands in code.`,
    );
    return;
  }

  if (found.length > 0) console.error(formatEarlyTerminatorReport(found));
  if (orphans.length > 0) console.error(formatOrphanTerminatorReport(orphans));
  if (runningUnderActions()) {
    for (const line of [...earlyTerminatorAnnotations(found), ...orphanTerminatorAnnotations(orphans)])
      console.log(line);
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
