/**
 * The failing case, for every guard in the fleet.
 *
 * `__tests__/lint-guard-premise.test.ts` runs all twelve guards against this
 * checkout and reads twelve green results — which proves they REPORT, not that
 * they REFUSE. Every floor in `SCANNED_FLOORS` was mutation-checked by hand,
 * locally, by editing a script and reverting it: a verification that leaves no
 * artifact is a verification that quietly stops being true.
 *
 * This file runs the same twelve against an empty directory under
 * `os.tmpdir()` via the shared `LINT_GUARD_REPO_ROOT` override, and asserts
 * each one exits 1 with its own one-line refusal. Every floor gets a red run,
 * in CI, on every push.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GUARD_ROOT_ENV } from "../lib/guard-root";
import { LINT_GUARDS } from "../lib/lint-guards";

const REPO_ROOT = path.resolve(__dirname, "..");
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** The check name a guard prints, derived from the path the registry pins. */
const checkNameOf = (scriptPath: string) =>
  scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "");

/**
 * One empty directory, shared by all twelve: it is the whole fixture. Nothing
 * writes to it — a guard that did would be the finding.
 */
const EMPTY_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lint-guard-empty-"));

after(() => {
  fs.rmSync(EMPTY_ROOT, { recursive: true, force: true });
});

type GuardRun = { readonly output: string; readonly status: number };

const runs = new Map<string, GuardRun>();

function runGuard(
  scriptPath: string,
  args: readonly string[],
  env: Record<string, string>,
): GuardRun {
  const key = [scriptPath, ...args, JSON.stringify(env)].join(" ");
  const cached = runs.get(key);
  if (cached) return cached;
  let output = "";
  let status = 0;
  try {
    output = execFileSync(TSX, [path.join(REPO_ROOT, scriptPath), ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
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

const againstEmptyRoot = (guard: (typeof LINT_GUARDS)[number]): GuardRun =>
  runGuard(guard.scriptPath, guard.args, { [GUARD_ROOT_ENV]: EMPTY_ROOT });

describe("every guard refuses an empty scan root", () => {
  for (const guard of LINT_GUARDS) {
    const checkName = checkNameOf(guard.scriptPath);

    describe(guard.npmScript, () => {
      it("exits 1 instead of passing over nothing", () => {
        const run = againstEmptyRoot(guard);
        assert.equal(
          run.status,
          1,
          `${guard.npmScript} exited ${run.status} against an empty directory — a pass over nothing is the failure this floor exists for:\n${run.output}`,
        );
      });

      it("says which guard refused, and why, in its own words", () => {
        const { output } = againstEmptyRoot(guard);
        assert.match(
          output,
          new RegExp(`${checkName}: ERROR — `),
          `${guard.npmScript} failed without a one-line refusal naming itself:\n${output}`,
        );
      });

      it("prints no stack trace — a premise failure is a result, not a crash", () => {
        // An uncaught ENOENT from readdirSync also exits 1, so the exit code
        // alone cannot tell "refused" from "crashed".
        const { output } = againstEmptyRoot(guard);
        assert.doesNotMatch(
          output,
          /^\s+at .+:\d+:\d+\)?$/m,
          `${guard.npmScript} crashed rather than refusing:\n${output}`,
        );
      });

      it("announces that it was looking somewhere else", () => {
        const { output } = againstEmptyRoot(guard);
        assert.ok(
          output.includes(GUARD_ROOT_ENV) && output.includes(EMPTY_ROOT),
          `${guard.npmScript} was redirected and never said so — a green line from a redirected root would be indistinguishable from a real one:\n${output}`,
        );
      });
    });
  }

  it("leaves the empty root empty — a guard may read, never write", () => {
    for (const guard of LINT_GUARDS) againstEmptyRoot(guard);
    assert.deepEqual(fs.readdirSync(EMPTY_ROOT), []);
  });

  it("covers the whole registry, so this file cannot silently run zero", () => {
    assert.ok(
      LINT_GUARDS.length >= 12,
      `only ${LINT_GUARDS.length} guards in the registry`,
    );
  });
});

describe("the override itself", () => {
  const guard = LINT_GUARDS[0];

  it("is off by default — an ordinary run announces nothing", () => {
    const run = runGuard(guard.scriptPath, guard.args, {});
    assert.equal(run.status, 0, run.output);
    assert.doesNotMatch(
      run.output,
      new RegExp(GUARD_ROOT_ENV),
      "a guard that was not redirected must not talk about the override",
    );
  });

  it("refuses a relative root with one line rather than resolving it against cwd", () => {
    const run = runGuard(guard.scriptPath, guard.args, {
      [GUARD_ROOT_ENV]: "some/relative/path",
    });
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /is not an absolute path/);
    assert.doesNotMatch(run.output, /^\s+at .+:\d+:\d+\)?$/m);
  });

  it("is unset by a blank value, not pointed at the current directory", () => {
    const run = runGuard(guard.scriptPath, guard.args, {
      [GUARD_ROOT_ENV]: "",
    });
    assert.equal(run.status, 0, run.output);
  });
});

describe("the wrappers all resolve their root the same way", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  for (const guard of LINT_GUARDS) {
    it(`${guard.scriptPath} takes its root from the shared resolver`, () => {
      const source = read(guard.scriptPath);
      assert.match(
        source,
        /guardScanRoot\(CHECK_NAME|resolveGuardRoot\(/,
        `${guard.scriptPath} must resolve its scan root through lib/guard-root.ts, or the override skips it and its floor is never exercised`,
      );
    });

    it(`${guard.scriptPath} walks the resolved root, not __dirname`, () => {
      // `path.join(__dirname, "..")` may appear ONCE, as the default handed to
      // the resolver — a second bare use is a walk the override cannot move.
      const uses = read(guard.scriptPath).match(
        /path\.join\(__dirname, "\.\."\)/g,
      );
      assert.ok(
        uses !== null && uses.length === 1,
        `${guard.scriptPath} builds ${uses?.length ?? 0} paths straight from __dirname; exactly one (the resolver's default) is allowed`,
      );
    });
  }
});
