#!/usr/bin/env tsx
/**
 * Fails when a base translation key in `lib/i18n/en.ts` is read by
 * nothing in the source tree. Run via `npm run lint:orphan-i18n` locally and
 * via `npm run lint:ci` in CI.
 *
 * The orphan question lives in `lib/check-orphan-i18n-keys.ts` and the rule
 * behind "read" in `lib/i18n-key-usage.ts`; this is the walk and the exit code.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findOrphanI18nKeys,
  formatOrphanKeyReport,
} from "../lib/check-orphan-i18n-keys";
import { GuardRootError } from "../lib/guard-root";
import type { ScannedSource } from "../lib/i18n-key-usage";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { I18N_LOCALE_SOURCES } from "../lib/i18n-source-files";
import { SOURCE_DIRS } from "../lib/source-dirs";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-orphan-i18n-keys";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * The translations file itself, excluded from the walk that reads it.
 *
 * Defensive rather than load-bearing, which is the opposite of what this
 * comment said until 2026-08-22. The map writes its keys as identifiers
 * (`greeting: "Hello"`), so none of them sits in a key POSITION and including
 * the file would make zero keys read — measured, and pinned by a case in
 * `__tests__/i18n-key-usage.test.ts`. What the exclusion defends against is
 * quoting the keys (`"greeting": "Hello"`), which would put all but the first
 * of them after a comma and make this guard vacuous in a commit that reads as
 * formatting.
 */
const TRANSLATIONS_FILE = I18N_LOCALE_SOURCES[0];

/**
 * The six locale maps, excluded from the scan for the same defensive reason
 * {@link TRANSLATIONS_FILE} is: they write the same identifiers as keys, and a
 * commit that quoted them would make this guard vacuous while reading as
 * formatting. They moved out of `lib/i18n-context.tsx` on 2026-09-13; the
 * provider itself is ordinary source now and is scanned like any other file.
 */
const LOCALE_FILES = new Set(I18N_LOCALE_SOURCES);

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SOURCE_DIRS).filter(
    (file) => !LOCALE_FILES.has(file),
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
