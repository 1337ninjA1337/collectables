import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

// Aliased: `SUITES_DIR` in `helpers/suite-files` is the ABSOLUTE path, and
// this is the repo-relative name the guards walk by. Two different values under
// one name is exactly the confusion the case below exists to prevent.
import { SUITES_DIR as GUARDS_SUITES_DIR } from "../lib/source-dirs";
import { readRepoFile, repoPath } from "./helpers/repo-file";
import {
  SUITES_DIR,
  SUITES_REL,
  __resetSuiteFilesCacheForTests,
  assertExemptionsHonest,
  readSuite,
  suiteCode,
  suiteLines,
  suiteFiles,
  suiteText,
  topLevelSuites,
} from "./helpers/suite-files";

/**
 * One walk over the suite directory.
 *
 * Seven suites sweep their siblings, because a guard that says "no suite does
 * X" cannot be written against a list — the list is the thing that goes stale.
 * Each had the walk written out, and four of the copies were byte-identical,
 * three of those added on the same day by the runs that removed exactly this
 * duplication one level down. The reason to consolidate at four rather than at
 * forty is that four copies in one day is a rate, not a count.
 *
 * The sweep below is the same shape as the ones it serves, and is deliberately
 * not exempted from itself: this suite calls the helper like everyone else.
 */

/** The one file allowed to walk the directory itself. */
const HELPER = path.join("helpers", "suite-files.ts");

/**
 * {@link HELPER}, and this suite, which pins the value it resolves to.
 *
 * Two entries and no more. Every other suite that named the directory — the
 * bundler's exclusion list, the stub directory, the fixture's path to
 * `guard-fixture.ts`, the recursive walk that looks for strays below one level
 * — takes `SUITES_REL` now, including the one whose whole subject is what this
 * module's one-level walk MISSES.
 */
const ALLOWED_TO_NAME_THE_DIRECTORY: readonly string[] = [
  HELPER,
  "suite-files-helper.test.ts",
];

