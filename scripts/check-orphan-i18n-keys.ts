#!/usr/bin/env tsx
/**
 * Fails when a base translation key in `lib/i18n-context.tsx` is read by
 * nothing in the source tree. Run via `npm run lint:orphan-i18n` locally and
 * via `npm run lint:ci` in CI.
 *
 * The rule and the reasoning behind "read" live in
 * `lib/check-orphan-i18n-keys.ts`; this is the walk and the exit code.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findOrphanI18nKeys,
  formatOrphanKeyReport,
  type ScannedSource,
} from "../lib/check-orphan-i18n-keys";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { SOURCE_DIRS } from "../lib/source-dirs";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-orphan-i18n-keys";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * The translations file itself, excluded from the walk that reads it.
 *
 * It declares every key, so counting its own text as a mention would make
 * every key "read" and the guard vacuous — the one exclusion the rule cannot
 * do without.
 */
const TRANSLATIONS_FILE = "lib/i18n-context.tsx";

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SOURCE_DIRS).filter(
    (file) => file !== TRANSLATIONS_FILE,
  );

  assertScannedFloor(CHECK_NAME, files.length);

  const translations = fs.readFileSync(
    path.join(repoRoot, TRANSLATIONS_FILE),
    "utf8",
  );
  const sources: ScannedSource[] = files.map((file) => ({
    file,
    source: fs.readFileSync(path.join(repoRoot, file), "utf8"),
  }));

  const findings = findOrphanI18nKeys(translations, sources);

  if (findings.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), every base key is read somewhere.`,
    );
    return;
  }

  console.error(formatOrphanKeyReport(findings, files.length));
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
