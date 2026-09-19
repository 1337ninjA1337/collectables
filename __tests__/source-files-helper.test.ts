import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { RUNTIME_CODE_WALK_FLOOR, SCANNED_FLOORS } from "@/lib/scanned-floor";

import { readRepoFile } from "./helpers/repo-file";
import { SUITES_REL, assertExemptionsHonest, suiteCode, suiteFiles } from "./helpers/suite-files";
import {
  MARKUP_DIRS,
  NON_APP_TS_DIRS,
  NON_MARKUP_REASONS,
  NON_RUNTIME_REASONS,
  RUNTIME_CODE_DIRS,
  SOURCE_DIRS,
} from "@/lib/source-dirs";

import {
  __resetSourceFilesCacheForTests,
  assertSourceDirsCoverTheTree,
  readSource,
  sourceCode,
  sourceCodeFlat,
  sourceFiles,
  tsxFiles,
} from "./helpers/source-files";

/**
 * `__tests__/helpers/source-files.ts` — the walk over `app/`, `components/`,
 * `lib/`, `data/` and `scripts/` that eighteen suites had each written out.
 *
 * The cases below are one per property a caller actually depends on, in the
 * order the migration found them mattering: that the walk recurses (the router
 * tree nests, and a one-level walk would report a clean `app/` while missing
 * every screen), that the paths are repo-relative with forward slashes (they
 * end up in `assert.deepEqual` offender lists and in exemption entries), that
 * the extension split is real, and that the two normalising readers differ in
 * exactly the way their names claim.
 *
 * The last case is the one that keeps the module honest over time: a sweep
 * against a hardcoded directory list stops covering new code silently, and a
 * green run is indistinguishable from a covering one.
 */

describe("sourceFiles — the walk", () => {
  it("recurses into the router tree rather than stopping one level down", () => {
    // `app/collection/[id].tsx` is two levels deep and is the single most
    // swept file in the repo. A one-level walk returns a plausible-looking
    // list without it, which is why this is asserted by name.
    const files = sourceFiles("app");
    assert.ok(files.includes("app/collection/[id].tsx"), `walked: ${files.join(", ")}`);
    assert.ok(files.includes("app/index.tsx"));
  });

  it("returns repo-relative forward-slash paths, sorted, with no duplicates", () => {
    const files = sourceFiles();
    for (const relative of files) {
      assert.ok(!path.isAbsolute(relative), `${relative} is absolute — offender lists print relative`);
      assert.ok(!relative.includes("\\"), `${relative} carries a backslash separator`);
      assert.ok(!relative.startsWith("./"), `${relative} carries a leading ./`);
    }
    assert.deepEqual([...files].sort(), [...files], "the walk is not sorted");
    assert.equal(new Set(files).size, files.length, "the walk repeats a file");
  });

  it("defaults to every source directory and narrows when asked", () => {
    const all = sourceFiles();
    const ui = sourceFiles("app", "components");
    assert.ok(ui.length < all.length);
    assert.ok(ui.every((relative) => all.includes(relative)));
    assert.ok(all.some((relative) => relative.startsWith("lib/")));
    assert.ok(all.some((relative) => relative.startsWith("scripts/")));
    assert.ok(!ui.some((relative) => relative.startsWith("lib/")));
  });

  it("walks a sane file set (a broken walk passes every sweep vacuously)", () => {
    // A floor rather than a count: the number moves every week and the thing
    // worth failing on is a walk that returned nothing or almost nothing.
    const files = sourceFiles();
    assert.ok(files.length >= 150, `expected >= 150 source files, walked ${files.length}`);
  });

  it("takes only .ts and .tsx", () => {
    for (const relative of sourceFiles()) {
      assert.ok(/\.tsx?$/.test(relative), `${relative} is not TypeScript`);
    }
  });
});

describe("tsxFiles — the markup subset", () => {
  it("is every .tsx in the walk and nothing else", () => {
    const all = sourceFiles("app", "components");
    assert.deepEqual(
      tsxFiles("app", "components"),
      all.filter((relative) => relative.endsWith(".tsx")),
    );
  });

  it("drops the .ts files a markup rule would false-positive on", () => {
    const tsx = tsxFiles();
    assert.ok(tsx.length > 0);
    assert.ok(!tsx.some((relative) => relative.endsWith(".ts")));
    assert.ok(!tsx.includes("lib/design-tokens.ts"));
  });
});

