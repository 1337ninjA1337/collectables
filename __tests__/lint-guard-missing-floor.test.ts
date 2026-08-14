/**
 * The three failure codes that are about the LOOKUP, produced by real wrappers.
 *
 * `no_files`, `below_floor`, `unreadable_input` and `empty_input` come from a
 * scratch SCAN ROOT; `invalid_floor` comes from a patched declaration in the
 * shared-copy harness next door. These three come from neither: they fire when
 * a guard asks the table for a floor and the table cannot give it one — no
 * entry under that name, or an entry shaped unlike what the wrapper asked for.
 * A sound table never produces them, and no scan root can.
 *
 * They existed before this harness as bare `Error`s, which is exactly why the
 * harness is worth having. Every wrapper's handler catches `ScannedFloorError`
 * and re-throws anything else, so the three most likely consequences of a
 * RENAME — the check name moved, the shape changed, the entry went away —
 * printed as node stacks naming `scannedFloorFor`, beside ten ways a malformed
 * entry printed as one line naming the guard. The refusal a reader meets after
 * a rename was the one that looked like a crash.
 *
 * Same machinery as `lint-guard-invalid-floor.test.ts`: one copy of `lib/` +
 * `scripts/`, rewritten per case, run against the REAL repository so the tree
 * is full and the lookup is the only thing left that can fail.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  DEFAULT_SCANNED_LABEL,
  formatScannedFloorFailure,
  SHAPE_MISMATCH_REASON,
  type ScannedFloorFailureCode,
} from "../lib/scanned-floor";
import {
  assertNoStackTrace,
  checkNameOf,
  entryPatch,
  makeSharedPatchedRepo,
  PATCHED_REPO_MARKER,
  type GuardRun,
} from "./helpers/guard-fixture";

const REPO_ROOT = path.resolve(__dirname, "..");
const FLOOR_MODULE = "lib/scanned-floor.ts";

const guardFor = (checkName: string) => {
  const guard = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === checkName);
  assert.ok(guard, `${checkName} is not in LINT_GUARDS`);
  return guard;
};

const repo = makeSharedPatchedRepo();
after(() => repo.cleanup());

/**
 * Codes a PURE EVALUATOR returns, each with the harness that produces it.
 *
 * The same bargain `WRAPPER_UNREACHABLE` strikes one file over: a code is
 * excused from this harness only with a written reason, and the reason has to
 * name where it is covered instead. `Extract` rather than a bare string union,
 * so a code cannot be excused under a name the module does not have.
 */
type EvaluatorFailureCode = Extract<
  ScannedFloorFailureCode,
  | "no_files"
  | "below_floor"
  | "invalid_floor"
  | "missing_input"
  | "unreadable_input"
  | "empty_input"
>;

const EVALUATOR_PRODUCED: Record<EvaluatorFailureCode, string> = {
  no_files:
    "returned by evaluateScannedFloor over an empty scan root, which is what __tests__/lint-guard-empty-root.test.ts points every guard at",
  below_floor:
    "returned by evaluateScannedFloor over a root holding part of this repository, built by __tests__/lint-guard-partial-root.test.ts",
  invalid_floor:
    "returned for a declaration rather than a lookup — the entry exists and is malformed, and all ten ways it can be get a wrapper run in __tests__/lint-guard-invalid-floor.test.ts",
  missing_input:
    "returned by evaluateParsedInputs when a wrapper hands over fewer inputs than it declares, which is a wiring bug in the wrapper and is asserted about the pure function in __tests__/scanned-floor.test.ts",
  unreadable_input:
    "returned by evaluateParsedInputs for an input the wrapper could not read, produced against a scratch root by __tests__/lint-guard-empty-input.test.ts",
  empty_input:
    "returned by evaluateParsedInputs for an input that read and parsed to nothing, produced per declared input by __tests__/lint-guard-empty-input.test.ts",
};

/**
 * Every code this harness owns, as a key. A new `ScannedFloorFailureCode`
 * fails to COMPILE until it either gets a case below or is excused above.
 */
type LookupFailureCode = Exclude<ScannedFloorFailureCode, EvaluatorFailureCode>;

type LookupCase = {
  /** The guard whose lookup is broken — and the guard that must refuse. */
  readonly checkName: string;
  /** Rewrites that guard's entry so the lookup it makes cannot be answered. */
  readonly rewrite: (entry: string) => string;
  /** The pass line this guard prints when it gets that far. */
  readonly cleanLine: RegExp;
};

const CASES: Record<LookupFailureCode, LookupCase> = {
  // The rename, which is the failure this code is really about: the entry is
  // still there, still sound, and no longer keyed by the name the wrapper asks
  // under. Renaming the KEY rather than deleting the entry keeps the patch to
  // one token and leaves a table that is otherwise valid.
  no_floor_declared: {
    checkName: "check-inline-hex",
    rewrite: (entry) => entry.replace('"check-inline-hex"', '"check-inline-hex-renamed"'),
    cleanLine: /no inline hex literals/,
  },
  // The half-rename: the entry kept its key and changed shape. `check-inline-hex`
  // walks a tree and asks for a count; an inputs-shaped entry answers a
  // question it did not ask. Both halves of the entry stay valid on their own,
  // so `scannedFloorFor` passes it and `countFloorFor` is what refuses.
  no_count_floor: {
    checkName: "check-inline-hex",
    rewrite: (entry) =>
      entry.replace(/count: \{[^}]*\},/, 'inputs: ["package.json"],'),
    cleanLine: /no inline hex literals/,
  },
  // The mirror image: `check-appstore-config` reads one fixed file and asks for
  // its declared inputs, and a count-shaped entry has none to hand over. The
  // note gains a date in the same patch because a count floor without one is
  // `undated_note` — which would refuse first, on a different code, and this
  // case would silently stop testing the one it names.
  no_inputs_floor: {
    checkName: "check-appstore-config",
    rewrite: (entry) =>
      entry
        .replace(/inputs: \["app\.json"\],/, 'count: { label: "config file", minimum: 1 },')
        .replace(/note: "/, 'note: "measured 2026-08-14. '),
    cleanLine: /iOS block OK|app\.json OK/,
  },
};

