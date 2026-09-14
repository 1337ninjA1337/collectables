#!/usr/bin/env tsx
/**
 * Fails when a file outside `lib/jsx-open-tag.ts` walks JSX text by hand —
 * a regex that wildcards to the first `>` of a component tag, or a string
 * search for its `</Close>`. Run via `npm run lint:jsx-walk` locally and as
 * part of `lint:all`.
 *
 * The rule and the reason it is worth having live in `lib/check-jsx-walk.ts`.
 * The short version: three copies of that walk were merged into one module on
 * 2026-09-13, two of them carrying the same bug, and what stopped a fourth was
 * a paragraph in a header rather than a check.
 *
 * It walks every source root, like `check-comment-terminators` and unlike the
 * rules about code that ships: all six copies this guard found on its first
 * run were in `__tests__/`, which is where a scratch sweep gets written.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findJsxWalks,
  formatJsxWalkReport,
  jsxWalkAnnotations,
  type JsxWalkFinding,
} from "../lib/check-jsx-walk";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-jsx-walk";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Everything in this repository written by hand in TypeScript.
 *
 * `__tests__/` is the root that matters most here and the one a rule about
 * shipped code would leave out: a suite is where somebody reaches for a
 * one-line regex to assert something about a screen's markup.
 */
const SCANNED_DIRS = ["app", "components", "data", "lib", "scripts", "__tests__"] as const;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: JsxWalkFinding[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    found.push(...findJsxWalks(file, source));
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), every JSX scan goes through lib/jsx-open-tag.ts.`,
    );
    return;
  }

  console.error(formatJsxWalkReport(found));
  if (runningUnderActions()) {
    for (const line of jsxWalkAnnotations(found)) console.log(line);
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
