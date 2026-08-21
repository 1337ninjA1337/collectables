#!/usr/bin/env tsx
/**
 * Fails when an email address reaches a profile's public identifier
 * (`publicId` / `public_id` / `username`). Run via
 * `npm run lint:profile-id-pii` locally and via `npm run lint:ci` in CI.
 *
 * The rule, the fields it covers and the one it deliberately does not are in
 * `lib/check-profile-id-pii.ts`; this is the walk and the exit code.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findProfileIdPii,
  formatProfileIdPiiReport,
  type ProfileIdPiiMatch,
} from "../lib/check-profile-id-pii";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { SOURCE_DIRS } from "../lib/source-dirs";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-profile-id-pii";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SOURCE_DIRS);

  assertScannedFloor(CHECK_NAME, files.length);

  const matches: ProfileIdPiiMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    matches.push(...findProfileIdPii(file, source));
  }

  if (matches.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no email reaches a public profile identifier.`,
    );
    return;
  }

  console.error(formatProfileIdPiiReport(matches));
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
