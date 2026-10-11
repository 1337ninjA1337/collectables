/**
 * This repository's own `package-lock.json`, parsed once per suite process.
 *
 * ## What the copies were
 *
 * Four suites read the real lockfile and each did its own `JSON.parse(
 * readRepoFile("package-lock.json"))`, two of them twice in one file:
 * `lockfile.test.ts` (the walk's floor, and the version check's floor),
 * `check-sentry-version.test.ts` (the guard's green state, and the same floor)
 * and `audit-baseline.test.ts` (the pinned-fix measurement, which wants the
 * raw `packages` entries rather than the walk's record). The two in-file
 * duplicates were parsing it twice for two cases in adjacent describes that
 * could not see each other's local.
 *
 * Not for speed, and the number is here so nobody argues it is: the file is
 * 640 KiB over 1,265 keyed installs, and reading plus parsing it is 6 ms
 * (1.5 ms read, 4.6 ms parse, three consecutive runs within 0.4 ms of each
 * other). Three suites × one parse each is 18 ms of a 168-second run. What
 * this removes is four spellings of what "the real lockfile" means, and one
 * of them was a hand-rolled two-level index that throws on a v1 file.
 *
 * ## One parse per PROCESS, which is the only kind that can hit
 *
 * `tsx --test` runs every suite file in its own child process, so a
 * module-scope const here is loaded once per suite that imports it — not once
 * for the run. That is the same fact `readRepoFile`'s header states as its
 * reason NOT to memoise, and it is why this module is the parse rather than a
 * cache: what it removes is the second parse inside one file, and the four
 * spellings of what "the real lockfile" means.
 *
 * It is not a fixture. Everything here is read live, so a `npm install` that
 * moves a version moves what these cases see — which is the point. The frozen
 * counterpart is `__tests__/helpers/audit-snapshot.ts`, and its header argues
 * at length why the gate's OUTPUT needs a frozen tree while the claims about
 * this repository's own state need a live one.
 */

import { type InstalledVersions, lockedVersions, unwalkableLockfile } from "@/lib/lockfile";

import { readRepoFile } from "./repo-file";

/**
 * The file's text, for the readers that take a string.
 *
 * `readInstalledVersions` takes a thunk returning the text, so its floor case
 * wants this rather than the parse — and wanting the text is the reason this
 * is exported at all rather than being a local inside the parse below.
 */
export const REPO_LOCKFILE_TEXT: string = readRepoFile("package-lock.json");

/**
 * The parse, as `unknown`.
 *
 * `unknown` on purpose, and it is the same argument `lib/lockfile.ts` makes
 * for its own boundary: this is what `JSON.parse` returns, every reader of it
 * is guards deep, and the one shape the readers want is {@link REPO_INSTALLED}.
 * The cases that hand it to a function taking `unknown` — the walk, the
 * version check — want exactly this and no narrowing.
 */
export const REPO_LOCKFILE: unknown = JSON.parse(REPO_LOCKFILE_TEXT);

/**
 * What the walk makes of it: `name -> version` for every root install.
 *
 * The record four hand-rolled readers were each building a key at a time
 * before `lockedVersions` existed, and which one case in
 * `check-sentry-version.test.ts` was still building by reaching into
 * `packages["node_modules/@sentry/react-native"].version` — an unguarded
 * two-level index that reads `undefined` on a v1 lockfile and throws a
 * `TypeError` on one, rather than reporting anything.
 */
export const REPO_INSTALLED: InstalledVersions = lockedVersions(REPO_LOCKFILE);

/**
 * One lockfile entry as the pinned-fix measurement reads it.
 *
 * The one reader that wants the RAW entries rather than the walk's record:
 * `ACCEPTED_HIGH_ADVISORIES`' `inRangeFixPinned` names a dependent and the
 * range it declares, and checking that claim means reading the dependent's
 * own `dependencies` block — which `lockedVersions` throws away, because its
 * question is what a tree is on.
 */
export interface RepoLockfileEntry {
  readonly dependencies?: Readonly<Record<string, string | undefined>>;
}

/**
 * Every keyed install path, nested copies included.
 *
 * Keyed the way the file is — `node_modules/<name>`, `node_modules/a/node_modules/b`
 * — because the measurement's `pinnedBy` is a lockfile KEY and looking it up
 * is the whole assertion. Nested copies are KEPT here and dropped by
 * {@link REPO_INSTALLED}, and the asymmetry is the two questions: "what is
 * this tree on" has one answer per package, and "what does the dependent at
 * this key declare" is asked about the key the measurement wrote down, which
 * may well be a nested one. A reader after the former wants
 * {@link REPO_INSTALLED}.
 *
 * ## Why this throws rather than falling back to `{}`
 *
 * It was `?? {}` for one commit, and that is the defect `unwalkableLockfile`
 * was written for, one directory up: a lockfile with no `packages` block —
 * v1, truncated, or not a lockfile — would make every entry absent, and the
 * one reader reports an absent entry as `inRangeFixPinned names metro and
 * package-lock.json has no such package — the dependent moved and the
 * measurement did not`. Five true-sounding findings about a file nobody could
 * read, which is the shape "a check that could not ask must not read as an
 * answer" is about.
 *
 * Throwing at module scope stops the importing suite instead, which is the
 * call `readRepoFile`'s header makes about `ENOENT` for the same reason: a
 * suite asserting things about a file it could not read should stop, not
 * report every assertion as a finding about the code.
 */
export const REPO_LOCKFILE_ENTRIES: Readonly<Record<string, RepoLockfileEntry | undefined>> =
  lockfileEntries(REPO_LOCKFILE);

/**
 * The entries block, or the error that stops the suite.
 *
 * Exported, and only because the throwing branches are unreachable from
 * {@link REPO_LOCKFILE_ENTRIES}: that const is module scope over a real v3
 * file, so a case cannot make it fail without planting a broken lockfile in
 * the repository. A named function is the only way the two refusals get read
 * by anything, and they are the whole reason this is not `?? {}`.
 */
export function lockfileEntries(
  lock: unknown,
): Readonly<Record<string, RepoLockfileEntry | undefined>> {
  const packages = typeof lock === "object" && lock !== null ? (lock as { packages?: unknown }).packages : undefined;
  if (typeof packages !== "object" || packages === null) {
    throw new Error(
      "repo-lockfile: package-lock.json has no `packages` block, so no suite here can read a lockfile entry — " +
        `${String(unwalkableLockfile(lock) ?? "the file parsed and carries no packages")}`,
    );
  }
  // `| undefined` per key, which is the contract the one reader needs: it
  // looks up an `inRangeFixPinned.pinnedBy` and the finding it makes is about
  // the key being absent. A record claiming every key is present would make
  // that lookup `RepoLockfileEntry` and the `assert.ok(dependent)` above it
  // dead code.
  const entries = packages as Readonly<Record<string, RepoLockfileEntry | undefined>>;
  if (Object.keys(entries).length === 0) {
    throw new Error(
      "repo-lockfile: package-lock.json's `packages` block is empty — run npm install before running the suites that read it",
    );
  }
  return entries;
}
