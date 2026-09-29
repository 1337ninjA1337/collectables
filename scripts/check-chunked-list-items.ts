#!/usr/bin/env tsx
/**
 * Fails when a `useChunkedList(items, …)` call in `app/`, `components/` or
 * `lib/` passes something whose identity React does not hold stable. Run via
 * `npm run lint:chunked-items` locally and as part of `lint:all`.
 *
 * The rule and the reason it is worth having live in
 * `lib/check-chunked-list-items.ts`. The short version: the hook resets its
 * window when the array's reference changes, so a caller rebuilding the array
 * each render pins the list to page one and makes "Load more" a button that
 * does nothing — with no error, no warning and nothing on screen to look at.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHUNKED_LIST_HOOK,
  chunkedItemsAnnotations,
  chunkedListCalls,
  findChunkedItemsRisks,
  formatChunkedItemsReport,
  type ChunkedItemsFinding,
} from "../lib/check-chunked-list-items";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-chunked-list-items";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Code that renders or hooks — the same walk as `check-latest-ref`. `lib/` is
 * in it for the hook's own module and for the day a lib-level hook wraps it;
 * `scripts/` and `__tests__/` are out, because the suites spell the offending
 * call out on purpose and `check-chunked-list-items.test.ts` is made of it.
 */
const SCANNED_DIRS = ["app", "components", "lib"] as const;

/**
 * The guard's own subject, floored.
 *
 * Five screens call this hook today. A run that matched NO call at all has not
 * proved the rule — it has lost its subject, which is what a rename of the
 * hook or a move to a server-paginated list would look like from in here, and
 * in both cases the rule needs re-pointing rather than congratulating. One,
 * not five: a screen being deleted is ordinary, and a floor that goes red for
 * it teaches people to edit the floor.
 */
const CALL_FLOOR = 1;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: ChunkedItemsFinding[] = [];
  let calls = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    calls += chunkedListCalls(source).length;
    found.push(...findChunkedItemsRisks(file, source));
  }

  if (calls < CALL_FLOOR) {
    console.error(
      `${CHECK_NAME}: scanned ${files.length} file(s) and matched no ${CHUNKED_LIST_HOOK}( call at all — this guard has lost its subject, not proved its rule. Check whether the hook was renamed or retired.`,
    );
    process.exit(1);
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), all ${calls} ${CHUNKED_LIST_HOOK} call(s) pass a reference React holds stable.`,
    );
    return;
  }

  console.error(formatChunkedItemsReport(found));
  if (runningUnderActions()) {
    for (const line of chunkedItemsAnnotations(found)) console.log(line);
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
