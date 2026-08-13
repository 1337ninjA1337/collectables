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
 * So this harness moves the other half. `makePatchedRepo` copies `lib/` and
 * `scripts/` into a scratch root, rewrites the table in the COPY, and
 * `runGuardFrom` runs the copied wrapper against the REAL repository — a tree
 * where every walk is full and every input reads fine, so the broken
 * declaration is the only thing left that can fail.
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
  checkNameOf,
  makePatchedRepo,
  runGuardFrom,
  type PartialRoot,
} from "./helpers/guard-fixture";

const REPO_ROOT = path.resolve(__dirname, "..");
const FLOOR_MODULE = "lib/scanned-floor.ts";

const guardFor = (checkName: string) => {
  const guard = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === checkName);
  assert.ok(guard, `${checkName} is not in LINT_GUARDS`);
  return guard;
};

/** Cleaned up together at the end — each copy is ~2MB of lib/ + scripts/. */
const fixtures: PartialRoot[] = [];
after(() => {
  for (const fixture of fixtures) fixture.cleanup();
});

/**
 * A patched checkout in which `checkName`'s entry has been rewritten by
 * swapping `from` for `to` in the table source. Both strings are whole
 * declarations, so a formatting change in `lib/scanned-floor.ts` fails the
 * fixture loudly (`makePatchedRepo` refuses a no-op patch) rather than
 * silently running an unpatched guard.
 */
function patchedTable(from: string, to: string): PartialRoot {
  const fixture = makePatchedRepo({
    [FLOOR_MODULE]: (source) => {
      assert.ok(
        source.includes(from),
        `the anchor ${JSON.stringify(from)} is no longer in ${FLOOR_MODULE}`,
      );
      return source.replace(from, to);
    },
  });
  fixtures.push(fixture);
  return fixture;
}

describe("a count-shaped guard whose floor is not a positive integer", () => {
  // check-inline-hex walks app/ + components/ + lib/ and floors at 160.
  const patched = patchedTable(
    'count: { label: "source file", minimum: 160 }',
    'count: { label: "source file", minimum: 0 }',
  );
  const guard = guardFor("check-inline-hex");
  const run = () => runGuardFrom(guard, patched.root, REPO_ROOT);

  it("refuses instead of passing over the walk the floor was meant to defend", () => {
    // The scan root is this repository, so the walk finds its usual ~213
    // files. A floor of 0 would wave that through — and would wave through
    // zero files just as happily, which is the whole point.
    assert.equal(run().status, 1);
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
    assert.doesNotMatch(output, /\n\s+at\s/);
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
  const patched = patchedTable('inputs: ["app.json"],', "inputs: [],");
  const guard = guardFor("check-appstore-config");
  const run = () => runGuardFrom(guard, patched.root, REPO_ROOT);

  it("refuses rather than asserting nothing about the file it reads", () => {
    assert.equal(run().status, 1);
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
    assert.doesNotMatch(run().output, /\n\s+at\s/);
  });
});

describe("the same copy, unpatched", () => {
  // The negative control: without it, a fixture that failed to run the guard
  // at all (a bad path, a missing dependency in the copy) would look exactly
  // like a guard refusing for the right reason.
  it("passes, so the refusals above come from the patch and nothing else", () => {
    const control = makePatchedRepo({
      // A comment is the smallest change that proves the copy is a real,
      // runnable checkout without altering a single declaration in it.
      [FLOOR_MODULE]: (source) => `// patched-repo control copy\n${source}`,
    });
    fixtures.push(control);
    for (const checkName of ["check-inline-hex", "check-appstore-config"]) {
      const { status, output } = runGuardFrom(
        guardFor(checkName),
        control.root,
        REPO_ROOT,
      );
      assert.equal(status, 0, `${checkName} failed in the control copy:\n${output}`);
    }
  });
});
