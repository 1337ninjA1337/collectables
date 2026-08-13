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

/** The binary every guard in every one of these suites is spawned through. */
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/**
 * Fail on the missing install rather than on its symptom.
 *
 * `execFileSync` on an absent binary throws ENOENT with no stdout and no
 * stderr, so `runGuardFrom` captures `""` and exit 1 — which is byte-for-byte
 * what a guard REFUSING looks like to these suites. Every assertion of the
 * form "this run failed" then passes for the wrong reason, and every assertion
 * of the form "this run passed" fails with a bare `1 !== 0` and no output to
 * explain it. Four suites depend on this binary; the diagnosis is worth one
 * `existsSync`.
 */
function tsxBinary(): string {
  if (!fs.existsSync(TSX_BIN)) {
    throw new Error(
      `guard-fixture: ${TSX_BIN} does not exist, so no guard can be spawned. Run \`npm ci\` — without it these suites fail with an empty output and a bare exit 1, which is indistinguishable from the refusals they are asserting.`,
    );
  }
  return TSX_BIN;
}

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

/**
 * A copy of the parts of this repository a guard needs to RUN, with named
 * files rewritten on the way in.
 *
 * The other fixtures here move what a guard LOOKS AT. This one moves what a
 * guard IS, which is the only way to produce `invalid_floor`: that code is
 * about the guard's own declaration in `lib/scanned-floor.ts`, so the
 * committed table has to be wrong for it to fire, and the committed table is —
 * correctly — never wrong. Copy `lib/` and `scripts/`, patch the table in the
 * copy, run the copy.
 *
 * `lib/` and `scripts/` are enough because every guard wrapper reaches its
 * dependencies through relative imports; the tsx binary and `node_modules`
 * stay in the real checkout, resolved from the absolute paths
 * {@link runGuardFrom} passes.
 *
 * Each patch MUST change its file. A patch whose anchor string has drifted
 * would otherwise copy the source verbatim, the guard would pass, and the test
 * asserting a refusal would report the refusal it never got as a bug in the
 * guard rather than as a stale fixture.
 */
export function makePatchedRepo(
  patches: Readonly<Record<string, (source: string) => string>>,
  entries: readonly string[] = ["lib", "scripts"],
): PartialRoot {
  const patched = makePartialRoot(entries);
  for (const [relative, patch] of Object.entries(patches)) {
    const target = path.join(patched.root, relative);
    if (!fs.existsSync(target)) {
      patched.cleanup();
      throw new Error(
        `makePatchedRepo: "${relative}" is not in the copied entries (${entries.join(", ")}), so the patch would land nowhere.`,
      );
    }
    const source = fs.readFileSync(target, "utf8");
    const next = patch(source);
    if (next === source) {
      patched.cleanup();
      throw new Error(
        `makePatchedRepo: the patch for "${relative}" changed nothing — its anchor has drifted, and the fixture would run an UNPATCHED guard while claiming to run a broken one.`,
      );
    }
    fs.writeFileSync(target, next, "utf8");
  }
  return patched;
}

export type GuardRun = {
  /** stdout and stderr together — the refusal lands on stderr. */
  readonly output: string;
  readonly status: number;
};

const runs = new Map<string, GuardRun>();

/**
 * Ceiling on a single guard run, ~70x the ~430 ms a boot actually costs.
 *
 * `execFileSync` with no timeout waits forever, and forever inside a test
 * runner is a CI job that burns its whole limit with no output and no failing
 * assertion to point at — the worst possible shape for a harness whose entire
 * job is turning silence into a stated result. A guard that has not answered
 * in half a minute has not answered; the timeout turns that into a normal
 * captured failure the assertions can read.
 */
const GUARD_RUN_TIMEOUT_MS = 30_000;

/**
 * Guards print reports, and a report over a broken tree can be long. Node's
 * 1MB default would turn an overlong report into an ENOBUFS throw with the
 * output discarded, which reads as a crash rather than as the finding it is.
 */
const GUARD_RUN_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * A guard, run against a scratch root, memoised per (script, args, root) —
 * every assertion about one run would otherwise pay its own ~430 ms tsx boot.
 *
 * Failure is the expected outcome here, so a non-zero exit is captured rather
 * than thrown: the exit code and the message are both things to assert.
 */
export function runGuardIn(guard: LintGuard, root: string): GuardRun {
  return runGuardFrom(guard, REPO_ROOT, root);
}

/**
 * {@link runGuardIn} with the guard's own source root split out from the tree
 * it scans, so a copy patched by {@link makePatchedRepo} can be the thing that
 * runs while a real, complete tree is the thing it walks — leaving the
 * patched declaration as the only reason the run can fail.
 */
export function runGuardFrom(
  guard: LintGuard,
  scriptRoot: string,
  root: string,
): GuardRun {
  const key = `${scriptRoot} ${guard.scriptPath} ${guard.args.join(" ")} ${root}`;
  const cached = runs.get(key);
  if (cached) return cached;
  let output = "";
  let status = 0;
  try {
    output = execFileSync(
      tsxBinary(),
      [path.join(scriptRoot, guard.scriptPath), ...guard.args],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, [GUARD_ROOT_ENV]: root },
        timeout: GUARD_RUN_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: GUARD_RUN_MAX_BUFFER,
      },
    );
  } catch (error) {
    const failure = error as {
      status?: number;
      signal?: string;
      code?: string;
      stdout?: string;
      stderr?: string;
    };
    status = failure.status ?? 1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    if (failure.signal === "SIGKILL" || failure.code === "ETIMEDOUT") {
      // Say which run stalled and what it had managed to print. Without this
      // the assertions downstream see an empty output and exit 1, which is
      // exactly what a guard REFUSING looks like — the same confusion
      // `tsxBinary()` exists to prevent, arriving by a different door.
      output = `${output}\nguard-fixture: ${guard.scriptPath} (from ${scriptRoot}) did not finish within ${GUARD_RUN_TIMEOUT_MS}ms against ${root} and was killed. Everything it printed before that is above.`;
    }
  }
  const run = { output, status };
  runs.set(key, run);
  return run;
}

/** Every `LINT_GUARDS` entry prints this at the head of its own report. */
export function checkNameOf(scriptPath: string): string {
  return scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "");
}
