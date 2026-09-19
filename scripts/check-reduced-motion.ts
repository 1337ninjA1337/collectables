#!/usr/bin/env tsx
/**
 * Fails when a file under `app/`, `components/` or `lib/` drives an
 * `Animated.*` animation without `@/lib/reduced-motion` in scope. Run via
 * `npm run lint:reduced-motion` locally and as part of `lint:all`.
 *
 * The rule and the reason it is worth having live in
 * `lib/check-reduced-motion.ts`. The short version: four surfaces were taught
 * to consult the setting on 2026-09-17 and what held the line afterwards was a
 * list of four filenames typed into a test, which a fifth surface joins
 * without asking anybody.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findMotionDrivers,
  findUnaskedAnimations,
  formatReducedMotionReport,
  reducedMotionAnnotations,
  type ReducedMotionFinding,
} from "../lib/check-reduced-motion";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-reduced-motion";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * Code that runs on a device. `lib/` is in it because twelve context providers
 * there render JSX — "animation lives where the markup does" is a sentence
 * this tree has already falsified once — and `scripts/` and `__tests__/` are
 * not, because neither reaches Metro and a suite's fixture is allowed to spell
 * a driver out.
 */
const SCANNED_DIRS = ["app", "components", "lib"] as const;

/**
 * The guard's own subject, floored.
 *
 * `assertScannedWalk` proves files were read; this proves the rule still
 * RECOGNISES an animation. Every pattern here is a spelling of one library's
 * API, and the day this app moves to Reanimated's `withTiming` all of them
 * stop matching at once — a clean report over a tree full of unguarded motion,
 * which is the failure every floor in this repository exists to catch. One is
 * enough: the number of animated surfaces is a product decision and this is
 * not the file that should have an opinion about it.
 */
const MOTION_FLOOR = 1;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const found: ReducedMotionFinding[] = [];
  let animated = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    if (findMotionDrivers(file, source).length > 0) animated += 1;
    found.push(...findUnaskedAnimations(file, source));
  }

  if (animated < MOTION_FLOOR) {
    console.error(
      `${CHECK_NAME}: scanned ${files.length} file(s) and matched no Animated.timing/spring/decay/loop call at all — this guard has lost its subject, not proved its rule. Check whether the animation library changed.`,
    );
    process.exit(1);
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), all ${animated} animated surface(s) consult @/lib/reduced-motion.`,
    );
    return;
  }

  console.error(formatReducedMotionReport(found));
  if (runningUnderActions()) {
    for (const line of reducedMotionAnnotations(found)) console.log(line);
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
