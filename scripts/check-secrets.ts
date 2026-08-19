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
import {
  formatLocalOnlyNote,
  formatLocalOnlySkips,
  formatTrackedLocalOnly,
  partitionLocalOnly,
  type LocalOnlyTrackedProbe,
} from "../lib/local-only";
import { listCommittable, trackedAmong } from "./git-io";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { decodeZipEntryText, readZipEntries } from "../lib/zip-archive";
import { guardScanRoot, listFilesUnder, selectPaths } from "./guard-io";

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

/**
 * The named exemptions, which is the half of the skip policy that is a
 * decision this repository made and wrote a reason for.
 *
 * The other half — the `.local.` convention — is applied by
 * {@link partitionLocalOnly}, which hands BOTH halves back: the names a rule
 * removes are the ones a reader in front of a failure needs, and a `filter`
 * throws them away.
 */
const notExempt = (rel: string): boolean => !SKIP_FILES.has(path.normalize(rel));

/**
 * Git's answer about the skipped names, in the shape the report takes.
 *
 * The translation is here rather than in `lib/local-only.ts` because "why git
 * did not answer" is a fact about spawning a process, and the reason is
 * PREFIXED rather than passed through: `not a git repository` on its own reads
 * as a failure of the guard, where `not checked against git: not a git
 * repository` reads as the check it actually is.
 */
function probeTracked(root: string, skipped: readonly string[]): LocalOnlyTrackedProbe {
  const answer = trackedAmong(root, skipped);
  return answer.ok
    ? { asked: true, tracked: answer.tracked }
    : { asked: false, reason: `not checked against git: ${answer.reason}` };
}

/**
 * The candidates, from git when git can answer and from a walk when it cannot.
 *
 * This guard's report says "no committed secrets", and a walk of the working
 * tree is not that set: it reads a scratch `notes.md` with a pasted key, an
 * editor backup, a half-finished migration — none of them committable, all of
 * them reported with the same severity as a file in the index. `git ls-files
 * --cached --others --exclude-standard` is the set the sentence is about, and
 * it keeps the half that matters most: a file created a minute ago and not yet
 * added is one `git add -A` away from being committed, so it stays in scope.
 *
 * The fallback is not a fallback for exotic cases. Every guard fixture under
 * `__tests__/helpers/guard-fixture.ts` is a temp directory with no `.git`
 * anywhere above it, and an export of this repository unpacked from a tarball
 * is another; a guard that refused to run outside git would be a guard its own
 * harness could not exercise. So the walk stays, and the run SAYS which of the
 * two it used — the alternative is two scans that report identically over
 * different sets.
 */
type Candidates = {
  readonly files: string[];
  readonly archives: string[];
  /** How the pass line describes what it looked at. */
  readonly subject: string;
};

function candidatesIn(repoRoot: string): Candidates {
  const committable = listCommittable(repoRoot);
  const pick = (extensions: readonly string[]): string[] =>
    committable.ok
      ? selectPaths(committable.files, { extensions, skipDirs: SECRET_SKIP_DIRS })
      : listFilesUnder(repoRoot, { extensions, skipDirs: SECRET_SKIP_DIRS });
  return {
    // The skip list is applied after the listing rather than inside it: it
    // names FILES, and a walk that knows about individual files is a walk with
    // a second rule in it.
    files: pick(SOURCE_SCAN_EXTENSIONS).filter(notExempt),
    // The containers, listed separately because what happens to them is
    // different: they are opened and their entries decoded, rather than read
    // as one string. Same skip list, since it names files and an archive is
    // one.
    archives: pick(ARCHIVE_SCAN_EXTENSIONS).filter(notExempt),
    subject: committable.ok
      ? "git's committable set"
      : `the working tree (not checked against git: ${committable.reason})`,
  };
}

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const candidates = candidatesIn(repoRoot);
  const walkedFiles = candidates.files;
  const walkedArchives = candidates.archives;

  const text = partitionLocalOnly(walkedFiles);
  const containers = partitionLocalOnly(walkedArchives);
  const files = text.scanned;
  const archives = containers.scanned;
  const skippedLocal = [...text.localOnly, ...containers.localOnly];

  // "scanned 0 file(s), no committed secrets" is the report an unreadable
  // repo root produces, and it exits 0. Assert the premise first.
  assertScannedFloor(CHECK_NAME, files.length + archives.length);

  // Asked ONLY when something was skipped, and only then: on a normal checkout
  // this guard spawns no child process at all, and the claim the skip rests on
  // — that git will never take these files — is checked exactly where it is
  // being relied upon. `git add -f` beats `.gitignore`, so a tracked `.local.`
  // file is a committed credential outside the scan; the suite could catch that
  // and `npm run lint:secrets` on its own could not.
  const probe = skippedLocal.length === 0 ? undefined : probeTracked(repoRoot, skippedLocal);

  if (probe) {
    const tracked = formatTrackedLocalOnly(probe);
    if (tracked) {
      console.error(`${CHECK_NAME}: ${tracked}`);
      process.exit(1);
    }
  }

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
    // The clause is empty on a clean checkout, so the usual line is the usual
    // line; it appears only when there was something to say.
    const skipped = formatLocalOnlySkips(skippedLocal, probe);
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s) plus ${entryCount} entr(ies) in ${archives.length} archive(s) from ${candidates.subject}, no committed secrets` +
        `${skipped ? `, ${skipped}` : ""}.`,
    );
    return;
  }

  console.error(formatSecretReport(matches));
  // Printed on every failure, including the one where nothing was skipped —
  // that is the reader whose `.local.` copy is misnamed, and "none this run" is
  // the line that tells them so.
  console.error("");
  console.error(formatLocalOnlyNote(skippedLocal));
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
