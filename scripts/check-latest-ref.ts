#!/usr/bin/env tsx
/**
 * Fails when a file under `app/`, `components/` or `lib/` syncs a ref to a
 * value by hand at the top of a component body — `const xRef = useRef(x);
 * xRef.current = x;` — instead of calling `useLatestRef`. Run via
 * `npm run lint:latest-ref` locally and as part of `lint:all`.
 *
 * The rule and the reason it is worth having live in `lib/check-latest-ref.ts`.
 * The short version: that assignment was in eight files, eleven times, and when
 * it is the one that gets forgotten nothing crashes — the ref keeps the first
 * render's value and the component is correct until the value changes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findLatestRefSyncs,
  formatLatestRefReport,
  latestRefAnnotations,
  type LatestRefFinding,
} from "../lib/check-latest-ref";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-latest-ref";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Code that renders or hooks. `scripts/` and `__tests__/` are out: neither
 * runs in React, and the suites need to spell the offending line out —
 * `check-latest-ref.test.ts` is made of it.
 */
const SCANNED_DIRS = ["app", "components", "lib"] as const;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: LatestRefFinding[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    found.push(...findLatestRefSyncs(file, source));
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), every per-render ref sync goes through useLatestRef.`,
    );
    return;
  }

  console.error(formatLatestRefReport(found));
  if (runningUnderActions()) {
    for (const line of latestRefAnnotations(found)) console.log(line);
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