describe("the three readers", () => {
  it("readSource returns the file unchanged", () => {
    assert.equal(readSource("lib/strip-comments.ts"), readRepoFile("lib/strip-comments.ts"));
  });

  it("sourceCode blanks comments and preserves every offset", () => {
    const raw = readSource("lib/strip-comments.ts");
    const code = sourceCode("lib/strip-comments.ts");
    // The property the line-numbered sweeps depend on: same length, same
    // newlines, so an index into one is an index into the other.
    assert.equal(code.length, raw.length);
    assert.equal(code.split("\n").length, raw.split("\n").length);
    // That module's doc comment is the longest in the repo; if stripping did
    // nothing this would fail rather than pass by luck.
    assert.notEqual(code, raw);
    assert.ok(!code.includes("Blank out the comments in a source file"));
  });

  it("sourceCodeFlat strips first and flattens after", () => {
    const flat = sourceCodeFlat("lib/strip-comments.ts");
    assert.ok(!/\s\s/.test(flat), "runs of whitespace survived the flatten");
    assert.ok(!flat.includes("\n"));
    assert.ok(!flat.includes("Blank out the comments in a source file"));
    assert.ok(flat.includes("export function stripComments(source: string): string {"));
  });

  it("caches by identity, and the reset clears it", () => {
    // Removing the memoisation should be a red run rather than a silent
    // re-derive: eighteen suites sweep this tree and several strip every byte.
    const before = sourceFiles("app");
    assert.equal(sourceFiles("app"), before, "the walk re-derived instead of answering from the cache");
    assert.equal(sourceCode("lib/design-tokens.ts"), sourceCode("lib/design-tokens.ts"));
    __resetSourceFilesCacheForTests();
    const after = sourceFiles("app");
    assert.notEqual(after, before, "the reset left the previous walk in place");
    assert.deepEqual(after, before, "the re-walk disagreed with the cached one");
  });
});

describe("SOURCE_DIRS is checked against the tree, not remembered", () => {
  it("accounts for every top-level directory holding TypeScript", () => {
    assertSourceDirsCoverTheTree();
  });

  it("keeps the two lists disjoint and non-empty", () => {
    assert.ok(SOURCE_DIRS.length > 0);
    assert.ok(NON_APP_TS_DIRS.length > 0);
    for (const dir of NON_APP_TS_DIRS) {
      assert.ok(!SOURCE_DIRS.includes(dir), `${dir} is in both lists`);
    }
    assert.equal(new Set(SOURCE_DIRS).size, SOURCE_DIRS.length);
    assert.equal(new Set(NON_APP_TS_DIRS).size, NON_APP_TS_DIRS.length);
  });

  it("partitions the source roots into the ones with markup and the ones without", () => {
    // `MARKUP_DIRS` arrived on 2026-09-14 as a narrowing with no statement of
    // what it leaves out — which is the shape `NON_APP_TS_DIRS` exists to
    // prevent one level up. A sixth source root can now no longer join the
    // tree and be silently outside every JSX rule.
    const accounted = [...MARKUP_DIRS, ...Object.keys(NON_MARKUP_REASONS)].sort();
    assert.deepEqual(
      accounted,
      [...SOURCE_DIRS].sort(),
      "every source directory is either markup or has a reason it holds none",
    );
    for (const dir of MARKUP_DIRS) {
      assert.ok(
        !(dir in NON_MARKUP_REASONS),
        `${dir} is both a markup root and excused from being one`,
      );
    }
  });

  it("gives every non-markup root a sentence rather than a shrug", () => {
    // Same rule the per-guard exclusion tables are held to, and the same
    // reason: widening or narrowing the set should be a paragraph somebody
    // writes, not a word somebody deletes.
    for (const [dir, why] of Object.entries(NON_MARKUP_REASONS)) {
      assert.ok(why.length >= 25, `${dir}'s reason is too short to be one: ${why}`);
    }
  });

  it("partitions the source roots into code that runs and code that does not", () => {
    // The same claim `MARKUP_DIRS` makes, one level wider, and it arrived for
    // the same reason: three rules had narrowed to app + components + lib
    // separately and each wrote the two exclusions out in its own table.
    const accounted = [...RUNTIME_CODE_DIRS, ...Object.keys(NON_RUNTIME_REASONS)].sort();
    assert.deepEqual(
      accounted,
      [...SOURCE_DIRS].sort(),
      "every source directory either runs on a device or has a reason it does not",
    );
    for (const dir of RUNTIME_CODE_DIRS) {
      assert.ok(
        !(dir in NON_RUNTIME_REASONS),
        `${dir} is both a runtime root and excused from being one`,
      );
    }
  });

  it("nests the two narrowings rather than leaving them unrelated", () => {
    // MARKUP_DIRS ⊆ RUNTIME_CODE_DIRS ⊆ SOURCE_DIRS. Markup is a subset of the
    // code that runs, which is a subset of what this repository holds; a
    // constant that broke that ordering would be describing a different tree.
    assert.ok(MARKUP_DIRS.every((dir) => RUNTIME_CODE_DIRS.includes(dir)));
    assert.ok(RUNTIME_CODE_DIRS.every((dir) => SOURCE_DIRS.includes(dir)));
    assert.ok(
      RUNTIME_CODE_DIRS.length > MARKUP_DIRS.length,
      "two constants naming the same set would be one constant and a synonym",
    );
  });

  it("gives every non-runtime root a sentence rather than a shrug", () => {
    // `scripts/` is the one that has to be said carefully: it RUNS, on a
    // developer's machine and in CI. What these rules are about is code on a
    // user's device, which Metro decides, and Metro never resolves it.
    for (const [dir, why] of Object.entries(NON_RUNTIME_REASONS)) {
      assert.ok(why.length >= 25, `${dir}'s reason is too short to be one: ${why}`);
    }
    assert.match(NON_RUNTIME_REASONS.scripts, /Metro/);
  });

  it("gives the three guards on this walk one floor instead of three", () => {
    // The roots were one statement and the NUMBER was still three, each with a
    // sentence in its note explaining to the reader why it matched the other
    // two. That argument is the constant now.
    const onTheWalk = ["check-inline-hex", "check-reduced-motion", "check-latest-ref"];
    for (const guard of onTheWalk) {
      const count = SCANNED_FLOORS[guard]?.count;
      assert.ok(count, `${guard} declares no count floor`);
      assert.equal(count.minimum, RUNTIME_CODE_WALK_FLOOR, `${guard} should take the shared floor`);
      assert.deepEqual([...count.roots ?? []], [...RUNTIME_CODE_DIRS]);
    }
    // And it is still a floor rather than a ceiling: every root together has
    // to clear it with room, or the number has stopped meaning anything.
    const walked = RUNTIME_CODE_DIRS.reduce((sum, dir) => sum + sourceFiles(dir).length, 0);
    assert.ok(
      walked > RUNTIME_CODE_WALK_FLOOR,
      `the walk is ${walked} files against a floor of ${RUNTIME_CODE_WALK_FLOOR}`,
    );
  });

  it("says every runtime root actually holds source, so the list cannot go stale", () => {
    for (const dir of RUNTIME_CODE_DIRS) {
      assert.ok(sourceFiles(dir).length > 0, `RUNTIME_CODE_DIRS names ${dir}, which holds nothing`);
    }
  });

  it("says every markup root actually holds .tsx, so the list cannot go stale", () => {
    for (const dir of MARKUP_DIRS) {
      assert.ok(tsxFiles(dir).length > 0, `MARKUP_DIRS names ${dir}, which renders nothing`);
    }
  });

  it("names __tests__ as not-app-source, because suite-files.ts owns that walk", () => {
    // Two walks over the same tree, with different rules about depth, is
    // exactly the drift this module exists to end — one directory over.
    assert.ok(NON_APP_TS_DIRS.includes(SUITES_REL));
    assert.ok(!sourceFiles().some((relative) => relative.startsWith(`${SUITES_REL}/`)));
  });
});

