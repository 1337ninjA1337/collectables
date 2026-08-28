#!/usr/bin/env tsx
/**
 * Fails when shipped code assigns to a method of the global `console` —
 * `app/**`, `components/**`, `lib/**`, `scripts/**`. The suites have had this
 * rule since the capture helper landed; this is the same rule where a
 * contributor meets it first, in `lint:all`'s output beside the hex and radius
 * messages. See `lib/check-console-swap.ts` for what a swap costs in each of
 * the two places it could land.
 *
 * Run via `npm run lint:console-swap` locally and via `npm run lint:ci` in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CONSOLE_SWAP_PROBE,
  CONSOLE_SWAP_SUBJECT,
  findConsoleSwaps,
  formatConsoleSwapReport,
  type ConsoleSwap,
} from "../lib/check-console-swap";
import { checkError } from "../lib/check-error";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-console-swap";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Everything this repository ships or runs, and NOT `__tests__/`.
 *
 * The suites are the one place the swap is legitimate — `captureConsole` /
 * `beginCapture` do exactly this, on purpose, in one file — so sweeping them
 * here would mean carrying an exemption for a rule that already has a sharper
 * enforcement one directory over. `__tests__/default-console-seams.test.ts`
 * owns that half, including the positive control this walk cannot borrow.
 */
const SCANNED_DIRS = ["app", "components", "lib", "scripts"] as const;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole in
  // it, in the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  // The positive control, run BEFORE the tree is reported clean. A ban is
  // satisfied by a pattern that has stopped matching anything, and there is no
  // file outside __tests__/ that legitimately does the banned thing to sweep
  // against — so the guard carries its own offender and refuses to vouch for
  // the tree until the scanner has flagged it.
  if (findConsoleSwaps("<probe>", CONSOLE_SWAP_PROBE).length === 0) {
    console.error(
      checkError(
        CHECK_NAME,
        `the scanner did not flag its own probe, so it is reading every file in the tree and finding nothing for a reason that has nothing to do with the tree. CONSOLE_SWAP in lib/check-console-swap.ts no longer matches an assignment to ${CONSOLE_SWAP_SUBJECT}.`,
      ),
    );
    process.exit(1);
  }

  const swaps: ConsoleSwap[] = [];
  for (const file of files) {
    swaps.push(
      ...findConsoleSwaps(
        file,
        fs.readFileSync(path.join(repoRoot, file), "utf8"),
      ),
    );
  }

  if (swaps.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no assignments to ${CONSOLE_SWAP_SUBJECT}.`,
    );
    return;
  }

  console.error(formatConsoleSwapReport(CHECK_NAME, swaps));
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
