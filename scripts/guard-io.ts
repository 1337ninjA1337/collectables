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
import { SOURCE_EXTENSIONS } from "../lib/source-dirs";
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
 * Built on {@link listDirEntries}, so a scan root that is not there is a count
 * of zero rather than an `ENOENT` — the floor is what should say a run
 * examined nothing, in the guard's own words.
 */
export function listSourceFiles(
  repoRoot: string,
  dirs: readonly string[],
  extensions: readonly string[] = SOURCE_EXTENSIONS,
): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of listDirEntries(path.join(repoRoot, relative))) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(child);
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return found.sort();
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
