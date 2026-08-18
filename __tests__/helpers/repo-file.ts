/**
 * Reading a file out of the repository, said once.
 *
 * A hundred and forty-seven suites declared their own two-line version of this
 * — `readFileSync(path.join(process.cwd(), rel), "utf8")` written out, or the
 * same thing behind a local `ROOT` / `REPO_ROOT` / `repoRoot` const — because
 * most structural tests here read source TEXT rather than importing modules
 * that pull React Native peers. Nobody wrote it wrong; they wrote it a
 * hundred and forty-seven times, and the copies had already begun to differ in
 * ways nobody chose (one passes the path through unjoined, one goes through
 * `fs.` rather than a named import, four spell the root four ways).
 *
 * `readI18nSource` made the same argument for one file. This is that argument
 * at the scale it actually has: the point is not the two lines, it is that a
 * question about how the suites reach the tree ("do they resolve from cwd or
 * from the file?") has one answer to read instead of a hundred and forty-seven
 * to compare.
 *
 * `process.cwd()` rather than a path derived from `import.meta.url`, and the
 * distinction matters: `tsx --test` runs every suite in its own process with
 * the repository root as cwd, so the two agree today and answer different
 * questions — cwd is "where the runner was started", which is what a
 * repo-relative path in a test means. A suite run from elsewhere should fail
 * loudly rather than quietly resolve against a source directory.
 *
 * Reading is not the only thing the suites do with the root, which is why
 * {@link repoPath} and {@link repoRelative} are here beside
 * {@link readRepoFile}: about half the remaining `process.cwd()` calls
 * anchored a directory WALK (`readdirSync(path.join(process.cwd(), dir))`) or
 * turned an absolute hit back into a reportable name (`path.relative(
 * process.cwd(), file)`), and a helper that only reads leaves those spelling
 * the root for themselves. With all three here the guard can state the rule
 * that has no next near-miss — a suite does not say `process.cwd()` at all —
 * instead of enumerating the shapes a read can be written in.
 *
 * Segments rather than a slash-joined string, decided once and applying to
 * both: `path.join` normalises separators, so `readRepoFile("lib/foo.ts")`
 * and `readRepoFile("lib", "foo.ts")` are the same path on both platforms
 * Node supports. Call sites use whichever reads better — a fixed file tends
 * to be one string, a walk root joined with a variable tends to be segments —
 * and neither is a second convention to learn, because both go through here.
 *
 * Not memoised, deliberately: each suite is its own process, so a cache could
 * only ever hit within one file, and the suites that read one file repeatedly
 * already hold it in a `const`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** The repository root — where `npm test` is invoked from. */
export const REPO_ROOT = process.cwd();

/**
 * An absolute path to something in the repository, e.g.
 * `repoPath("supabase", "migrations")` or `repoPath(".github/workflows")`.
 *
 * At least one segment is required: `repoPath()` would be {@link REPO_ROOT}
 * spelled less clearly, and a zero-argument call is far more likely to be a
 * spread that came out empty than a deliberate ask for the root.
 */
export function repoPath(first: string, ...rest: readonly string[]): string {
  return path.join(REPO_ROOT, first, ...rest);
}

/**
 * One repo-relative file's text, e.g. `readRepoFile("lib/item-filters.ts")`.
 *
 * Throws (`ENOENT`) on a path that is not there, which is the right shape for
 * a structural test: a suite asserting things about a file it could not open
 * should stop, not report every assertion as a finding about the code.
 */
export function readRepoFile(first: string, ...rest: readonly string[]): string {
  return readFileSync(repoPath(first, ...rest), "utf8");
}

/**
 * An absolute path back as a repo-relative one, for reporting.
 *
 * The other half of a walk: a sweep collects absolute paths from `readdirSync`
 * and an assertion message naming
 * `/home/runner/work/collectables/collectables/lib/foo.ts` says the same thing
 * as `lib/foo.ts` with the reader's eye spent on the prefix.
 */
export function repoRelative(absolute: string): string {
  return path.relative(REPO_ROOT, absolute);
}
