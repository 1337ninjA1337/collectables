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
 * Not memoised, deliberately: each suite is its own process, so a cache could
 * only ever hit within one file, and the suites that read one file repeatedly
 * already hold it in a `const`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** The repository root — where `npm test` is invoked from. */
export const REPO_ROOT = process.cwd();

/**
 * One repo-relative file's text, e.g. `readRepoFile("lib/item-filters.ts")`.
 *
 * Throws (`ENOENT`) on a path that is not there, which is the right shape for
 * a structural test: a suite asserting things about a file it could not open
 * should stop, not report every assertion as a finding about the code.
 */
export function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}
