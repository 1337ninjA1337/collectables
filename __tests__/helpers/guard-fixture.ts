/**
 * Scratch scan roots for the `LINT_GUARDS` fleet, in the two shapes the
 * floor's two failure codes need.
 *
 * `__tests__/lint-guard-empty-root.test.ts` builds the first shape by hand —
 * one `os.tmpdir()` directory, nothing in it — and every guard pointed at it
 * fails on `no_files`. That is the LOUD version of the failure and the one the
 * floor was never really for: `evaluateScannedFloor` already refused
 * `count <= 0` before any floor existed. The number in `SCANNED_FLOORS` buys
 * the QUIET version — a walk that lost `app/` but kept `lib/` reports a
 * comfortable-looking count over a fraction of the tree — and `below_floor`
 * had never been produced by anything but a hand-edit.
 *
 * A partial root is the empty one plus a copy of part of this repository, so
 * the walk finds real files and finds too few of them.
 *
 * COPIES, not symlinks. A symlinked scan root works for the guards that walk
 * `path.join(root, "app")` directly (`readdirSync` follows the path it is
 * given) and silently produces ZERO files for the ones that enumerate the root
 * itself — `check-secrets` reads the top level with `withFileTypes` and a
 * symlink answers `isDirectory() === false`, so it is skipped, and the fixture
 * that was supposed to assert `below_floor` asserts `no_files` instead while
 * looking like it worked. The copies are small (the largest fixture here is
 * `app/`, ~400K) and they cannot lie about their own entry type.
 *
 * Lives under `__tests__/helpers/` — outside the `__tests__/*.test.ts` runner
 * glob, so it is a library, not a suite.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The repository this fixture copies out of. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type PartialRoot = {
  /** Absolute path of the scratch root, for `LINT_GUARD_REPO_ROOT`. */
  readonly root: string;
  /** Removes it. Safe to call twice. */
  readonly cleanup: () => void;
};

/**
 * A temp directory holding copies of `entries` (repo-relative files or
 * directories) at the same relative paths, and nothing else.
 *
 * Every parent directory is created for real, so a nested entry such as
 * `supabase/migrations` yields a real `supabase/` a top-level walk descends
 * into rather than skipping.
 */
export function makePartialRoot(entries: readonly string[]): PartialRoot {
  if (entries.length === 0) {
    throw new Error(
      "makePartialRoot: a partial root with no entries is an EMPTY root — use the empty-root harness, which asserts the other failure code.",
    );
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-guard-partial-"));
  for (const entry of entries) {
    if (path.isAbsolute(entry)) {
      throw new Error(
        `makePartialRoot: "${entry}" must be repo-relative — an absolute path would copy from outside this checkout.`,
      );
    }
    const source = path.join(REPO_ROOT, entry);
    if (!fs.existsSync(source)) {
      throw new Error(
        `makePartialRoot: "${entry}" does not exist in this repository, so the fixture would be empty and the guard would fail on the wrong code.`,
      );
    }
    const destination = path.join(root, entry);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, dereference: true });
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