describe("the suite directory, walked once", () => {
  it("resolves to the directory the suites are actually in", () => {
    assert.equal(SUITES_REL, "__tests__");
    // The same string is exported from `lib/source-dirs.ts` as `SUITES_DIR`,
    // for the guards, which cannot import from this tree without inverting the
    // dependency the two halves were split to keep. Both are load-bearing now
    // — a guard's scan roots on one side, the suites' walk on the other — and
    // until this line nothing said they were the same directory. Rename one
    // and a guard and a suite walk different trees, both greenly.
    assert.equal(SUITES_REL, GUARDS_SUITES_DIR);
    assert.equal(SUITES_DIR, repoPath(SUITES_REL));
    assert.equal(SUITES_DIR, path.dirname(new URL(import.meta.url).pathname));
  });

  it("walks one level deep, and returns paths relative to the directory", () => {
    const files = suiteFiles();
    // Relative, because that is what an offender list should print and what an
    // exemption entry is written as — an absolute path in a failure message
    // spends the reader's eye on the runner's checkout prefix.
    assert.ok(files.every((relative) => !path.isAbsolute(relative)));
    assert.ok(files.includes("suite-files-helper.test.ts"), "misses this file");
    assert.ok(files.includes(HELPER), "misses the nested helper");
    assert.ok(files.every((relative) => relative.endsWith(".ts")));
    // One level and no further: nothing reads a third today, and a suite that
    // appeared at one should turn a guard red rather than be quietly skipped.
    assert.ok(
      files.every((relative) => relative.split(path.sep).length <= 2),
      "the walk returned a path more than one level deep",
    );
    assert.ok(files.length > 200, `only ${files.length} suite files walked`);
  });

  it("separates what is WRITTEN from what npm test actually RUNS", () => {
    const top = topLevelSuites();
    assert.ok(top.every((name) => name.endsWith(".test.ts")));
    assert.ok(top.every((name) => !name.includes(path.sep)));
    assert.ok(top.includes("suite-files-helper.test.ts"));
    // The difference is the whole reason for two functions: `helpers/` is in
    // one and not the other, and a suite parked in a subdirectory typechecks
    // while never executing — the silent-coverage-loss shape that
    // `test-typecheck-prelude.test.ts` exists to catch.
    assert.ok(suiteFiles().includes(HELPER));
    assert.ok(!top.includes(HELPER));
    assert.ok(top.length < suiteFiles().length);
    // And the glob in package.json is the claim this set is standing in for.
    const pkg = JSON.parse(readRepoFile("package.json")) as {
      scripts: { test: string };
    };
    assert.match(pkg.scripts.test, /__tests__\/\*\.test\.ts/);
  });

  it("reads a suite three ways, and the normalising is the rule not a detail", () => {
    const raw = readSuite(HELPER);
    assert.ok(raw.includes("export function suiteFiles"));
    // Flattened: a shape survives being found across a prettier rewrap, which
    // is how a guard once read three suites clean while they still did the
    // thing it forbade.
    assert.ok(!/\s\s/.test(suiteText(HELPER)));
    assert.equal(suiteText(HELPER), raw.replace(/\s+/g, " "));
    // Stripped: the helper's own doc comment quotes shapes that guards retire,
    // so prose can explain a thing the code must not do.
    assert.ok(suiteText(HELPER).includes("* Two shapes"));
    assert.ok(!suiteCode(HELPER).includes("* Two shapes"));
    assert.ok(suiteCode(HELPER).includes("export function suiteFiles"));
  });

  it("keeps the line breaks in the fourth read, which is the one a ^ anchor needs", () => {
    // `suiteCode` and `suiteLines` differ by one call and by whether a
    // `/^import .../gm` finds anything. A sweep in `helper-lib-imports.test.ts`
    // reached for the flattened one and reported a population of zero, which
    // reads as a clean tree rather than as a broken parse.
    const lines = suiteLines(HELPER);

    assert.ok(lines.includes("\n"), "the whole point: the flattened read has none");
    assert.ok(!lines.includes("* Two shapes"), "comments are gone, same as suiteCode");
    assert.ok(
      /^import assert from "node:assert\/strict";$/m.test(lines),
      "a line-anchored regex has to match, which is what suiteCode cannot offer",
    );
    assert.equal(
      suiteCode(HELPER),
      lines.replace(/\s+/g, " "),
      "the pair differs by the flatten and nothing else — suiteText is the one that keeps comments",
    );
  });

  it("throws on a name that is not a suite rather than answering with nothing", () => {
    assert.throws(() => readSuite("no-such-suite.test.ts"), /ENOENT/);
  });

  it("answers the walk and the reads once per process, not once per sweep", () => {
    // Memoised where `readRepoFile` deliberately is not, and the difference is
    // what a hit is worth: a sweep reads every file, and six of them run
    // across four guards. Identity rather than equality, so this fails if the
    // cache is quietly removed rather than passing on a re-derived answer.
    assert.equal(suiteFiles(), suiteFiles());
    assert.equal(readSuite(HELPER), readSuite(HELPER));
    assert.equal(suiteText(HELPER), suiteText(HELPER));
    assert.equal(suiteCode(HELPER), suiteCode(HELPER));
    assert.equal(suiteLines(HELPER), suiteLines(HELPER));
    // A miss still throws rather than caching the failure as an empty answer.
    assert.throws(() => readSuite("no-such-suite.test.ts"), /ENOENT/);
  });

  it("can forget the cache, for a suite that changes the tree under it", () => {
    // Nothing calls the reset today; it exists because "nothing writes to the
    // repository during a run" is a premise and not a law — the guard fixtures
    // already create `guard-fixture-nested-*` directories under the repo root.
    const before = suiteFiles();
    __resetSuiteFilesCacheForTests();
    const after = suiteFiles();
    assert.notEqual(before, after, "the reset did not actually clear the walk");
    assert.deepEqual(before, after, "the re-walk disagreed with the cached one");
    assert.notEqual(suiteText(HELPER), undefined);
  });

  it("holds an exemption list to four things, and says which one broke", () => {
    // The convention four guards had each written around their own list. Its
    // failure modes are the point, so they are exercised rather than assumed —
    // a checker that cannot fail is the same as no checker.
    const honest = {
      exemptions: [HELPER],
      expected: [HELPER],
      rule: "the example rule",
      stillNeeded: () => true,
    };
    assert.doesNotThrow(() => assertExemptionsHonest(honest));
    assert.throws(
      () => assertExemptionsHonest({ ...honest, expected: [HELPER, "extra.test.ts"] }),
      /exemption list changed/,
    );
    assert.throws(
      () => assertExemptionsHonest({ ...honest, exemptions: [], expected: [] }),
      /is empty — delete it instead/,
    );
    assert.throws(
      () =>
        assertExemptionsHonest({
          ...honest,
          exemptions: [HELPER, HELPER],
          expected: [HELPER, HELPER],
        }),
      /repeats an entry/,
    );
    assert.throws(
      () =>
        assertExemptionsHonest({
          ...honest,
          exemptions: ["deleted-suite.test.ts"],
          expected: ["deleted-suite.test.ts"],
        }),
      /is not in the walk/,
    );
    assert.throws(
      () => assertExemptionsHonest({ ...honest, stillNeeded: () => false }),
      /no longer needs it/,
    );
  });

  it("checks the exemptions against the walk the sweep uses, not always the suites", () => {
    // The default is `suiteFiles()` because seven of the eight callers sweep
    // those. The eighth does not, and a hole in a `lib`/`scripts` sweep held to
    // the suite walk would be reported as stale on every run — a guard failing
    // on a file it was never about.
    const foreign = {
      exemptions: ["lib/somewhere.ts"],
      expected: ["lib/somewhere.ts"],
      rule: "the example rule",
      stillNeeded: () => true,
    };
    assert.throws(
      () => assertExemptionsHonest(foreign),
      /is not in the walk/,
      "an exemption outside the suite walk passed against the default walk",
    );
    assert.doesNotThrow(() =>
      assertExemptionsHonest({ ...foreign, walk: ["lib/somewhere.ts", "lib/other.ts"] }),
    );
    // And a narrowed walk still catches the stale entry, so the parameter is
    // not a way out of the check.
    assert.throws(
      () => assertExemptionsHonest({ ...foreign, walk: ["lib/other.ts"] }),
      /is not in the walk/,
    );
  });

  it("leaves no suite walking the directory for itself", () => {
    // Matches the walk's anchor rather than its body: every copy has to start
    // by naming the directory, however the recursion below it is written. With
    // `SUITES_REL` exported there is nothing left that a suite needs the
    // literal for — and `test-typecheck-prelude.test.ts` is NOT exempt, because
    // it was migrated onto the constant too; only its recursion is its own, on
    // purpose, since its subject is the files a one-level walk would miss.
    const offenders = suiteFiles().filter((relative) => {
      if (ALLOWED_TO_NAME_THE_DIRECTORY.includes(relative)) return false;
      return /"__tests__"|'__tests__'/.test(suiteCode(relative));
    });
    assert.deepEqual(
      offenders,
      [],
      `these suites name the suite directory instead of importing SUITES_REL: ${offenders.join(", ")}`,
    );
  });

  it("keeps the exemption list to the two files that have to say the name", () => {
    assertExemptionsHonest({
      exemptions: ALLOWED_TO_NAME_THE_DIRECTORY,
      expected: [HELPER, "suite-files-helper.test.ts"],
      rule: "the suite-directory rule",
      stillNeeded: (relative) => suiteCode(relative).includes('"__tests__"'),
    });
  });

  it("has enough callers that the sweep above is not scanning an empty room", () => {
    const readers = suiteFiles().filter((relative) =>
      suiteText(relative).includes("helpers/suite-files"),
    );
    assert.ok(
      readers.length >= 7,
      `only ${readers.length} suites walk through the helper — seven had their own copy`,
    );
  });
});