/**
 * The line the guard must print, rendered by the module the guard renders it
 * with. Read rather than re-typed: a hand-copied sentence here would drift the
 * first time a message is reworded, and the drift would surface as a failing
 * assertion in a file that has nothing to do with the rewording.
 *
 * Building the failure by hand also pins the fields the lookup fills — a
 * lookup that started inventing a `count` or a `minimum` would render a
 * different sentence than this one for the same code.
 */
const expectedLine = (checkName: string, code: ScannedFloorFailureCode) =>
  formatScannedFloorFailure(checkName, {
    code,
    count: 0,
    minimum: 0,
    label: DEFAULT_SCANNED_LABEL,
  });

const runFor = (code: LookupFailureCode): GuardRun => {
  const lookup = CASES[code];
  return repo.runPatched(
    `lookup-${code}`,
    { [FLOOR_MODULE]: entryPatch(lookup.checkName, lookup.rewrite) },
    guardFor(lookup.checkName),
    REPO_ROOT,
  );
};

describe("a floor a guard cannot look up, through a wrapper", () => {
  for (const code of Object.keys(CASES) as LookupFailureCode[]) {
    const lookup = CASES[code];

    describe(`${code} (${lookup.checkName})`, () => {
      it("refuses instead of running on a premise it never got", () => {
        const { status, output } = runFor(code);
        assert.equal(status, 1, `${lookup.checkName} passed a ${code} lookup:\n${output}`);
      });

      it("ran out of the patched copy, not out of this checkout", () => {
        assert.match(runFor(code).output, new RegExp(PATCHED_REPO_MARKER));
      });

      it("prints the whole refusal this module writes for the code", () => {
        // The regression, stated exactly: before these codes existed the
        // output was a node stack and this assertion had nothing to match.
        const { output } = runFor(code);
        assert.ok(
          output.includes(expectedLine(lookup.checkName, code)),
          `${lookup.checkName} refused without saying what ${code} means:\n${output}`,
        );
        assert.match(output, new RegExp(`^${lookup.checkName}: ERROR — `, "m"));
      });

      it("points the reader at the table rather than at the tree", () => {
        const { output } = runFor(code);
        assert.match(output, /lib\/scanned-floor\.ts/);
        // The walk was fine. Sending the reader to check the scan roots or to
        // re-measure a number would point them at a healthy tree.
        assert.doesNotMatch(output, /Check the scan roots/);
        assert.doesNotMatch(output, /re-measure the floor/);
      });

      it("prints a refusal, not a crash", () => {
        // The failure mode this whole file is about: a bare `Error` reaches
        // the wrapper's handler, is not a ScannedFloorError, and is re-thrown.
        const { output } = runFor(code);
        assert.doesNotMatch(output, /ScannedFloorError:/);
        assert.doesNotMatch(output, /scanned-floor: /);
        assertNoStackTrace(output, `${lookup.checkName} with a ${code} lookup`);
      });

      it("never reports the clean scan it did not establish", () => {
        assert.doesNotMatch(runFor(code).output, lookup.cleanLine);
      });
    });
  }

  it("says a shape mismatch in the same words whichever side asked", () => {
    // The two directions of one disagreement, both through a real wrapper.
    for (const code of ["no_count_floor", "no_inputs_floor"] as const) {
      assert.ok(
        runFor(code).output.includes(SHAPE_MISMATCH_REASON),
        `${code} refused without the shared reason`,
      );
    }
  });

  it("excuses a code only with a reason that names where it IS covered", () => {
    const cased = new Set(Object.keys(CASES));
    for (const [code, reason] of Object.entries(EVALUATOR_PRODUCED)) {
      assert.ok(!cased.has(code), `${code} is excused AND has a case here`);
      const named = reason.match(/__tests__\/[\w.-]+\.ts/g) ?? [];
      assert.ok(named.length > 0, `${code} is excused without naming a harness`);
      for (const file of named) {
        assert.ok(
          fs.existsSync(path.join(REPO_ROOT, file)),
          `${code} is excused by ${file}, which does not exist`,
        );
      }
    }
  });

  it("names a guard the registry actually declares, for every case", () => {
    for (const lookup of Object.values(CASES)) guardFor(lookup.checkName);
  });
});

describe("the same copy, unpatched", () => {
  // Without this, a fixture that failed to run the guard at all would look
  // exactly like a guard refusing for the right reason.
  const control = (checkName: string) =>
    repo.runPatched(
      `missing-floor-control-${checkName}`,
      { [FLOOR_MODULE]: (source) => `// patched-repo control copy\n${source}` },
      guardFor(checkName),
      REPO_ROOT,
    );

  for (const checkName of [...new Set(Object.values(CASES).map((c) => c.checkName))]) {
    it(`${checkName} passes, so its refusals come from the patch and nothing else`, () => {
      const { status, output } = control(checkName);
      assert.equal(status, 0, `${checkName} failed in the control copy:\n${output}`);
    });

    it(`${checkName}'s control run is the copy, not this checkout`, () => {
      assert.match(control(checkName).output, new RegExp(PATCHED_REPO_MARKER));
    });
  }
});
