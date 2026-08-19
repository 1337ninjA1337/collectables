/**
 * The filesystem half of the guard premise: the three reads every
 * `LINT_GUARDS` wrapper does, in the shape that turns a missing scan root
 * into a floor failure instead of a stack trace.
 *
 * A wrapper pointed at a tree that does not hold what it walks used to end in
 * an uncaught `ENOENT` from `readdirSync` — exit 1, so CI was right, with a
 * node stack that names `fs.readdirSync` and not the guard. The floor already
 * knows how to say "this run examined nothing"; these helpers just make sure
 * it is the thing that gets to say it.
 *
 * Deliberately NOT in `lib/`: `lib/scanned-floor.ts` and `lib/guard-root.ts`
 * stay fs-free so they can be reasoned about as pure functions, and this is
 * the file that touches disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { formatGuardRootNotice, resolveGuardRoot } from "../lib/guard-root";
import { NEVER_WALKED, SOURCE_EXTENSIONS } from "../lib/source-dirs";
import { unreadableInput, type UnreadableInput } from "../lib/scanned-floor";
import { describeThrownReason } from "../lib/thrown-value";

/**
 * The one line every wrapper runs before it walks anything: resolve the root
 * (honouring `LINT_GUARD_REPO_ROOT`) and announce it on stderr when it is not
 * this repository. Called from inside `main()` so a bad override is caught by
 * the wrapper's own handler and printed as one line, not a stack.
 */
export function guardScanRoot(
  checkName: string,
  defaultRoot: string,
  vars?: readonly string[],
): string {
  const resolution = resolveGuardRoot(checkName, defaultRoot, process.env, vars);
  const notice = formatGuardRootNotice(checkName, resolution);
  if (notice) console.error(notice);
  return resolution.root;
}

/**
 * Whatever the OS or the parser called it, in one string.
 *
 * The rendering lives in `lib/thrown-value.ts` rather than here because the
 * guard fixture had a second copy of it, and the two copies shared both of the
 * bugs it fixes: a blank `code` returned as the whole reason, and a thrown
 * non-Error rendered through `String(...)`, which answers `[object Object]`
 * for an object and throws for one with no prototype — inside the catch that
 * was reporting a different failure.
 */
const reasonOf = describeThrownReason;

/**
 * Directory entries, or none. An unreadable directory is not an error here on
 * purpose: it is a count of zero, which the guard's floor then refuses. The
 * alternative — throwing — makes every wrapper carry its own catch and report
 * the failure in its own words.
 */
export function listDirEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The same, for the wrappers that want names rather than entries. */
export function listDirNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Every file under one root, recursively — relative to that root, and sorted.
 *
 * The walk seven guards had each written out. Five of them are the source scans
 * {@link listSourceFiles} now serves; the other two are the secret scanners,
 * which are the widest walks in the repository and were the two with the least
 * in common with anything: `check-secrets` covers the whole tree across
 * fourteen text extensions, and `check-bundle-secrets` covers `dist/` across
 * five artifact extensions. They shared the shape and none of the arguments,
 * which is why they each grew a copy — and one of the copies had its own
 * `try`/`catch` around `readdirSync`, the exact silent-pass hazard
 * {@link listDirEntries} exists to hold in one place.
 *
 * Relative to the ROOT it was given, not to the repository: `check-bundle-
 * secrets` walks `dist/` and reports `_expo/static/js/web/entry-….js`, which
 * is the name a reader of that guard wants. A caller reading the file joins
 * the root back on.
 *
 * `skipDirs` is matched on the directory's own NAME rather than its path, so
 * `node_modules` is skipped wherever it turns up. Nothing here skips by path,
 * and a guard that needs to would be saying something about one tree rather
 * than about a kind of directory.
 *
 * The extension test is case-FOLDED, and it was not: a stray uppercase copy of
 * the manual-tasks document sat in this repository unscanned by the secret
 * guard for as long as it existed, because `path.extname` answers `.MD` and
 * the set holds `.md`. Every set passed here is written in lower case, and a
 * rule that reads `Foo.TSX` as a non-source file is a rule with a hole one
 * shift key wide.
 *
 * Omitting `extensions` returns EVERY file. One caller wants that — the case
 * that asks which extensions the tree actually holds, so a new one cannot join
 * it without a decision about whether the secret scan reads it — and an
 * absent filter is a clearer way to say "all of them" than a list that has to
 * be kept exhaustive.
 */
