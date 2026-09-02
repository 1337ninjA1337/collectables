import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MARKUP_EXTENSIONS,
  NON_APP_TS_DIRS,
  SOURCE_DIRS,
  SOURCE_EXTENSIONS,
} from "@/lib/source-dirs";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";
import { assertExemptionsHonest, SUITES_REL } from "./helpers/suite-files";

/**
 * What the five walking guards under `scripts/` actually look at.
 *
 * Each one narrows `SOURCE_DIRS`, and each narrowing is a real decision — a
 * rule about rendered markup has no business in `scripts/`, and a rule about
 * imports has no business in `data/`. The problem was never the narrowing, it
 * was that nothing recorded it: five guards declared five lists under three
 * different names, they disagreed, and a reader of a green run cannot tell "no
 * offenders" from "did not look there".
 *
 * So the lists are pinned here WITH the reason each one leaves a directory
 * out. The pin is not the interesting half — a hardcoded list matching a
 * hardcoded list proves nothing on its own. What makes it work is the third
 * case: every excluded directory has to carry a sentence, so widening or
 * narrowing a scan is a paragraph somebody has to write rather than a word
 * somebody deletes.
 */

/**
 * Guard → the directories it scans, and why it leaves out what it leaves out.
 *
 * `check-secrets` and `check-bundle-secrets` are deliberately absent: they walk
 * the whole repository including `__tests__` and non-TypeScript files, so
 * `SOURCE_DIRS` is not the list they narrow. `check-env-inlining` reads
 * `lib/*-config.ts` by name rather than walking.
 */
const GUARD_SCANS: Readonly<
  Record<string, { readonly dirs: readonly string[]; readonly excludes: Readonly<Record<string, string>> }>
> = {
  "check-inline-hex": {
    dirs: ["app", "components", "lib"],
    excludes: {
      data: "seed fixtures carry no style values",
      scripts: "build and guard code renders nothing, so a hex there is not a token decision",
    },
  },
  "check-inline-radius": {
    dirs: ["app", "components"],
    excludes: {
      data: "seed fixtures carry no geometry",
      lib: "the tokens themselves live there, and no lib module declares a StyleSheet",
      scripts: "build and guard code renders nothing",
    },
  },
  "check-analytics-imports": {
    dirs: ["app", "components"],
    excludes: {
      data: "seed fixtures do not emit telemetry",
      lib: "`lib/analytics.ts` is the sanctioned importer the rule routes everything through",
      scripts: "build-time code does not emit telemetry",
    },
  },
  "check-clarity-input-mask": {
    dirs: ["app", "components"],
    excludes: {
      data: "seed fixtures render no input",
      lib: "no lib module renders a TextInput",
      scripts: "build and guard code renders nothing",
    },
  },
  "check-a11y-jsx": {
    // The same walk as check-clarity-input-mask, down to the extensions, and
    // it was the guard this table did NOT have — for two months, because the
    // loop below iterates this object and so cannot notice a guard that is
    // absent from it. `guard-registration.test.ts` reads the wrappers instead
    // and found this one and check-console-swap on its first run.
    dirs: ["app", "components"],
    excludes: {
      data: "seed fixtures declare no elements, so there is no unnamed control to find",
      lib: "a lib module returns values rather than markup; an accessibility prop there would have nothing to be on",
      scripts: "build and guard code renders nothing a screen reader will ever reach",
    },
  },
  "check-console-swap": {
    dirs: ["app", "components", "lib", "scripts"],
    excludes: {
      data: "seed fixtures are literals with no statements, so nothing there can assign to console; `__tests__/default-console-seams.test.ts` owns the suites' half of this rule, where the swap is legitimate in exactly one file",
    },
  },
  "check-comment-terminators": {
    // The widest walk in the registry: every root, SOURCE_DIRS entire plus the
    // suites, and therefore no exclusions to explain. The subject is PROSE
    // rather than code that ships — the doc comments this repository opens
    // every module with — and the suites hold more of it than everything else
    // put together, so narrowing to SOURCE_DIRS would leave two thirds of the
    // paragraphs unscanned.
    dirs: ["app", "components", "data", "lib", "scripts", SUITES_REL],
    excludes: {},
  },
  "check-problem-phrasing-imports": {
    // The one guard that WIDENS past SOURCE_DIRS: its subject is how the
    // scanned-floor phrasing parts are imported, and the suites import them
    // more than anything else does.
    dirs: ["app", "components", "lib", "scripts", SUITES_REL],
    excludes: {
      data: "seed fixtures import nothing from the phrasing tables",
    },
  },
};

