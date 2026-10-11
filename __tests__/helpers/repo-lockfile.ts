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
 * raw `packages` entries rather than the walk's record). 1.9 MB of JSON, and
 * the two in-file duplicates were parsing it twice for two cases in adjacent
 * describes that could not see each other's local.
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

import { type InstalledVersions, lockedVersions } from "@/lib/lockfile";

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
 * is the whole assertion.
 */
export const REPO_LOCKFILE_ENTRIES: Readonly<Record<string, RepoLockfileEntry | undefined>> =
  (REPO_LOCKFILE as { packages?: Readonly<Record<string, RepoLockfileEntry>> }).packages ?? {};
