/**
 * The sixth failure code, produced by a real wrapper — and every way an entry
 * can earn it.
 *
 * `no_files`, `below_floor`, `unreadable_input` and `empty_input` each get a
 * red run from a scratch SCAN ROOT (the empty-root, partial-root and
 * empty-input harnesses). `invalid_floor` cannot come from a scan root at all:
 * it is not a finding about the tree, it is a finding about the guard's own
 * entry in `SCANNED_FLOORS`. Point a guard at any directory you like and a
 * sound table stays sound.
 *
 * So this harness moves the other half. `makeSharedPatchedRepo` copies `lib/`
 * and `scripts/` into a scratch root ONCE; each case rewrites one entry of the
 * table in that copy, runs the copied wrapper against the REAL repository, and
 * puts the pristine bytes back. The scan root is a tree where every walk is
 * full and every input reads fine, so the broken declaration is the only thing
 * left that can fail.
 *
 * `validateScannedFloorEntry` reports TEN ways an entry can be unusable and
 * every one of them gets a run here, keyed by `ScannedFloorProblemCode` so a
 * new code cannot ship without one. Two of them had a wrapper run before this
 * file's second pass; the other eight were proven about the pure function and
 * never about a guard, which is exactly the state `invalid_floor` itself was
 * in before the first pass.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  describeScannedFloorProblem,
  scannedFloorProblemDetail,
  SCANNED_FLOORS_ENTRY_SUBJECT,
  type ScannedFloorProblemCode,
} from "../lib/scanned-floor";
import {
  assertNoStackTrace,
  checkNameOf,
  entryPatch,
  makeSharedPatchedRepo,
  PATCHED_REPO_MARKER,
  runGuardWith,
  type GuardRun,
} from "./helpers/guard-fixture";

import { REPO_ROOT } from "./helpers/repo-file";

const FLOOR_MODULE = "lib/scanned-floor.ts";

const guardFor = (checkName: string) => {
  const guard = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === checkName);
  assert.ok(guard, `${checkName} is not in LINT_GUARDS`);
  return guard;
};

/**
 * One copy of `lib/` + `scripts/` for the whole file, patched per case.
 *
 * Each copy is ~200 files, so a copy per case would have this file paying
 * fourteen recursive copies to assert ten one-line declarations. `runPatched`
 * writes the patch, spawns, and restores, which makes a case two writes.
 */
const repo = makeSharedPatchedRepo();
after(() => repo.cleanup());

/**
 * A wrapper run whose only reason to fail is the problem the patch introduces.
 *
 * Each rewrite introduces EXACTLY ONE problem: `validateScannedFloorEntry`
 * returns them in declaration order and `scannedFloorFor` raises the first, so
 * a rewrite that tripped two codes would assert about whichever the validator
 * happens to reach first and would silently stop testing the other when that
 * order changes.
 */
type ProblemCase = {
  /** The guard whose entry is broken — and the guard that must refuse. */
  readonly checkName: string;
  readonly rewrite: (entry: string) => string;
  /** Codes the rewrite must NOT also trip, where confusion is plausible. */
  readonly notAlso?: readonly RegExp[];
};

const CASES: Record<ProblemCodeKey, ProblemCase> = {
  // A count floor of 0 waves an empty walk through while making the hole look
  // covered — the reason this is a floor rather than a `count > 0`.
  invalid_minimum: {
    checkName: "check-inline-hex",
    rewrite: (entry) => entry.replace(/minimum: 160/, "minimum: 0"),
  },
  // The label is the noun the failure line uses ("scanned 3 source file(s)");
  // without it the refusal names no unit for what it counted.
  empty_label: {
    checkName: "check-inline-hex",
    rewrite: (entry) => entry.replace(/label: "source file"/, 'label: ""'),
  },
  // An entry that declares nothing is the exact hole the table exists to
  // close: a guard nobody has to think about, listed as though covered.
  no_shape: {
    checkName: "check-appstore-config",
    rewrite: (entry) => entry.replace(/\n\s*inputs: \[[^\]]*\],/, ""),
  },
  // An empty list makes the inputs assertion pass without reading anything.
  empty_inputs: {
    checkName: "check-appstore-config",
    rewrite: (entry) => entry.replace(/inputs: \[[^\]]*\]/, "inputs: []"),
    // The codes for a real file going wrong; this run has no file to blame.
    notAlso: [/was never handed to the floor check/, /is empty — it was read/],
  },
  // A name no wrapper can hand over and no message can name.
  blank_input: {
    checkName: "check-appstore-config",
    rewrite: (entry) => entry.replace(/inputs: \[[^\]]*\]/, 'inputs: [" "]'),
  },
  // The second copy is never reached, so a wrapper could drop it unnoticed —
  // which is precisely what the per-input empty-input fixtures exist to catch
  // one level down.
  duplicate_input: {
    checkName: "check-sentry-version",
    rewrite: (entry) => entry.replace(/inputs: \["([^"]+)"/, 'inputs: ["$1", "$1"'),
  },
  // Two places claiming one premise, which is the shape that produces a guard
  // everybody believes is covered and nobody owns.
  delegation_with_shape: {
    checkName: "check-appstore-config",
    rewrite: (entry) =>
      entry.replace(/inputs: /, 'delegatedTo: "somewhere else",\n    inputs: '),
  },
  // Delegation with no destination is indistinguishable from opting out. Note
  // the guard: it is NOT the delegated one. `check-privacy-baseline-provenance`
  // is the only entry that really delegates, and its wrapper never reads the
  // table — delegation means the premise is asserted elsewhere — so no run of
  // it can produce this. The code is reachable only through a guard that does
  // read its entry, which is what makes it worth a wrapper run at all.
  empty_delegation: {
    checkName: "check-appstore-config",
    rewrite: (entry) =>
      entry.replace(/inputs: \[[^\]]*\],/, 'delegatedTo: " ",'),
  },
  // A shape is a decision; a decision with no recorded reason is a number
  // nobody can re-measure.
  empty_note: {
    checkName: "check-analytics-imports",
    rewrite: (entry) => entry.replace(/note: "[\s\S]*"/, 'note: ""'),
  },
  // An undated measurement is a magic constant with prose around it: the tree
  // grows out from under it and the note still reads as true.
  undated_note: {
    checkName: "check-analytics-imports",
    rewrite: (entry) => entry.replace(/\d{4}-\d{2}-\d{2}/g, "some point"),
  },
};