describe("no suite walks a source directory by hand", () => {
  /**
   * The rule is the CONJUNCTION, not `readdirSync` alone.
   *
   * Plenty of suites legitimately list a directory — the migration suites walk
   * `supabase/migrations`, the bundle suites walk `dist/`, the guard fixtures
   * build throwaway trees under `mkdtemp`, `fonts-assets` walks `.ttf` files
   * this module would never return. Banning the call outright would have taken
   * thirty exemptions, which is not a rule, it is a list. Banning "walks a
   * directory AND names one of the source directories" is the shape that was
   * actually written eighteen times, and it leaves ten exemptions that each
   * walk something genuinely different.
   *
   * `helpers/source-files.ts` is NOT among them, and did not need to be once
   * the directory list moved to `lib/source-dirs.ts`: the helper takes its
   * roots as an argument, so it walks the source tree without ever naming it.
   * The rule's target was always a suite hardcoding a directory into a walk of
   * its own.
   */
  const SOURCE_DIR_LITERAL = new RegExp(`["'](${SOURCE_DIRS.join("|")})["']`);

  /** Through `suiteCode`, so a doc comment may still quote the shape. */
  const walksSourceByHand = (relative: string): boolean => {
    const code = suiteCode(relative);
    return /\breaddirSync\b/.test(code) && SOURCE_DIR_LITERAL.test(code);
  };

  /**
   * The suites that walk something that is not the source tree at all.
   */
  const WALKS_SOMETHING_ELSE: readonly string[] = [
    "bundle-premise.test.ts",
    "bundle-smoke.test.ts",
    "check-inline-hex.test.ts",
    "env-inlining.test.ts",
    "fonts-assets.test.ts",
    "guard-fixture-refusals.test.ts",
    "helpers/guard-fixture.ts",
    "lint-guard-partial-root.test.ts",
    "runtime-config-parity.test.ts",
    "security-review-wiring.test.ts",
  ];

  it("nothing outside the exempt set walks app/, components/, lib/, data/ or scripts/", () => {
    const offenders = suiteFiles().filter(
      (relative) => !WALKS_SOMETHING_ELSE.includes(relative) && walksSourceByHand(relative),
    );
    assert.deepEqual(
      offenders,
      [],
      `these suites walk a source directory by hand — use __tests__/helpers/source-files.ts instead:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("every exemption is still in the walk and still needs it", () => {
    assertExemptionsHonest({
      exemptions: WALKS_SOMETHING_ELSE,
      expected: [
        "bundle-premise.test.ts",
        "bundle-smoke.test.ts",
        "check-inline-hex.test.ts",
        "env-inlining.test.ts",
        "fonts-assets.test.ts",
        "guard-fixture-refusals.test.ts",
        "helpers/guard-fixture.ts",
        "lint-guard-partial-root.test.ts",
        "runtime-config-parity.test.ts",
        "security-review-wiring.test.ts",
      ],
      rule: "the hand-rolled source-walk",
      stillNeeded: walksSourceByHand,
    });
  });
});
