/**
 * The premise assertion for the whole guard fleet, run ONCE against this
 * checkout rather than restated inside each of the thirteen scripts.
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
 * into lint:all" gap for all thirteen at once: a guard that stops running, or
 * that runs and reports nothing about what it examined, fails here.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "../lib/env-inlining";
import { LINT_GUARDS, type LintGuard } from "../lib/lint-guards";
import { SCANNED_FLOORS, scannedFloorFor } from "../lib/scanned-floor";
import { checkNameOf, runGuardWith } from "./helpers/guard-fixture";

import { suiteCode, topLevelSuites } from "./helpers/suite-files";

/**
 * The spawn shape no suite may carry, assembled from two halves.
 *
 * Written as one literal it matches ITSELF — the pattern is source text in a
 * file the scan reads — and the drift guard would report this file forever
 * while saying nothing about any other. The halves sit on separate lines and
 * the pattern forbids a newline between them, so the definition cannot be its
 * own first offender.
 */
const BIN_DIR = ".bin";
const LOADER_PACKAGE = "tsx";
const TSX_BIN_SPAWN = new RegExp(`\\${BIN_DIR}\\b[^\\n]{0,24}${LOADER_PACKAGE}`);

/**
 * A guard, run against this checkout and memoised — one spawn per registry
 * entry is enough for one file, however many assertions read it.
 *
 * Through the shared helper rather than a private `execFileSync`, and the
 * three differences it brings are each a failure this file could otherwise
 * produce. It spawns `node --import tsx`, not the `tsx` BIN: that bin is a
 * wrapper around its own node child, so a timeout on it cannot end the run —
 * the shape that hung CI's "Run tests" step past 25 minutes. It bounds the run
 * and the buffer, so a stalled guard or an overlong report is a stated failure
 * rather than silence. And it resolves the loader BEFORE spawning, so a
 * checkout with no install is diagnosed by name — without that, every guard
 * here fails with a bare `1 !== 0` and an empty output to explain it, which is
 * exactly what a guard genuinely refusing looks like.
 */
function runGuard(guard: LintGuard) {
  const { output, status } = runGuardWith(guard);
  return { stdout: output, status };
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
        const run = runGuard(guard);
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
        assert.match(runGuard(guard).stdout, new RegExp(`^${checkName}:`));
      });

      if (floor?.count) {
        it(`names a count at or above its committed floor of ${floor.count.minimum}`, () => {
          const { stdout } = runGuard(guard);
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
          const { stdout } = runGuard(guard);
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
          const { stdout } = runGuard(guard);
          assert.ok(
            numbersIn(stdout).some((n) => n > 0),
            `${guard.npmScript} reports no non-zero count:\n${stdout}`,
          );
        });
      }
    });
  }

  it("spawns no guard through the `tsx` bin, in this file or any sibling suite", () => {
    // The drift guard for the migration this file just made, applied to every
    // suite rather than to the one that happened to be last. `node_modules/
    // .bin/tsx` is a WRAPPER that spawns its own node child and hands it the
    // parent's stdout pipe, so a timeout on it cannot end the run: killing the
    // wrapper leaves the grandchild holding the write end and the read never
    // sees EOF. That is the shape that sat in CI's "Run tests" step past 25
    // minutes on a suite that takes seconds locally, and it came back once
    // already — in a file whose siblings had been fixed a day earlier — because
    // nothing said it must not. Comments are stripped first: two files explain
    // this in prose and must stay able to.
    const offenders = topLevelSuites().filter((entry) =>
      TSX_BIN_SPAWN.test(suiteCode(entry)),
    );
    assert.deepEqual(
      offenders,
      [],
      `these suites spawn the tsx bin instead of \`node --import tsx\` through helpers/guard-fixture.ts: ${offenders.join(", ")}`,
    );
  });

  it("recognises the spawn it forbids, so the sweep above is not vacuous", () => {
    // The sweep reports nothing today, and a pattern that matched nothing at
    // all would report nothing forever. These are the two ways the bin has
    // actually been written in this repository — a joined path and a
    // `path.join` argument list — plus the one it must not confuse for either.
    const bin = BIN_DIR;
    const loader = LOADER_PACKAGE;
    for (const forbidden of [
      `execFileSync(path.join(REPO_ROOT, "node_modules", "${bin}", "${loader}"), args)`,
      `spawnSync("node_modules/${bin}/${loader}", [script])`,
    ]) {
      assert.ok(
        TSX_BIN_SPAWN.test(forbidden),
        `the sweep would not have caught: ${forbidden}`,
      );
    }
    assert.ok(
      !TSX_BIN_SPAWN.test(`const TSC = path.join(root, "node_modules", "${bin}", "tsc");`),
      "the sweep refuses a bin that is not the loader — every suite spawning tsc would fail for a reason that is not theirs",
    );
  });

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
