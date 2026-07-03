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

const REPO_ROOT = path.join(__dirname, "..");
const APP_JSON = path.join(REPO_ROOT, "app.json");

function main(): void {
  const appJson = JSON.parse(fs.readFileSync(APP_JSON, "utf8"));

  const issues = findAppstoreConfigIssues({
    appJson,
    iconExists: (iconPath) => fs.existsSync(path.join(REPO_ROOT, iconPath)),
  });

  if (issues.length === 0) {
    console.log(
      `check-appstore-config: app.json iOS block OK (bundleIdentifier + ${REQUIRED_INFO_PLIST_KEYS.length} required infoPlist keys).`,
    );
    return;
  }

  console.error(formatAppstoreConfigReport(issues));
  process.exit(1);
}

main();
