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

import { formatGuardRootNotice, resolveGuardRoot } from "../lib/guard-root";
import { unreadableInput, type UnreadableInput } from "../lib/scanned-floor";

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

/** Whatever the OS or the parser called it, in one string. */
function reasonOf(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === "string") return code;
  return error instanceof Error ? error.message : String(error);
}

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
