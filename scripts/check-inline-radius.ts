#!/usr/bin/env tsx
/**
 * Fails when any inline `borderRadius: 999` / `22` / `24` or `gap: 10` /
 * `12` / `8` literal slips into `app/**` or `components/**` — geometry
 * must route through `RADIUS_PILL` / `RADIUS_CARD` / `RADIUS_CARD_LG` /
 * `SPACING_LIST` / `SPACING_CARD` / `SPACING_INLINE` from
 * `lib/design-tokens.ts` (see GEOMETRY_RULES in lib/check-inline-radius.ts).
 * Run via `npm run lint:radius` locally and via `npm run lint:ci` in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findInlineRadiusLiterals,
  formatRadiusReport,
  type RadiusMatch,
} from "../lib/check-inline-radius";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor, assertScannedRoots } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-inline-radius";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"] as const;
function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root reports "no inline geometry literals" in
  // exactly the same words as a walk that read everything.
  //
  // Two assertions because they catch different failures over the same walk:
  // the per-root check notices one root going quiet while the other keeps the
  // total looking healthy, and the count notices a walk that came back
  // implausibly small with every root still present. Only the second carries a
  // measured number, which is why only the second ever needs re-measuring.
  //
  // Roots FIRST, deliberately. When a root vanishes both fire, and they give
  // opposite advice: `no_root_files` names the directory that went quiet, while
  // `below_floor` says "if the tree legitimately shrank, re-measure the floor"
  // — which is the wrong thing to do and the easy thing to do. The more
  // specific diagnosis should be the one the reader meets.
  assertScannedRoots(CHECK_NAME, files);
  assertScannedFloor(CHECK_NAME, files.length);

  const allMatches: RadiusMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    allMatches.push(...findInlineRadiusLiterals(file, source));
  }

  if (allMatches.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no inline geometry literals.`,
    );
    return;
  }

  console.error(formatRadiusReport(allMatches));
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