/**
 * Problem codes no wrapper run can produce, each with the reason written down.
 *
 * `Extract` rather than a bare string union, so a code cannot be excused under
 * a name the module does not have. The value is the argument, and it has to be
 * an argument about REACHABILITY — "hard to set up" is not one.
 */
type WrapperUnreachableCode = Extract<ScannedFloorProblemCode, "empty_check_name">;

const WRAPPER_UNREACHABLE: Record<WrapperUnreachableCode, string> = {
  empty_check_name:
    "a wrapper asks for its floor under a string literal in its own source, so it can only ever reach the entry it is named after; a blank KEY is not a row any guard can request, and the pass that finds it is validateScannedFloors over the whole table",
};

/**
 * Every `ScannedFloorProblemCode` that a wrapper CAN produce, as a key.
 * Written as a mapped type rather than a hand-kept list so a new code fails to
 * compile until it has a case — the same trick `PROBLEM_DETAIL` uses one file
 * over. The only escape is `WRAPPER_UNREACHABLE`, which costs a written reason.
 */
type ProblemCodeKey = Exclude<ScannedFloorProblemCode, WrapperUnreachableCode>;

const runFor = (code: ProblemCodeKey): GuardRun => {
  const problem = CASES[code];
  return repo.runPatched(
    `problem-${code}`,
    { [FLOOR_MODULE]: entryPatch(problem.checkName, problem.rewrite) },
    guardFor(problem.checkName),
    REPO_ROOT,
  );
};

describe("every way a SCANNED_FLOORS entry can be unusable, through a wrapper", () => {
  for (const code of Object.keys(CASES) as ProblemCodeKey[]) {
    const problem = CASES[code];

    describe(`${code} (${problem.checkName})`, () => {
      it("refuses instead of running on a premise it cannot trust", () => {
        const { status, output } = runFor(code);
        assert.equal(
          status,
          1,
          `${problem.checkName} passed with a ${code} entry:\n${output}`,
        );
      });

      it("ran out of the patched copy, not out of this checkout", () => {
        // Exit 1 alone does not establish that: a guard resolved against the
        // real repository would have to fail for some OTHER reason to look
        // like this, and the marker is a line the real repository cannot
        // print.
        assert.match(runFor(code).output, new RegExp(PATCHED_REPO_MARKER));
      });

      it("names itself and says the declaration is the bug, not the tree", () => {
        const { output } = runFor(code);
        assert.match(output, new RegExp(`^${problem.checkName}: ERROR — `, "m"));
        // The whole sentence — subject and clause — read out of the module
        // rather than re-typed. The subject is the load-bearing half here: it
        // is what says the DECLARATION is the bug rather than the tree, and
        // asserting `/SCANNED_FLOORS entry/` beside a separate clause match
        // would keep passing if the two ever stopped being one sentence.
        assert.ok(
          output.includes(
            describeScannedFloorProblem(SCANNED_FLOORS_ENTRY_SUBJECT, code),
          ),
          `${problem.checkName} refused without saying what ${code} means:\n${output}`,
        );
        // And the clause on its own, so a subject that swallowed the sentence
        // could not satisfy the assertion above by itself.
        assert.ok(output.includes(scannedFloorProblemDetail(code)));
      });

      it("points the reader at the file the declaration lives in", () => {
        assert.match(runFor(code).output, /lib\/scanned-floor\.ts/);
      });

      it("does not blame the scan roots — the walk was fine", () => {
        // no_files sends the reader to check the scan roots. Reusing that line
        // here would send them to look for a broken walk that does not exist.
        assert.doesNotMatch(runFor(code).output, /Check the scan roots/);
      });

      it("prints a refusal, not a crash", () => {
        const { output } = runFor(code);
        assert.doesNotMatch(output, /ScannedFloorError:/);
        assertNoStackTrace(output, `${problem.checkName} with a ${code} entry`);
      });

      it("never reports the clean scan it did not establish", () => {
        // The failure has to beat the report, or the guard says "no inline hex
        // literals" over a premise it never checked.
        const { output } = runFor(code);
        assert.doesNotMatch(output, /no inline hex literals/);
        assert.doesNotMatch(output, /iOS block OK/);
        for (const other of problem.notAlso ?? []) {
          assert.doesNotMatch(output, other);
        }
      });
    });
  }

  it("names a guard the registry actually declares, for every case", () => {
    // A case pointed at a check name that is not in LINT_GUARDS would fail in
    // `guardFor`, but only when its own describe block runs; this states the
    // whole file's premise in one place.
    for (const problem of Object.values(CASES)) guardFor(problem.checkName);
  });

  it("excuses a code only with a reason, and never one it also runs", () => {
    // The exclusion is a compile-time hole in an otherwise exhaustive record,
    // so the thing left to state at runtime is that the hole was paid for: an
    // excused code carries an argument, and it is not quietly listed on both
    // sides where the exhaustiveness check would stop noticing it.
    const cased = new Set(Object.keys(CASES));
    for (const [code, reason] of Object.entries(WRAPPER_UNREACHABLE)) {
      assert.ok(reason.trim().length > 0, `${code} is excused with no reason`);
      assert.ok(!cased.has(code), `${code} is excused AND has a wrapper case`);
    }
  });
});