export function listFilesUnder(
  root: string,
  options: { readonly extensions?: Iterable<string>; readonly skipDirs?: Iterable<string> },
): string[] {
  const extensions = options.extensions === undefined ? null : new Set(options.extensions);
  const skipDirs = new Set(options.skipDirs ?? []);
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of listDirEntries(relative === "" ? root : path.join(root, relative))) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(relative === "" ? entry.name : `${relative}/${entry.name}`);
      } else if (
        entry.isFile() &&
        (extensions === null || extensions.has(path.extname(entry.name).toLowerCase()))
      ) {
        found.push(relative === "" ? entry.name : `${relative}/${entry.name}`);
      }
    }
  };
  walk("");
  return found.sort();
}

/**
 * The same two filters {@link listFilesUnder} applies, over a list somebody
 * else produced.
 *
 * A scan can get its candidates from a walk or from `git ls-files`, and the
 * two must agree on WHICH of the candidates it reads — extension in the set,
 * no path segment in the skip list. Written once here rather than inline at
 * the second source, because "the walk skips `.git/` and the git listing does
 * not" is precisely the kind of disagreement that is invisible in a green run.
 *
 * Segments rather than a prefix test: `skipDirs` names directories WHEREVER
 * they appear, which is the same rule the walk applies by never descending.
 * The last segment is the file, so it is not consulted — a file called `dist`
 * is a file.
 */
export function selectPaths(
  paths: readonly string[],
  options: { readonly extensions?: Iterable<string>; readonly skipDirs?: Iterable<string> },
): string[] {
  const extensions = options.extensions === undefined ? null : new Set(options.extensions);
  const skipDirs = new Set(options.skipDirs ?? []);
  return paths
    .filter((rel) => {
      const segments = rel.split(/[\\/]/);
      if (segments.slice(0, -1).some((segment) => skipDirs.has(segment))) return false;
      return extensions === null || extensions.has(path.extname(rel).toLowerCase());
    })
    .sort();
}

/**
 * Which of `paths` are REGULAR files, and which are something else.
 *
 * The other half of the agreement {@link selectPaths} exists for, and the half
 * it cannot make: name and extension are decidable from the string, and
 * "symlink or not" is a question for the disk. {@link listFilesUnder} asks it
 * on every entry it walks (`entry.isFile()`, which is false for a symlink, a
 * fifo and a socket alike), so a candidate list from `git ls-files` that skips
 * the question does not agree with the walk — it is WIDER, in the one direction
 * that leaves the scan reading files the repository does not contain.
 *
 * A tracked symlink is the case that matters. Git commits its TARGET PATH, a
 * few dozen bytes; `readFileSync` follows it, so a scan handed `docs/link.md`
 * reads whatever it points at — a file elsewhere in the tree, or `../../../
 * secrets/real.env`, or anything at all outside the root the guard was told to
 * scan. What comes back is reported at the link's path, as a credential this
 * repository committed, which it did not.
 *
 * `lstat` rather than `stat`, since following the link is the thing being
 * avoided. Anything that cannot be stat'd at all — a path git holds and the
 * working tree does not, a dangling link, a race with a checkout — is
 * irregular too: not a file this scan can read, and not one it should be
 * silent about.
 *
 * Those last two are one number and two events, which is why each one carries
 * its reason. A symlink is a repository that uses links, and normal. A path
 * git lists that is NOT on disk is a checkout that disagrees with its own
 * index — a committed file this scan did not read, reported by a run that
 * otherwise says it read the committed set. The second deserves more alarm
 * than the first, and a single count gives them the same.
 */
