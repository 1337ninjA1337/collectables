import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkWalkPremise,
  describeWalkPremiseProblem,
  FLOOR_SLACK,
  FLOOR_WALKS,
  formatFloorMeasurement,
  measureFloorWalk,
  UNCOUNTED_MODULE_REASONS,
  unusedUncountedExcuses,
  type RootEvidence,
  type WalkPremiseCode,
} from "@/lib/floor-walks";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";
import { MARKUP_EXTENSIONS, MODULE_EXTENSIONS, SOURCE_EXTENSIONS } from "@/lib/source-dirs";
import { readRepoFile, REPO_ROOT } from "./helpers/repo-file";
import { SUITES_REL } from "./helpers/suite-files";
import { listSourceFiles, tallyExtensions } from "../scripts/guard-io";

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

/**
 * One scan root walked with NO extension filter, tallied by extension.
 *
 * Memoised because `app/` alone appears in four of the five walks and
 * `__tests__/` is 400-odd files: the premise wants a second walk of each root,
 * not a second walk per row that mentions it.
 *
 * The filter is the only difference from the guards' own walk — same skip list
 * — which is what makes the counts comparable at all.
 */
const rootTallies = new Map<string, Record<string, number>>();
function tallyRoot(name: string): Record<string, number> {
  const cached = rootTallies.get(name);
  if (cached) return cached;
  const tally = tallyExtensions(REPO_ROOT, name);
  rootTallies.set(name, tally);
  return tally;
}

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

/**
 * A root that holds exactly what it says, so each case below breaks one thing.
 *
 * `counted` defaults to the tally over `.ts` and `.tsx`, because the honest
 * evidence is the two walks AGREEING — a case that wants them to disagree says
 * so by passing the number it wants.
 */
const evidence = (
  name: string,
  present: Record<string, number>,
  counted?: number,
): RootEvidence => ({
  root: name,
  counted: counted ?? SOURCE_EXTENSIONS.reduce((sum, ext) => sum + (present[ext] ?? 0), 0),
  present,
});

const codesOf = (problems: readonly { code: WalkPremiseCode }[]) => problems.map((p) => p.code);

describe("checkWalkPremise", () => {
  const sourceWalk = { roots: ["app", "lib"] };

  it("finds nothing wrong with a walk whose roots hold what it counts", () => {
    assert.deepEqual(
      checkWalkPremise("check-x", sourceWalk, [
        evidence("app", { ".tsx": 19 }),
        evidence("lib", { ".ts": 149, ".tsx": 12 }),
      ]),
      [],
    );
  });

  it("names the root that walked to nothing", () => {
    const problems = checkWalkPremise("check-x", sourceWalk, [
      evidence("app", { ".md": 3 }),
      evidence("lib", { ".ts": 149, ".tsx": 12 }),
    ]);
    assert.deepEqual(codesOf(problems), ["empty_root"]);
    assert.equal(problems[0].root, "app");
    assert.match(describeWalkPremiseProblem(problems[0]), /^check-x: app\/ walked to zero files/);
  });

  it("catches the guard's walk and an unfiltered walk disagreeing over one root", () => {
    // The shape a skip list drifting produces: both walks are healthy, both
    // return a number a floor clears, and they are numbers about different
    // sets of files.
    const problems = checkWalkPremise("check-x", sourceWalk, [
      evidence("app", { ".tsx": 19 }),
      evidence("lib", { ".ts": 149, ".tsx": 12 }, 120),
    ]);
    assert.deepEqual(codesOf(problems), ["count_mismatch"]);
    const said = describeWalkPremiseProblem(problems[0]);
    assert.match(said, /counted as 120 file\(s\)/);
    assert.match(said, /holds 161 with those extensions/);
  });

  it("catches a declared extension that matches nothing anywhere in the walk", () => {
    // `.tsx` renamed away, or a walk that outlived the files it was written
    // for: every root still counts, so the old premise passed.
    const problems = checkWalkPremise("check-x", sourceWalk, [
      evidence("app", { ".ts": 4 }),
      evidence("lib", { ".ts": 149 }),
    ]);
    assert.deepEqual(codesOf(problems), ["unused_extension"]);
    assert.equal(problems[0].extension, ".tsx");
    assert.equal(problems[0].root, undefined, "the finding is about the walk, not about one root");
    assert.match(describeWalkPremiseProblem(problems[0]), /declares \.tsx and no file under any of its roots/);
  });

  it("catches module code under an extension nothing counts and nothing excuses", () => {
    const problems = checkWalkPremise("check-x", sourceWalk, [
      evidence("app", { ".tsx": 19 }),
      evidence("lib", { ".ts": 149, ".mts": 2 }),
    ]);
    assert.deepEqual(codesOf(problems), ["uncounted_extension"]);
    assert.equal(problems[0].extension, ".mts");
    assert.match(describeWalkPremiseProblem(problems[0]), /lib\/ holds 2 \.mts file\(s\)/);
  });

  it("leaves excused extensions and non-code files alone", () => {
    // The two halves of "not a hole": named in UNCOUNTED_MODULE_REASONS, or
    // not module code at all. Neither is this rule's business, and a premise
    // that reported them would be a premise nobody could keep green.
    assert.deepEqual(
      checkWalkPremise("check-x", { roots: ["scripts", SUITES_REL], extensions: [".ts"] }, [
        evidence("scripts", { ".ts": 29, ".js": 1 }, 29),
        evidence(SUITES_REL, { ".ts": 431, ".mjs": 3, ".snap": 2 }, 431),
      ]),
      [],
    );
  });

  it("reads a markup walk's uncounted .ts as a narrowing rather than a hole", () => {
    // `check-clarity-input-mask` takes `.tsx` only, and the `.ts` files beside
    // it are uncounted BY DESIGN — the set that counts them is what makes that
    // a decision. A premise blind to the difference would fire on the one walk
    // in the table that narrows on purpose.
    const markup = { roots: ["app", "components"], extensions: [".tsx"] };
    assert.deepEqual(
      checkWalkPremise("check-clarity-input-mask", markup, [
        evidence("app", { ".tsx": 19 }, 19),
        evidence("components", { ".tsx": 44, ".ts": 1 }, 44),
      ]),
      [],
    );
  });

  it("reports every problem it finds rather than the first", () => {
    const problems = checkWalkPremise("check-x", sourceWalk, [
      evidence("app", { ".cjs": 1 }),
      evidence("lib", { ".ts": 149 }),
    ]);
    assert.deepEqual(codesOf(problems), ["empty_root", "uncounted_extension", "unused_extension"]);
  });

  it("refuses evidence about no roots at all", () => {
    assert.throws(
      () => checkWalkPremise("check-x", sourceWalk, []),
      /nothing to be a premise about/,
    );
  });

  it("gives every code a sentence naming the guard", () => {
    // Exhaustive by construction: a new code that reaches the detail table
    // without a sentence is a TypeScript error, and one that reaches this list
    // without an entry fails here.
    const codes: WalkPremiseCode[] = [
      "empty_root",
      "count_mismatch",
      "unused_extension",
      "uncounted_extension",
    ];
    for (const code of codes) {
      const said = describeWalkPremiseProblem({ checkName: "check-x", code });
      assert.match(said, /^check-x: /);
      assert.ok(said.length > 60, `${code} is described in fewer words than a reason`);
    }
  });
});

