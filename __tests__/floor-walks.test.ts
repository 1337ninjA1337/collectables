import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FLOOR_SLACK,
  FLOOR_WALKS,
  formatFloorMeasurement,
  measureFloorWalk,
} from "@/lib/floor-walks";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The arithmetic of a floor re-measure, over counts nobody had to walk for.
 *
 * `__tests__/lint-guard-partial-root.test.ts` enforces the property — no single
 * scan root clears a multi-root floor alone — and goes red when an ordinary
 * file lands in the largest root. That has happened three times to
 * `check-inline-hex` and once to `check-inline-radius`, and each time the fix
 * was four manual steps. `npm run remeasure-floors` does the counting; this
 * pins what it does with the numbers.
 *
 * Pure on purpose, and that is the whole reason the arithmetic is in `lib/`:
 * the cases worth testing are a floor level with its largest root and a tree so
 * lopsided that the property and the slack disagree, and no checkout of this
 * repository currently produces either. A test that could only run against the
 * real tree would be a test of today's numbers rather than of the rule.
 */

const root = (name: string, count: number) => ({ root: name, count });

describe("measureFloorWalk", () => {
  it("sums the roots, finds the largest, and holds when the floor clears it", () => {
    const row = measureFloorWalk("check-x", 168, "source file", [
      root("app", 19),
      root("components", 45),
      root("lib", 160),
    ]);
    assert.equal(row.total, 224);
    assert.deepEqual(row.largestRoot, root("lib", 160));
    assert.equal(row.holds, true);
    // 224 - 168 = 56, a quarter of the walk.
    assert.equal(row.slackPercent, 25);
  });

  it("stops holding the moment the largest root draws LEVEL with the floor", () => {
    // The exact event that has now reddened the partial-root suite four times,
    // and the boundary it turns on: a floor equal to its largest root is
    // cleared by that root alone, so every other root could vanish and the
    // guard still passes. `>` and not `>=` is the whole rule.
    const level = measureFloorWalk("check-x", 160, "source file", [
      root("app", 19),
      root("components", 45),
      root("lib", 160),
    ]);
    assert.equal(level.holds, false);
    const above = measureFloorWalk("check-x", 161, "source file", [
      root("app", 19),
      root("components", 45),
      root("lib", 160),
    ]);
    assert.equal(above.holds, true);
  });

  it("suggests a number above the largest root, with a quarter of the walk deletable", () => {
    const row = measureFloorWalk("check-x", 160, "source file", [
      root("app", 19),
      root("components", 45),
      root("lib", 160),
    ]);
    // 224 * 0.75 = 168, which is also above lib's 160 — the ordinary case,
    // where the two rules agree and the slack is the binding one.
    assert.equal(row.suggested, 168);
    assert.ok(row.suggested > row.largestRoot.count, "a suggestion under the largest root is not a floor");
  });

  it("lets the property beat the slack on a lopsided tree", () => {
    // One root holding almost everything: a quarter-deletable floor would sit
    // UNDER that root and therefore be cleared by it alone. The suggestion has
    // to be tighter than the notes' usual slack, because a floor below its
    // largest root is not a floor at all — and no checkout of this repository
    // is this lopsided, which is why this case exists as arithmetic.
    const row = measureFloorWalk("check-x", 10, "file", [root("app", 2), root("tests", 98)]);
    assert.equal(row.total, 100);
    assert.equal(row.largestRoot.count, 98);
    // 100 * 0.75 = 75, which 98 clears; so the property wins with 99.
    assert.equal(row.suggested, 99);
    assert.ok(row.suggested > row.largestRoot.count);
  });

  it("refuses a measurement over no roots instead of inventing a zero", () => {
    // A floor over no roots has no largest one, and answering with 0 would be
    // this module producing exactly the vacuous number the floors exist to
    // refuse one level down.
    assert.throws(
      () => measureFloorWalk("check-x", 5, "file", []),
      /no scan roots has no largest root/,
    );
  });
});

describe("formatFloorMeasurement", () => {
  it("leads with ok and names the breakdown when the floor holds", () => {
    const line = formatFloorMeasurement(
      measureFloorWalk("check-x", 168, "source file", [
        root("app", 19),
        root("components", 45),
        root("lib", 160),
      ]),
    );
    assert.match(line, /^ok {3}check-x$/m);
    assert.match(line, /declared 168 source file\(s\); walk holds 224 \(app 19, components 45, lib 160\)/);
    // Nothing to act on, so no suggestion: a tool that prints a number beside
    // every healthy floor is one whose numbers stop being read.
    assert.doesNotMatch(line, /re-measure to/);
  });

  it("leads with MOVE and names the number and the missing half when it does not", () => {
    const line = formatFloorMeasurement(
      measureFloorWalk("check-x", 160, "source file", [
        root("app", 19),
        root("components", 45),
        root("lib", 160),
      ]),
    );
    assert.match(line, /^MOVE check-x$/m);
    assert.match(line, /lib\/ alone clears the floor/);
    assert.match(line, /re-measure to 168/);
    // The sentence that keeps this a tool rather than a rewriter: the number is
    // mechanical and the reason it moved is not.
    assert.match(line, /the note is the half this tool cannot write/);
  });

  it("says when a holding floor has less room than these floors are measured with", () => {
    // The other direction, and a note rather than a failure. A floor sitting
    // close under the total trips on an ordinary deletion long before it
    // catches a lost root, which is how a floor earns a reputation for crying
    // wolf and then gets deleted.
    const tight = formatFloorMeasurement(
      measureFloorWalk("check-x", 95, "file", [root("app", 20), root("lib", 80)]),
    );
    assert.match(tight, /^ok {3}check-x$/m);
    assert.match(tight, /only 5% is deletable/);
    // And a floor with MORE room than the target says nothing: telling a
    // reader to tighten a working floor is how a tool stops being run.
    const roomy = formatFloorMeasurement(
      measureFloorWalk("check-x", 50, "file", [root("app", 40), root("lib", 45)]),
    );
    assert.doesNotMatch(roomy, /is deletable —/);
    assert.doesNotMatch(roomy, /re-measure to/);
  });
});

describe("FLOOR_WALKS", () => {
  it("names only guards that declare a count floor", () => {
    // A walk with no floor under it is a row this tool would skip silently.
    for (const checkName of Object.keys(FLOOR_WALKS)) {
      assert.ok(
        SCANNED_FLOORS[checkName]?.count,
        `${checkName} is in FLOOR_WALKS and declares no count floor in SCANNED_FLOORS`,
      );
    }
  });

  it("matches each guard's own SCANNED_DIRS literal", () => {
    // The list is only worth reading if it still describes the walk. The
    // partial-root suite asserts this too for the four it builds fixtures
    // from; here it covers every row, including the five-root walk that suite
    // deliberately skips.
    for (const [checkName, walk] of Object.entries(FLOOR_WALKS)) {
      const source = readRepoFile("scripts", `${checkName}.ts`);
      assert.match(
        source,
        new RegExp(`\\[${walk.roots.map((r) => `"${r}"`).join(", ")}\\]`),
        `${checkName}'s scan roots moved; update FLOOR_WALKS in lib/floor-walks.ts to match`,
      );
    }
  });

  it("is not empty, and its slack is the tighter reading of the notes", () => {
    assert.ok(Object.keys(FLOOR_WALKS).length >= 4, "too few walks for the cases above to mean much");
    // The notes do their arithmetic between a quarter and a third; suggesting
    // with the quarter means a suggestion never claims more room than the
    // notes it imitates.
    assert.ok(FLOOR_SLACK > 0 && FLOOR_SLACK <= 0.3);
  });
});
