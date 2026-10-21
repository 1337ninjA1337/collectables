#!/usr/bin/env tsx
/**
 * Fails when a file under `app/`, `components/` or `lib/` imports
 * `fetchProfiles` or `searchProfiles` and names no `isProfileDeleted`. Run via
 * `npm run lint:profile-visibility` locally and as part of `lint:all`.
 *
 * The rule and the reason it is worth having live in
 * `lib/check-profile-visibility.ts`. The short version: those two functions
 * answer with the table's rows, the admin tombstone lives in React state and
 * cannot be applied inside the fetch, and all three readers that existed on
 * 2026-10-21 had forgotten it — so a profile an admin deleted was in the people
 * browser, in the search sheet, and one tap from a full profile screen.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  PROFILE_LIST_READERS,
  VISIBILITY_PREDICATE,
  findProfileVisibilityRisks,
  formatProfileVisibilityReport,
  profileListReaderImport,
  profileVisibilityAnnotations,
  type ProfileVisibilityFinding,
} from "../lib/check-profile-visibility";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-profile-visibility";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Code that runs — the same walk as `check-latest-ref`. `lib/` is in it
 * because a lib module fetching profiles for a screen is the likeliest third
 * reader; `scripts/` and `__tests__/` are out, because neither renders a
 * profile and `check-profile-visibility.test.ts` is made of the offending
 * shape.
 */
const SCANNED_DIRS = ["app", "components", "lib"] as const;

/**
 * The guard's own subject, floored.
 *
 * Two files import these readers today. A run that matched NO import at all
 * has not proved the rule — it has lost its subject, which is what renaming
 * `searchProfiles` or moving the reads behind a hook would look like from in
 * here, and in both cases the rule needs re-pointing rather than
 * congratulating. One, not two: a surface being deleted is ordinary, and a
 * floor that goes red for it teaches people to edit the floor.
 */
const IMPORT_FLOOR = 1;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: ProfileVisibilityFinding[] = [];
  let importers = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    if (profileListReaderImport(source)) importers += 1;
    found.push(...findProfileVisibilityRisks(file, source));
  }

  if (importers < IMPORT_FLOOR) {
    console.error(
      `${CHECK_NAME}: scanned ${files.length} file(s) and matched no import of ${PROFILE_LIST_READERS.join(" or ")} at all — this guard has lost its subject, not proved its rule. Check whether the readers were renamed or moved behind a hook.`,
    );
    process.exit(1);
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), all ${importers} reader(s) of the profiles table consult ${VISIBILITY_PREDICATE}.`,
    );
    return;
  }

  console.error(formatProfileVisibilityReport(found));
  if (runningUnderActions()) {
    for (const line of profileVisibilityAnnotations(found)) console.log(line);
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
