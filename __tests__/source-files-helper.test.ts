import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { readRepoFile } from "./helpers/repo-file";
import { SUITES_REL, assertExemptionsHonest, suiteCode, suiteFiles } from "./helpers/suite-files";
import { NON_APP_TS_DIRS, SOURCE_DIRS } from "@/lib/source-dirs";

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
