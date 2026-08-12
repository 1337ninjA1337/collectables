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

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GUARD_ROOT_ENV } from "../../lib/guard-root";
import type { LintGuard } from "../../lib/lint-guards";

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
 * directories) at the same relative paths, plus any literal `files`, and
 * nothing else.
 *
 * Every parent directory is created for real, so a nested entry such as
 * `supabase/migrations` yields a real `supabase/` a top-level walk descends
 * into rather than skipping.
 *
 * `files` is the half `entries` cannot express: the `empty_input` failure is
 * about a declared input that reads and parses FINE and carries nothing
 * (`{}`, `""`), and no path in this repository is that file. A literal is the
 * only way to hand a guard one.
 */
export function makePartialRoot(
  entries: readonly string[],
  files: Readonly<Record<string, string>> = {},
): PartialRoot {
  if (entries.length === 0 && Object.keys(files).length === 0) {
    throw new Error(
      "makePartialRoot: a partial root with no entries and no files is an EMPTY root — use the empty-root harness, which asserts the other failure code.",
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
  for (const [relative, content] of Object.entries(files)) {
    if (path.isAbsolute(relative)) {
      throw new Error(
        `makePartialRoot: "${relative}" must be a path inside the scratch root, not an absolute one.`,
      );
    }
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, "utf8");
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export type GuardRun = {
  /** stdout and stderr together — the refusal lands on stderr. */
  readonly output: string;
  readonly status: number;
};

const runs = new Map<string, GuardRun>();

/**
 * A guard, run against a scratch root, memoised per (script, args, root) —
 * every assertion about one run would otherwise pay its own ~430 ms tsx boot.
 *
 * Failure is the expected outcome here, so a non-zero exit is captured rather
 * than thrown: the exit code and the message are both things to assert.
 */
export function runGuardIn(guard: LintGuard, root: string): GuardRun {
  const key = `${guard.scriptPath} ${guard.args.join(" ")} ${root}`;
  const cached = runs.get(key);
  if (cached) return cached;
  let output = "";
  let status = 0;
  try {
    output = execFileSync(
      path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [path.join(REPO_ROOT, guard.scriptPath), ...guard.args],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, [GUARD_ROOT_ENV]: root },
      },
    );
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    status = failure.status ?? 1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  const run = { output, status };
  runs.set(key, run);
  return run;
}

/** Every `LINT_GUARDS` entry prints this at the head of its own report. */
export function checkNameOf(scriptPath: string): string {
  return scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "");
}