export type IrregularKind = "not a regular file" | "missing from the working tree";
export type IrregularPath = { readonly rel: string; readonly kind: IrregularKind };

export function partitionRegularFiles(
  root: string,
  paths: readonly string[],
): { files: string[]; irregular: IrregularPath[] } {
  const files: string[] = [];
  const irregular: IrregularPath[] = [];
  for (const rel of paths) {
    let kind: IrregularKind | null = null;
    try {
      if (!fs.lstatSync(path.join(root, rel)).isFile()) kind = "not a regular file";
    } catch {
      // Every errno lands here — `ENOENT` for the state this is about, and
      // `EACCES` or `ELOOP` for a root the guard cannot traverse. All of them
      // mean the same thing to a scan: git named this path and the working
      // tree did not produce it.
      kind = "missing from the working tree";
    }
    if (kind === null) files.push(rel);
    else irregular.push({ rel, kind });
  }
  return { files, irregular };
}

/**
 * Every source file under the given directories, repo-relative and sorted.
 *
 * Five guards had written this walk out, under three names and with four
 * differences nobody chose: three returned a sorted array and two appended to
 * an out-param the caller sorted afterwards, three matched `/\.tsx?$/` and one
 * `.endsWith(".tsx")`, three checked `entry.isFile()` and two took anything
 * that was not a directory (which counts a symlink or a fifo as source). The
 * shapes agreed on every tree this repo has, which is exactly why the drift
 * was free to continue.
 *
 * Repo-relative forward-slash paths rather than absolute ones, because that is
 * what every caller needs next: four of the five ran `path.relative(repoRoot,
 * file)` on the very next line to report a finding, and the fifth keyed a
 * record by it. `path.join(repoRoot, relative)` is the read.
 *
 * Built on {@link listFilesUnder}, so a scan root that is not there is a count
 * of zero rather than an `ENOENT` — the floor is what should say a run
 * examined nothing, in the guard's own words.
 *
 * One call per process, so no cache: each guard is its own `tsx` invocation
 * and calls this once. The suite-side walk in `__tests__/helpers/source-files.
 * ts` memoises for the opposite reason — eighteen suites sweep the same tree.
 */
export function listSourceFiles(
  repoRoot: string,
  dirs: readonly string[],
  extensions: readonly string[] = SOURCE_EXTENSIONS,
): string[] {
  return dirs
    .flatMap((dir) =>
      listFilesUnder(path.join(repoRoot, dir), { extensions, skipDirs: NEVER_WALKED }).map(
        (rel) => `${dir}/${rel}`,
      ),
    )
    .sort();
}

/**
 * A declared fixed input as text, or the marker that says why not — handed
 * straight to `assertParsedInputs`, which turns it into one line naming the
 * file and the errno.
 */
export function readTextInput(file: string): string | UnreadableInput {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    return unreadableInput(reasonOf(error));
  }
}

/**
 * Narrowing companion to {@link readTextInput}, for use AFTER
 * `assertParsedInputs` has already rejected the unreadable case: it turns the
 * union back into a string without an `as` cast that would also swallow a
 * genuine wiring mistake.
 */
export function asText(value: string | UnreadableInput): string {
  if (typeof value === "string") return value;
  throw new Error(
    `guard-io: input was unreadable (${value.reason}) and reached a reader anyway — assert it with assertParsedInputs first.`,
  );
}

/** The same, parsed — a file that exists and is not JSON is unreadable too. */
export function readJsonInput(file: string): unknown | UnreadableInput {
  const text = readTextInput(file);
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    return unreadableInput(`invalid JSON: ${reasonOf(error)}`);
  }
}
