#!/usr/bin/env tsx
/**
 * Fails when a platform-split module's two halves disagree — a `*.web.ts(x)`
 * with no native sibling, or a name exported by one spelling and not the other.
 * Metro serves one half per platform and node imports the native one, so this
 * is the difference no type-check and no suite in this repository can see.
 * Run via `npm run lint:platform-pairs` locally and via `npm run lint:ci` in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  comparePlatformPair,
  formatPlatformPairReport,
  platformPairs,
  type PlatformPairFinding,
} from "../lib/check-platform-pairs";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-platform-pairs";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "data", "lib"] as const;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // Same premise as every other walking guard: a pair set of zero is what a
  // moved source root produces, and it reads exactly like a tree with no
  // platform splits in it.
  assertScannedWalk(CHECK_NAME, files);

  const pairs = platformPairs(files);
  const findings: PlatformPairFinding[] = [];
  for (const pair of pairs) {
    const platformSource = fs.readFileSync(path.join(repoRoot, pair.platform.file), "utf8");
    const nativeSource =
      pair.native === null ? null : fs.readFileSync(path.join(repoRoot, pair.native), "utf8");
    findings.push(...comparePlatformPair(pair, platformSource, nativeSource));
  }

  if (findings.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), ${pairs.length} platform pair(s) export the same names.`,
    );
    return;
  }

  console.error(formatPlatformPairReport(findings));
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