/** The scan list a guard declares, read out of its source. */
function declaredDirs(guard: string): string[] {
  const source = readRepoFile("scripts", `${guard}.ts`);
  const match = source.match(/const SCANNED_DIRS = \[([^\]]*)\] as const;/);
  assert.ok(match, `${guard} does not declare a SCANNED_DIRS list`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("the guards' scan lists agree with lib/source-dirs.ts", () => {
  it("declares the list this suite pins, in the source and under one name", () => {
    // Three names (`SCANNED_DIRS`, `SCAN_ROOTS`, `SCAN_DIRS`) meant a reader
    // comparing two guards had to notice the rename before noticing the
    // difference. One name, so a diff between two guards is a diff in content.
    for (const [guard, { dirs }] of Object.entries(GUARD_SCANS)) {
      assert.deepEqual(declaredDirs(guard), [...dirs], `${guard} scans a different set`);
    }
  });

  it("scans only directories that hold TypeScript, and accounts for every one it skips", () => {
    // The case that makes the pin above worth having: a directory a guard does
    // not scan must be named with a reason, so `SOURCE_DIRS` gaining an entry
    // turns five guards red rather than leaving five scans quietly narrower.
    const known = new Set([...SOURCE_DIRS, ...NON_APP_TS_DIRS]);
    for (const [guard, { dirs, excludes }] of Object.entries(GUARD_SCANS)) {
      for (const dir of dirs) {
        assert.ok(known.has(dir), `${guard} scans ${dir}, which is in neither list in lib/source-dirs.ts`);
      }
      const accounted = [...dirs, ...Object.keys(excludes)].filter((dir) => SOURCE_DIRS.includes(dir));
      assert.deepEqual(
        [...new Set(accounted)].sort(),
        [...SOURCE_DIRS].sort(),
        `${guard} neither scans nor explains every source directory`,
      );
    }
  });

  it("gives every exclusion a sentence rather than a shrug", () => {
    // "it is not relevant" is not a reason. Each one has to say what the guard
    // is about and why the directory cannot hold it, because that sentence is
    // what a reader checks when the directory changes character.
    for (const [guard, { dirs, excludes }] of Object.entries(GUARD_SCANS)) {
      for (const [dir, why] of Object.entries(excludes)) {
        assert.ok(!dirs.includes(dir), `${guard} both scans and excludes ${dir}`);
        assert.ok(why.length >= 25, `${guard}'s reason for skipping ${dir} is too short to be one: ${why}`);
      }
    }
  });

  it("routes every walking guard through the shared listSourceFiles", () => {
    // The whole point: five copies of the walk, under three names, differing
    // on the extension test, the entry-kind test and whether the caller sorts.
    for (const guard of Object.keys(GUARD_SCANS)) {
      const source = readRepoFile("scripts", `${guard}.ts`);
      assert.match(
        source,
        /listSourceFiles\(repoRoot, SCANNED_DIRS/,
        `${guard} does not call the shared walk`,
      );
      assert.doesNotMatch(
        source,
        /\blistDirEntries\b/,
        `${guard} still walks a directory itself`,
      );
    }
  });

  it("keeps the markup guards on the markup extensions", () => {
    // Two `.tsx`-only scans, and for both the reason is the rule's subject
    // rather than an optimisation: a `.ts` module cannot render a
    // `<TextInput>` or an unnamed icon button, and reporting one would be a
    // finding in a file with no markup in it. This case said "the only" and
    // named one of them until `guard-registration.test.ts` turned up the
    // second — which had the same walk and no entry in this table at all.
    for (const markup of ["check-clarity-input-mask", "check-a11y-jsx"]) {
      assert.match(
        readRepoFile("scripts", `${markup}.ts`),
        /listSourceFiles\(repoRoot, SCANNED_DIRS, MARKUP_EXTENSIONS\)/,
        `${markup} is a markup rule and must walk only .tsx`,
      );
    }
    for (const other of ["check-inline-hex", "check-inline-radius", "check-analytics-imports"]) {
      assert.doesNotMatch(
        readRepoFile("scripts", `${other}.ts`),
        /MARKUP_EXTENSIONS/,
        `${other} is a code rule and must walk .ts too`,
      );
    }
  });
});

/**
 * The module the sweep below is about, and therefore the one file it may skip.
 *
 * "There is exactly one copy of this list" is a rule whose subject writes the
 * copy, so the skip is structural and permanent. Named rather than spelled
 * inside the filter (per `inline-exclusion.test.ts`) and held honest by the
 * case beside the sweep: a skip over a module that stopped declaring the list
 * is a hole standing open for whoever pastes the second copy in.
 */
const DECLARING = "lib/source-dirs.ts";

/**
 * The one guard that has to write the five out, and why it is not a copy.
 *
 * `check-comment-terminators` walks SOURCE_DIRS entire plus the suites, and
 * `declaredDirs` above reads scan lists by PARSING the source for a literal
 * array — a `[...SOURCE_DIRS, …]` spread would satisfy the one-copy rule and
 * defeat the pin that keeps every guard's list readable from its own file. So
 * the five appear there in order, inside a six-element superset, structurally
 * rather than by anyone deciding to restate the list.
 *
 * Named here rather than excused by regex, and held honest below: the day that
 * guard narrows its walk, the entry stops being a superset and the skip stops
 * excusing anything.
 */
const SUPERSET = "scripts/check-comment-terminators.ts";

describe("lib/source-dirs.ts is the one statement of the list", () => {
  it("holds the extension sets the walk takes, and they differ", () => {
    assert.deepEqual([...SOURCE_EXTENSIONS], [".ts", ".tsx"]);
    assert.deepEqual([...MARKUP_EXTENSIONS], [".tsx"]);
    assert.ok(SOURCE_EXTENSIONS.length > MARKUP_EXTENSIONS.length);
  });

  it("is imported by both sides, so neither can drift alone", () => {
    // The guards cannot import from `__tests__/`, which is why the list is in
    // `lib/` rather than beside the suite walk — and the two importers here
    // are what say the split held.
    assert.match(readRepoFile("scripts/guard-io.ts"), /from "\.\.\/lib\/source-dirs"/);
    assert.match(
      readRepoFile("__tests__/helpers/source-files.ts"),
      /from "@\/lib\/source-dirs"/,
    );
  });

  it("is the only module declaring the list, outside its own suites", () => {
    // A second copy of `["app", "components", "data", "lib", "scripts"]`
    // anywhere in the tree is the thing this consolidation removed; the guards
    // declare SUBSETS, which is a different shape and is checked above.
    const offenders = sourceFiles().filter((relative) => {
      if (relative === DECLARING || relative === SUPERSET) return false;
      const code = readRepoFile(relative);
      return /"app",\s*"components",\s*"data",\s*"lib",\s*"scripts"/.test(code);
    });
    assert.deepEqual(offenders, []);
  });

  it("still declares the list it is skipped for declaring", () => {
    // The honesty half of the skip above, through the helper that owns the
    // question. The reason the skip exists — "this module IS the one copy" — is
    // a claim about the file, and the day the list moves out of it the skip
    // stops excusing anything while still excusing the file that would hold the
    // next stray copy.
    assertExemptionsHonest({
      exemptions: [DECLARING, SUPERSET],
      expected: ["lib/source-dirs.ts", "scripts/check-comment-terminators.ts"],
      rule: "the one-copy-of-the-list sweep",
      walk: sourceFiles(),
      stillNeeded: (module) =>
        /"app",\s*"components",\s*"data",\s*"lib",\s*"scripts"/.test(readRepoFile(module)),
    });
  });
});