describe("the same copy, unpatched", () => {
  // The negative control: without it, a fixture that failed to run the guard
  // at all (a bad path, a missing dependency in the copy) would look exactly
  // like a guard refusing for the right reason.
  const control = (checkName: string) =>
    repo.runPatched(
      `control-${checkName}`,
      {
        // A comment is the smallest change that proves the copy is a real,
        // runnable checkout without altering a single declaration in it.
        [FLOOR_MODULE]: (source) => `// patched-repo control copy\n${source}`,
      },
      guardFor(checkName),
      REPO_ROOT,
    );

  const patchedGuards = [...new Set(Object.values(CASES).map((c) => c.checkName))];

  for (const checkName of patchedGuards) {
    it(`${checkName} passes, so its refusals come from the patch and nothing else`, () => {
      const { status, output } = control(checkName);
      assert.equal(status, 0, `${checkName} failed in the control copy:\n${output}`);
    });

    it(`${checkName}'s control run is the copy, not this checkout`, () => {
      // The control's whole job is provenance, and exit 0 is exactly what the
      // real checkout gives too — so without the marker a bug that resolved
      // the script path against REPO_ROOT would pass this describe block while
      // making every patched case above meaningless.
      assert.match(control(checkName).output, new RegExp(PATCHED_REPO_MARKER));
    });
  }
});

describe("the run memo keeps the cases apart", () => {
  // Every case above shares one scriptRoot and differs only in the bytes at
  // it, so `label` is the entire separation. If it dropped out of the key the
  // second case would be served the first's result — a CACHE HIT, not an
  // error, which is the kind of wrong that never announces itself.
  it("gives two patches of the same file to the same guard two answers", () => {
    const broken = runFor("invalid_minimum");
    const sound = repo.runPatched(
      "memo-sound-floor",
      { [FLOOR_MODULE]: (source) => `// memo separation control\n${source}` },
      guardFor("check-inline-hex"),
      REPO_ROOT,
    );
    assert.equal(broken.status, 1);
    assert.equal(sound.status, 0, sound.output);
  });

  it("keeps a run from the copy apart from the same run out of this checkout", () => {
    // The other half of the key. `scriptRoot` is what makes a patched wrapper
    // a different program from the committed one; without it in the key, a
    // green run of the real guard would certify a patch that never executed.
    const guard = guardFor("check-inline-hex");
    assert.equal(runFor("invalid_minimum").status, 1);
    const committed = runGuardWith(guard, { scanRoot: REPO_ROOT });
    assert.equal(committed.status, 0, committed.output);
    assert.doesNotMatch(
      committed.output,
      new RegExp(PATCHED_REPO_MARKER),
      "the committed guard must not be answered out of the patched copy's cache",
    );
  });

  it("restores the copy after every case, so a patch cannot leak forwards", () => {
    // Only meaningful because a broken run of this same guard ran first: the
    // patch above has to have been written back for this to be green.
    assert.equal(runFor("empty_inputs").status, 1);
    const sound = repo.runPatched(
      "leak-check-sound",
      { [FLOOR_MODULE]: (source) => `// leak check\n${source}` },
      guardFor("check-appstore-config"),
      REPO_ROOT,
    );
    assert.equal(sound.status, 0, sound.output);
  });
});
