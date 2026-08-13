/**
 * The sixth failure code, produced by a real wrapper.
 *
 * `no_files`, `below_floor`, `unreadable_input` and `empty_input` each get a
 * red run from a scratch SCAN ROOT (the empty-root, partial-root and
 * empty-input harnesses). `invalid_floor` cannot come from a scan root at all:
 * it is not a finding about the tree, it is a finding about the guard's own
 * entry in `SCANNED_FLOORS`. Point a guard at any directory you like and a
 * sound table stays sound.
 *
 * So this harness moves the other half. `makeSharedPatchedRepo` copies `lib/`
 * and `scripts/` into a scratch root ONCE; each case rewrites the table in
 * that copy, runs the copied wrapper against the REAL repository, and puts the
 * pristine bytes back. The scan root is a tree where every walk is full and
 * every input reads fine, so the broken declaration is the only thing left
 * that can fail.
 *
 * What that buys, concretely: the refusal is one line naming the guard, it
 * exits 1, and it carries no stack trace. Before this file, a floor of 0 was
 * caught by an assertion in `scanned-floor.test.ts` that never ran a guard,
 * and nothing at all established that a guard reaching a bogus floor REFUSES
 * rather than passing over the empty walk the floor was supposed to catch.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  assertNoStackTrace,
  checkNameOf,
  makeSharedPatchedRepo,
  PATCHED_REPO_MARKER,
  runGuardWith,
  type RepoPatches,
} from "./helpers/guard-fixture";

const REPO_ROOT = path.resolve(__dirname, "..");
const FLOOR_MODULE = "lib/scanned-floor.ts";

const guardFor = (checkName: string) => {
  const guard = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === checkName);
  assert.ok(guard, `${checkName} is not in LINT_GUARDS`);
  return guard;
};

/**
 * One copy of `lib/` + `scripts/` for the whole file, patched per case.
 *
 * Each copy is ~200 files. `SCANNED_FLOORS` reports ten problem codes and this
 * file runs two of them today, so a copy per case would have the harness
 * paying ten recursive copies to assert ten one-line declarations.
 */
const repo = makeSharedPatchedRepo();
after(() => repo.cleanup());

/**
 * A run of `checkName` against this repository, out of a copy in which the
 * table's `from` declaration has been swapped for `to`.
 *
 * Both strings are whole declarations, so a formatting change in
 * `lib/scanned-floor.ts` fails the fixture loudly (`runPatched` refuses a
 * no-op patch) rather than silently running an unpatched guard. `label` is
 * what keeps the run memo from answering one case with another's result — the
 * scriptRoot is the same directory for every case here, and the bytes in it
 * are not.
 */
function patchedRun(label: string, from: string, to: string, checkName: string) {
  const patches: RepoPatches = {
    [FLOOR_MODULE]: (source) => {
      assert.ok(
        source.includes(from),
        `the anchor ${JSON.stringify(from)} is no longer in ${FLOOR_MODULE}`,
      );
      return source.replace(from, to);
    },
  };
  const guard = guardFor(checkName);
  return () => repo.runPatched(label, patches, guard, REPO_ROOT);
}

describe("a count-shaped guard whose floor is not a positive integer", () => {
  // check-inline-hex walks app/ + components/ + lib/ and floors at 160.
  const run = patchedRun(
    "inline-hex-zero-floor",
    'count: { label: "source file", minimum: 160 }',
    'count: { label: "source file", minimum: 0 }',
    "check-inline-hex",
  );

  it("refuses instead of passing over the walk the floor was meant to defend", () => {
    // The scan root is this repository, so the walk finds its usual ~213
    // files. A floor of 0 would wave that through — and would wave through
    // zero files just as happily, which is the whole point.
    assert.equal(run().status, 1);
  });

  it("ran out of the patched copy, not out of this checkout", () => {
    // Exit 1 alone does not establish that: a guard resolved against the real
    // repository would have to fail for some OTHER reason to look like this,
    // and the marker is a line the real repository cannot print.
    assert.match(run().output, new RegExp(PATCHED_REPO_MARKER));
  });

  it("names itself and says the declaration is the bug, not the tree", () => {
    const { output } = run();
    assert.match(output, /^check-inline-hex: ERROR — /m);
    assert.match(output, /SCANNED_FLOORS entry/);
    assert.match(output, /not a positive integer/);
  });

  it("points the reader at the file the number lives in", () => {
    assert.match(run().output, /lib\/scanned-floor\.ts/);
  });

  it("does not blame the scan roots — the walk was fine", () => {
    // no_files sends the reader to check the scan roots. Reusing that line
    // here would send them to look for a broken walk that does not exist.
    assert.doesNotMatch(run().output, /Check the scan roots/);
  });

  it("prints a refusal, not a crash", () => {
    const { output } = run();
    assert.doesNotMatch(output, /ScannedFloorError:/);
    assertNoStackTrace(output, "check-inline-hex with a floor of 0");
  });

  it("never reports a clean scan", () => {
    // The failure has to beat the report, or the guard says "no inline hex
    // literals" over a premise it never established.
    assert.doesNotMatch(run().output, /no inline hex literals/);
  });
});