describe("UNCOUNTED_MODULE_REASONS", () => {
  it("keeps the three extension sets nested, which is what the partition rests on", () => {
    // `checkWalkPremise` reads "covered by a declared set" as "in
    // SOURCE_EXTENSIONS", because SOURCE is the widest of the sets a walk can
    // narrow to. A third set with an extension outside it would make that
    // shorthand wrong in the quiet direction — a real hole classified as a
    // deliberate narrowing — so the nesting is asserted rather than assumed.
    for (const extension of MARKUP_EXTENSIONS) {
      assert.ok(SOURCE_EXTENSIONS.includes(extension), `${extension} is markup and not source`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      assert.ok(MODULE_EXTENSIONS.includes(extension), `${extension} is scanned and not module code`);
    }
  });


  it("excuses only module extensions, each with a reason", () => {
    for (const [extension, reason] of Object.entries(UNCOUNTED_MODULE_REASONS)) {
      assert.ok(
        MODULE_EXTENSIONS.includes(extension),
        `${extension} is excused from every floor walk and is not module code — nothing was counting it to begin with`,
      );
      assert.ok(
        !SOURCE_EXTENSIONS.includes(extension),
        `${extension} is both scanned by the guards and excused from their walks`,
      );
      assert.ok(reason.length >= 30, `${extension} is excused for a reason shorter than a reason`);
    }
  });

  it("names nothing the walked roots no longer hold", () => {
    // An excuse for a file that left is an excuse waiting for a different file
    // to arrive under the same extension.
    const held = new Set(
      Object.keys(FLOOR_WALKS).flatMap((checkName) =>
        FLOOR_WALKS[checkName].roots.flatMap((root) => Object.keys(tallyRoot(root))),
      ),
    );
    assert.deepEqual(
      unusedUncountedExcuses(held),
      [],
      "these extensions are excused from the floor walks and no file under any scan root has one",
    );
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

  it("declares the same roots in SCANNED_FLOORS as it walks, for every entry that names them", () => {
    // Two tables now name a walk's roots, for different jobs: `FLOOR_WALKS` is
    // read by the re-measure tool and by this suite, and `count.roots` is read
    // by the guard at its own runtime. They must agree, because the second is
    // the one that refuses and the first is the one people read — a guard
    // whose runtime list quietly lost a root would enforce less than the table
    // it is documented by, which is the failure this whole shape is about, one
    // level up.
    for (const [checkName, walk] of Object.entries(FLOOR_WALKS)) {
      const roots = SCANNED_FLOORS[checkName]?.count?.roots;
      if (!roots) continue;
      assert.deepEqual(
        [...roots],
        [...walk.roots],
        `${checkName}'s SCANNED_FLOORS roots and its FLOOR_WALKS roots disagree`,
      );
    }
  });

  it("still sits above its largest single root, for every walk that has not moved onto roots", () => {
    // What this case was for, and why it now checks nothing.
    //
    // The property — no single scan root clears a multi-root floor alone — was
    // enforced here by arithmetic, cheaply and over every walk, because the
    // fixture suite can only afford to spawn guards for the walks whose trees
    // are small enough to copy. Arithmetic is the wrong shape for it: the
    // comparison is against a COMMITTED number, so it goes red whenever the
    // tree grows past one, which happened five times and twice in one
    // afternoon, always in a suite unrelated to the change that caused it.
    //
    // A guard that declares `count.roots` states the property at its own
    // runtime instead — every declared root must have contributed — and is
    // skipped here. All six now do, so this loop covers nothing, and the case
    // below says so out loud rather than passing over an empty list: a green
    // assertion nobody notices has stopped running is the exact failure this
    // whole module exists to refuse, one level up.
    //
    // Kept rather than deleted because it is the safety net for the NEXT
    // multi-root guard, which will arrive without roots declared and be caught
    // here on its first red run. Retiring it for good, and deciding what the
    // count floors are still for, is 3/3 in .tasks/.tasks.md.
    for (const [checkName, walk] of Object.entries(FLOOR_WALKS)) {
      const floor = SCANNED_FLOORS[checkName]?.count;
      assert.ok(floor, `${checkName} declares no count floor`);
      // A guard that declares its roots states the property directly — every
      // declared root must have contributed — so the arithmetic below is a
      // second, weaker statement of something already enforced at its own
      // runtime, and the ONLY reason its number would have to move. Skipped
      // for those, which is the entire point of declaring them: this case has
      // gone red five times as the tree grew, twice in one afternoon from a
      // single new component, always in a suite unrelated to the change that
      // caused it. The remaining walks move onto `roots` in 2/3.
      if (floor.roots) continue;
      const perRoot = walk.roots.map((root) => ({
        root,
        count: listSourceFiles(REPO_ROOT, [root], walk.extensions ?? SOURCE_EXTENSIONS).length,
      }));
      // Premise before the claim, and it has to be the WHOLE premise: a root
      // that walked to nothing makes the comparison below true for a reason
      // that has nothing to do with floors, and so does a root whose filter
      // silently stopped matching — that one still returns a healthy count
      // from the files it does match, while measuring a fraction of the
      // directory. `checkWalkPremise` states both, plus the two walks
      // agreeing over each root.
      const problems = checkWalkPremise(
        checkName,
        walk,
        perRoot.map(({ root, count }) => ({ root, counted: count, present: tallyRoot(root) })),
      );
      assert.deepEqual(
        problems.map(describeWalkPremiseProblem),
        [],
        `${checkName} is measuring something other than the walk it declares, so the floor below proves nothing`,
      );
      const row = measureFloorWalk(checkName, floor.minimum, floor.label, perRoot);
      assert.ok(
        row.holds,
        `${row.largestRoot.root}/ alone holds ${String(row.largestRoot.count)} of the ` +
          `${floor.label}s ${checkName} counts, which clears its floor of ${String(floor.minimum)} — ` +
          `so every other scan root could vanish and the guard still reports green. ` +
          `Run \`npm run remeasure-floors\`: it suggests ${String(row.suggested)}. ` +
          `Re-measure in lib/scanned-floor.ts and say why in the note.`,
      );
    }
  });

  it("says how many walks still depend on that arithmetic, so nobody mistakes silence for coverage", () => {
    // The vacuity guard for the case above. It is a loop with a `continue` in
    // it, and a loop that skips every entry passes exactly like a loop that
    // checked every entry — so the count is published here instead of being
    // left to whoever next reads a green run.
    //
    // Zero today, which is the migration being finished rather than the check
    // being broken. This number going UP is a new multi-root guard that has
    // not declared its roots; it is not a failure, it is a to-do, which is why
    // this reports rather than refuses.
    const onArithmetic = Object.keys(FLOOR_WALKS).filter(
      (checkName) => !SCANNED_FLOORS[checkName]?.count?.roots,
    );
    assert.deepEqual(
      onArithmetic,
      [],
      `these walks still hold the no-single-root property by a committed number rather than by declaring count.roots, so their floors will need re-measuring as the tree grows: ${onArithmetic.join(", ")}`,
    );
  });

  it("is not empty, and its slack is the tighter reading of the notes", () => {
    assert.ok(Object.keys(FLOOR_WALKS).length >= 4, "too few walks for the cases above to mean much");
    // The notes do their arithmetic between a quarter and a third; suggesting
    // with the quarter means a suggestion never claims more room than the
    // notes it imitates.
    assert.ok(FLOOR_SLACK > 0 && FLOOR_SLACK <= 0.3);
  });
});
