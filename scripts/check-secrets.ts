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
  formatScanSubject,
  formatUnreadCandidates,
  formatUnreadCommitted,
  type ScanSubject,
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
import {
  describeIrregular,
  guardScanRoot,
  isUnreadCommitted,
  listFilesUnder,
  partitionRegularFiles,
  selectPaths,
  type IrregularPath,
} from "./guard-io";

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
  /** Which set the pass line says it read, and what git's list left out. */
  readonly subject: ScanSubject;
  /**
   * Candidates the listing held that the scan did not read, each with the
   * reason. Empty under the walk, which never produces one: it answers the
   * question while it recurses.
   */
  readonly unread: readonly IrregularPath[];
};

function candidatesIn(repoRoot: string): Candidates {
  const committable = listCommittable(repoRoot);
  const walk = (extensions: readonly string[]): string[] =>
    listFilesUnder(repoRoot, { extensions, skipDirs: SECRET_SKIP_DIRS });
  const pick = (extensions: readonly string[]): string[] =>
    committable.ok
      ? selectPaths(committable.files, { extensions, skipDirs: SECRET_SKIP_DIRS })
      : walk(extensions);
  // The skip list is applied after the listing rather than inside it: it names
  // FILES, and a walk that knows about individual files is a walk with a second
  // rule in it.
  const picked = pick(SOURCE_SCAN_EXTENSIONS).filter(notExempt);
  // The containers, listed separately because what happens to them is
  // different: they are opened and their entries decoded, rather than read as
  // one string. Same skip list, since it names files and an archive is one.
  const pickedArchives = pick(ARCHIVE_SCAN_EXTENSIONS).filter(notExempt);
  if (!committable.ok) {
    return {
      files: picked,
      archives: pickedArchives,
      subject: { source: "walk", reason: committable.reason },
      unread: [],
    };
  }
  // The walk answers this by construction — `entry.isFile()` on every entry it
  // meets — and a list from `git ls-files` has never been asked. A tracked
  // symlink is in that list, and reading one follows it: out of the scan root
  // if it points there, with whatever it finds reported at the LINK's path as
  // a credential this repository committed. So the same question is put to the
  // listed candidates, and what it removed is NAMED in the pass line — a count
  // alone is enough to notice a change and not enough to act on one.
  const text = partitionRegularFiles(repoRoot, picked);
  const containers = partitionRegularFiles(repoRoot, pickedArchives);
  const files = text.files;
  const archives = containers.files;
  // The walk is run a second time under git, purely to COUNT what git's list
  // left out. It costs one traversal of a tree the skip list has already
  // narrowed to a few hundred entries, and it buys the only number that moves
  // when an ignore rule starts covering something real — without it, the run
  // that introduces such a rule reads exactly like the run before it.
  // Built from the picked lists rather than the scanned ones, so the two
  // numbers stay about two different things: a symlink is in git's list and
  // never in the walk, and counting it here as well would report it twice
  // under two names.
  const listed = new Set([...picked, ...pickedArchives]);
  const notListed = [...walk(SOURCE_SCAN_EXTENSIONS), ...walk(ARCHIVE_SCAN_EXTENSIONS)].filter(
    (rel) => notExempt(rel) && !listed.has(rel),
  ).length;
  return {
    files,
    archives,
    subject: { source: "git", notListed },
    unread: [...text.irregular, ...containers.irregular],
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

  // The two reasons a listed candidate went unread part ways here. A symlink
  // (`isUnreadCommitted` false) is a repository that uses links, so it stays a
  // pass-line curiosity below. A committed file the working tree does not hold
  // is a checkout disagreeing with its own index: this scan could not open it,
  // and a run that ends "no committed secrets" cannot vouch for a file it never
  // read — so it fails here, the same as an archive it could not open.
  const unreadCommitted = candidates.unread
    .filter((u) => isUnreadCommitted(u.kind))
    .map((u) => u.rel);
  const missing = formatUnreadCommitted(unreadCommitted);
  if (missing) {
    console.error(`${CHECK_NAME}: ${missing}`);
    process.exit(1);
  }
  const unreadBenign = candidates.unread.filter((u) => !isUnreadCommitted(u.kind));

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
    // Both clauses are empty on a clean checkout, so the usual line is the
    // usual line; each appears only when there was something to say.
    const clauses = [
      formatLocalOnlySkips(skippedLocal, probe),
      formatUnreadCandidates(
        unreadBenign.map((u) => ({ rel: u.rel, kind: describeIrregular(u.kind) })),
      ),
    ].filter(Boolean);
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s) plus ${entryCount} entr(ies) in ${archives.length} archive(s) from ${formatScanSubject(candidates.subject)}, no committed secrets` +
        `${clauses.map((clause) => `, ${clause}`).join("")}.`,
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
