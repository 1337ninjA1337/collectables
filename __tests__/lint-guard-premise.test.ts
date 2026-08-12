/**
 * The premise assertion for the whole guard fleet, run ONCE against this
 * checkout rather than restated inside each of the twelve scripts.
 *
 * `lib/scanned-floor.ts` gives every guard a committed floor, and
 * `__tests__/scanned-floor.test.ts` proves the helper is right and that each
 * wrapper contains the call. Neither of those runs a guard. This file does:
 * it executes every `LINT_GUARDS` entry the way `lint:all` does and reads
 * what came back, so the chain the floor is supposed to protect —
 * guard runs → walks a real tree → reports a real count — is asserted end to
 * end instead of inferred from source text.
 *
 * That also closes the standing "nothing asserts the guard is still wired
 * into lint:all" gap for all twelve at once: a guard that stops running, or
 * that runs and reports nothing about what it examined, fails here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS, scannedFloorFor } from "../lib/scanned-floor";

const REPO_ROOT = path.resolve(__dirname, "..");
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** The check name a guard prints, derived from the path the registry pins. */
const checkNameOf = (scriptPath: string) =>
  scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "");

type GuardRun = { readonly stdout: string; readonly status: number };

const runs = new Map<string, GuardRun>();

/** Run a guard once and memoise it — twelve tsx spawns is enough for one file. */
function runGuard(scriptPath: string, args: readonly string[]): GuardRun {
  const key = [scriptPath, ...args].join(" ");
  const cached = runs.get(key);
  if (cached) return cached;
  let stdout = "";
  let status = 0;
  try {
    stdout = execFileSync(TSX, [path.join(REPO_ROOT, scriptPath), ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? 1;
    stdout = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  const run = { stdout, status };
  runs.set(key, run);
  return run;
}

/** Every integer the guard's report names, in order. */
const numbersIn = (text: string): number[] =>
  [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));

describe("every guard reports what it examined", () => {
  for (const guard of LINT_GUARDS) {
    const checkName = checkNameOf(guard.scriptPath);
    const floor = SCANNED_FLOORS[checkName];

    describe(guard.npmScript, () => {
      it("runs and exits 0 against this checkout", () => {
        const run = runGuard(guard.scriptPath, guard.args);
        assert.equal(
          run.status,
          0,
          `${guard.npmScript} failed against a tree that lint:all passes:\n${run.stdout}`,
        );
        assert.ok(
          run.stdout.trim().length > 0,
          `${guard.npmScript} passed silently — a guard that says nothing cannot be audited`,
        );
      });

      it("prefixes its report with the name its floor is keyed by", () => {
        // The floor lookup and the log line have to agree, or a failure
        // points the reader at a key that does not exist.
        assert.match(runGuard(guard.scriptPath, guard.args).stdout, new RegExp(`^${checkName}:`));
      });

      if (floor?.count) {
        it(`names a count at or above its committed floor of ${floor.count.minimum}`, () => {
          const { stdout } = runGuard(guard.scriptPath, guard.args);
          const counts = numbersIn(stdout);
          assert.ok(
            counts.length > 0,
            `${guard.npmScript} reports no number at all — "checked and found nothing" and "did not check" read identically:\n${stdout}`,
          );
          assert.ok(
            counts.some((n) => n >= floor.count!.minimum),
            `${guard.npmScript} names no count at or above ${floor.count!.minimum} (${floor.count!.label}s):\n${stdout}`,
          );
        });
      }

      if (floor?.inputs) {
        it("names every input it declares", () => {
          const { stdout } = runGuard(guard.scriptPath, guard.args);
          for (const input of floor.inputs!) {
            const basename = input.split("/").pop()!;
            assert.ok(
              stdout.includes(basename),
              `${guard.npmScript} declares "${input}" but its report never mentions it:\n${stdout}`,
            );
          }
        });
      }

      if (floor?.delegatedTo) {
        it("still names a non-zero count, even though its premise lives elsewhere", () => {
          // The delegation is about WHERE the refusal is implemented, not
          // about whether this guard has to say what it looked at.
          const { stdout } = runGuard(guard.scriptPath, guard.args);
          assert.ok(
            numbersIn(stdout).some((n) => n > 0),
            `${guard.npmScript} reports no non-zero count:\n${stdout}`,
          );
        });
      }
    });
  }

  it("covers every registry guard — the loop above cannot silently run zero", () => {
    // Same premise, applied to this test: a registry that failed to load
    // would produce a file full of passing nothing.
    assert.ok(LINT_GUARDS.length >= 12, `only ${LINT_GUARDS.length} guards in the registry`);
    for (const guard of LINT_GUARDS) {
      assert.doesNotThrow(
        () => scannedFloorFor(checkNameOf(guard.scriptPath)),
        `${guard.npmScript} has no floor entry`,
      );
    }
  });
});