describe("an inputs-shaped guard that declares no inputs", () => {
  // check-appstore-config has no count at all; an empty list is the only way
  // its half of the table can be bogus.
  const run = patchedRun(
    "appstore-config-no-inputs",
    'inputs: ["app.json"],',
    "inputs: [],",
    "check-appstore-config",
  );

  it("refuses rather than asserting nothing about the file it reads", () => {
    assert.equal(run().status, 1);
  });

  it("ran out of the patched copy, not out of this checkout", () => {
    assert.match(run().output, new RegExp(PATCHED_REPO_MARKER));
  });

  it("says the input list is empty, not that an input was missing", () => {
    const { output } = run();
    assert.match(output, /^check-appstore-config: ERROR — /m);
    assert.match(output, /declares an empty input list/);
    // missing_input and empty_input are the codes for a real file going
    // wrong; this run has no file to blame.
    assert.doesNotMatch(output, /was never handed to the floor check/);
    assert.doesNotMatch(output, /is empty — it was read/);
  });

  it("prints a refusal, not a crash", () => {
    assertNoStackTrace(run().output, "check-appstore-config with no inputs");
  });
});

describe("the same copy, unpatched", () => {
  // The negative control: without it, a fixture that failed to run the guard
  // at all (a bad path, a missing dependency in the copy) would look exactly
  // like a guard refusing for the right reason.
  const control = (checkName: string) =>
    patchedRun(
      `control-${checkName}`,
      // A comment is the smallest change that proves the copy is a real,
      // runnable checkout without altering a single declaration in it.
      "export const SCANNED_FLOORS",
      "// patched-repo control copy\nexport const SCANNED_FLOORS",
      checkName,
    )();

  for (const checkName of ["check-inline-hex", "check-appstore-config"]) {
    it(`${checkName} passes, so the refusals above come from the patch and nothing else`, () => {
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
    const guard = guardFor("check-inline-hex");
    const broken = repo.runPatched(
      "memo-broken-floor",
      {
        [FLOOR_MODULE]: (source) =>
          source.replace(
            'count: { label: "source file", minimum: 160 }',
            'count: { label: "source file", minimum: 0 }',
          ),
      },
      guard,
      REPO_ROOT,
    );
    const sound = repo.runPatched(
      "memo-sound-floor",
      {
        [FLOOR_MODULE]: (source) =>
          `// memo separation control\n${source}`,
      },
      guard,
      REPO_ROOT,
    );
    assert.equal(broken.status, 1);
    assert.equal(sound.status, 0, sound.output);
  });

  it("keeps a run from the copy apart from the same run out of this checkout", () => {
    // The other half of the key. `scriptRoot` is what makes a patched wrapper
    // a different program from the committed one; without it in the key, the
    // control below would be answered with the broken run's cached refusal —
    // and, worse, the reverse: a green run of the real guard would certify a
    // patch that never executed.
    const guard = guardFor("check-inline-hex");
    const broken = repo.runPatched(
      "memo-scriptroot-broken",
      {
        [FLOOR_MODULE]: (source) =>
          source.replace(
            'count: { label: "source file", minimum: 160 }',
            'count: { label: "source file", minimum: 0 }',
          ),
      },
      guard,
      REPO_ROOT,
    );
    const committed = runGuardWith(guard, { scanRoot: REPO_ROOT });
    assert.equal(broken.status, 1);
    assert.equal(committed.status, 0, committed.output);
    assert.doesNotMatch(
      committed.output,
      new RegExp(PATCHED_REPO_MARKER),
      "the committed guard must not be answered out of the patched copy's cache",
    );
  });

  it("restores the copy after every case, so a patch cannot leak forwards", () => {
    // The sound run above is only meaningful if the broken run's patch was
    // written back — the same guard, the same copy, in the other order.
    const guard = guardFor("check-appstore-config");
    const sound = repo.runPatched(
      "leak-check-sound",
      { [FLOOR_MODULE]: (source) => `// leak check\n${source}` },
      guard,
      REPO_ROOT,
    );
    assert.equal(sound.status, 0, sound.output);
  });
});
