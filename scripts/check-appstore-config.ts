#!/usr/bin/env tsx
/**
 * Fails when app.json's iOS submission block regresses: a dropped
 * `expo.ios.bundleIdentifier`, a declared `expo.ios.icon` that doesn't
 * resolve on disk, or a missing required `infoPlist` key. Run via
 * `npm run lint:appstore` locally and as part of `lint:ci` so a regression
 * is caught in the lint stage instead of at `eas submit` time.
 *
 * The validation logic lives in `lib/check-appstore-config.ts` so it can be
 * unit-tested under `node --test` without touching the filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findAppstoreConfigIssues,
  formatAppstoreConfigReport,
  REQUIRED_INFO_PLIST_KEYS,
} from "../lib/check-appstore-config";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertParsedInputs } from "../lib/scanned-floor";
import { guardScanRoot, readJsonInput } from "./guard-io";

const CHECK_NAME = "check-appstore-config";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const appJson = readJsonInput(path.join(repoRoot, "app.json"));

  // Two ways this guard can examine nothing and still find no issues: an
  // app.json that is not there at all (a moved scan root), and one that
  // parses to {} — which makes every required-key check report a consequence
  // instead of the cause.
  assertParsedInputs(CHECK_NAME, { "app.json": appJson });

  const issues = findAppstoreConfigIssues({
    appJson,
    iconExists: (iconPath) => fs.existsSync(path.join(repoRoot, iconPath)),
  });

  if (issues.length === 0) {
    console.log(
      `${CHECK_NAME}: app.json iOS block OK (bundleIdentifier + ${REQUIRED_INFO_PLIST_KEYS.length} required infoPlist keys).`,
    );
    return;
  }

  console.error(formatAppstoreConfigReport(issues));
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
