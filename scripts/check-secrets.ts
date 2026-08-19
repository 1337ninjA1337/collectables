#!/usr/bin/env tsx
/**
 * Fails when a known secret pattern appears anywhere in the committed source
 * tree (SEC-14). Run via `npm run lint:secrets` locally, inside `lint:ci`,
 * and as a CI step so a credential can never land in git.
 *
 * The matcher lives in `lib/secret-scan.ts` so it can be unit-tested under
 * `node --test` without touching the filesystem; this wrapper only walks the
 * tree and prints the report.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  ARCHIVE_SCAN_EXTENSIONS,
  formatSecretReport,
  scanArchiveEntries,
  scanForSecrets,
  SECRET_SKIP_DIRS,
  SECRET_SKIP_FILES,
  SOURCE_SCAN_EXTENSIONS,
  type SecretMatch,
} from "../lib/secret-scan";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { decodeZipEntryText, readZipEntries } from "../lib/zip-archive";
import { guardScanRoot, listFilesUnder } from "./guard-io";

const CHECK_NAME = "check-secrets";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * The exempt files, in this platform's separator.
 *
 * The list and the reason for each entry live in `lib/secret-scan.ts` beside
 * the rules they are exemptions from, where a suite can read them; what
 * happens here is the normalisation, because that is a fact about the walk's
 * output rather than about the policy.
 */
const SKIP_FILES = new Set(SECRET_SKIP_FILES.map((p) => path.normalize(p)));

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  // The skip list is applied after the walk rather than inside it: it names
  // FILES, and a walk that knows about individual files is a walk with a
  // second rule in it.
  const files = listFilesUnder(repoRoot, {
    extensions: SOURCE_SCAN_EXTENSIONS,
    skipDirs: SECRET_SKIP_DIRS,
  }).filter((rel) => !SKIP_FILES.has(path.normalize(rel)));

  // The containers, walked separately because what happens to them is
  // different: they are opened and their entries decoded, rather than read as
  // one string. Same skip list, since it names files and an archive is one.
  const archives = listFilesUnder(repoRoot, {
    extensions: ARCHIVE_SCAN_EXTENSIONS,
    skipDirs: SECRET_SKIP_DIRS,
  }).filter((rel) => !SKIP_FILES.has(path.normalize(rel)));

  // "scanned 0 file(s), no committed secrets" is the report an unreadable
  // repo root produces, and it exits 0. Assert the premise first.
  assertScannedFloor(CHECK_NAME, files.length + archives.length);

  const matches: SecretMatch[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    matches.push(...scanForSecrets(rel, source));
  }

  // An archive that cannot be opened is reported and fails the run rather than
  // being skipped like an unreadable text file: there are one or two of them,
  // each named by an extension somebody chose to scan, so "could not read it"
  // is news — where one text file out of 770 going missing mid-walk is not.
  const unopened: string[] = [];
  let entryCount = 0;
  for (const rel of archives) {
    try {
      const entries = readZipEntries(fs.readFileSync(path.join(repoRoot, rel)));
      const decoded: Record<string, string> = {};
      for (const [name, data] of Object.entries(entries)) decoded[name] = decodeZipEntryText(data);
      entryCount += Object.keys(decoded).length;
      matches.push(...scanArchiveEntries(rel, decoded));
    } catch (error) {
      unopened.push(`  ${rel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (unopened.length > 0) {
    console.error(
      `${CHECK_NAME}: ${unopened.length} archive(s) could not be opened, so nothing inside them was scanned:`,
    );
    console.error(unopened.join("\n"));
    process.exit(1);
  }

  if (matches.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s) plus ${entryCount} entr(ies) in ${archives.length} archive(s), no committed secrets.`,
    );
    return;
  }

  console.error(formatSecretReport(matches));
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
