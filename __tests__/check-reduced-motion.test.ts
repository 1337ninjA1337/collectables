import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MOTION_DRIVERS,
  REDUCED_MOTION_MODULE,
  REDUCED_MOTION_OWNER,
  consultsReducedMotion,
  findMotionDrivers,
  findUnaskedAnimations,
  formatReducedMotionReport,
  reducedMotionAnnotations,
} from "@/lib/check-reduced-motion";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_GUARDS } from "@/lib/lint-guards";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/**
 * The scanner behind `npm run lint:reduced-motion`.
 *
 * It refuses a file under `app/`, `components/` or `lib/` that drives an
 * `Animated.*` animation without `@/lib/reduced-motion` in scope — the floor
 * under the four surfaces taught to consult the setting on 2026-09-17, which
 * until now were held in place by a list of four filenames typed into
 * `reduced-motion.test.ts`.
 *
 * FIXTURES ARE SPELLED OUT here, unlike the jsx-walk suite's, because the
 * guard's scan roots are `app/`, `components/` and `lib/` and this file is in
 * none of them. `__tests__/` is deliberately outside the rule: a suite's
 * fixture is allowed to name a driver, and this suite is the proof that it
 * needs to.
 */

/** A file that animates and never asks. */
const UNASKED = [
  'import { Animated } from "react-native";',
  "",
  "export function Banner() {",
  "  Animated.timing(value, { toValue: 1, duration: 220 }).start();",
  "  return null;",
  "}",
].join("\n");

/** The same file, corrected. */
const ASKED = [
  'import { Animated } from "react-native";',
  'import { motionDuration, useReducedMotion } from "@/lib/reduced-motion";',
  "",
  "export function Banner() {",
  "  const reduced = useReducedMotion();",
  "  Animated.timing(value, { toValue: 1, duration: motionDuration(220, reduced) }).start();",
  "  return null;",
  "}",
].join("\n");

describe("findMotionDrivers — what counts as an animation", () => {
  it("matches every driver in MOTION_DRIVERS", () => {
    // The list is exported so this case can state it rather than re-type it:
    // a second copy of the names here would make this a case about itself.
    for (const driver of MOTION_DRIVERS) {
      const found = findMotionDrivers("a.tsx", `Animated.${driver}(value, {}).start();`);
      assert.equal(found.length, 1, `Animated.${driver}( must be a driver`);
      assert.equal(found[0].driver, driver);
    }
  });

  it("tolerates the whitespace a formatter can introduce", () => {
    assert.equal(findMotionDrivers("a.tsx", "Animated . loop (anim);").length, 1);
  });

  it("does not match the combinators, which only arrange drivers", () => {
    // A file holding one holds a driver too, so naming them would add no
    // coverage and one more thing to keep in step.
    for (const combinator of ["sequence", "parallel", "stagger"]) {
      assert.equal(
        findMotionDrivers("a.tsx", `Animated.${combinator}([a, b]).start();`).length,
        0,
        `Animated.${combinator} is not a driver`,
      );
    }
  });

  it("ignores a driver named in prose", () => {
    // This module's own header names three of the four, lib/reduced-motion.ts
    // names two, and components/skeleton.tsx quotes Animated.loop to explain
    // its early return. A rule that read comments would report every file that
    // documents itself.
    const source = [
      "// Animated.loop of a 0ms timing never stops.",
      "/** Animated.spring is a spring even at zero. */",
      "export const nothing = 1;",
    ].join("\n");
    assert.deepEqual(findMotionDrivers("a.ts", source), []);
  });

  it("reports the real line and column, after the comment strip", () => {
    const source = ["/**", " * Animated.timing is the common one.", " */", "", UNASKED].join("\n");
    const [finding] = findMotionDrivers("components/banner.tsx", source);
    assert.equal(finding.line, 8, "the blanked comment must not shift the offsets");
    assert.equal(finding.column, 3);
    assert.equal(source.split("\n")[finding.line - 1].trim().startsWith("Animated.timing"), true);
  });

  it("does not match a member of something that is not Animated", () => {
    assert.deepEqual(findMotionDrivers("a.ts", "Easing.timing(1);"), []);
    assert.deepEqual(findMotionDrivers("a.ts", "NotAnimated.timing(1);"), []);
  });
});

describe("consultsReducedMotion — has the author been handed the question", () => {
  it("accepts the alias and the relative spellings", () => {
    for (const specifier of [
      "@/lib/reduced-motion",
      "../lib/reduced-motion",
      "./reduced-motion",
    ]) {
      assert.equal(
        consultsReducedMotion(`import { useReducedMotion } from "${specifier}";`),
        true,
        `${specifier} is the module`,
      );
    }
  });

  it("does not accept a longer name that merely starts the same way", () => {
    assert.equal(
      consultsReducedMotion('import x from "@/lib/reduced-motion-legacy";'),
      false,
    );
  });

  it("does not accept the module named in a comment", () => {
    assert.equal(consultsReducedMotion('// from "@/lib/reduced-motion"'), false);
  });
});

describe("findUnaskedAnimations — the rule", () => {
  it("reports an animation in a file that never imports the module", () => {
    const found = findUnaskedAnimations("components/banner.tsx", UNASKED);
    assert.equal(found.length, 1);
    assert.equal(found[0].file, "components/banner.tsx");
    assert.equal(found[0].driver, "timing");
  });

  it("reports nothing once the file consults the setting", () => {
    assert.deepEqual(findUnaskedAnimations("components/banner.tsx", ASKED), []);
  });

  it("says nothing about a file that imports the module and animates nothing", () => {
    assert.deepEqual(
      findUnaskedAnimations("lib/x.ts", 'import { motionDuration } from "@/lib/reduced-motion";'),
      [],
    );
  });

  it("is the import and not the usage, deliberately", () => {
    // There are three right answers — a zero duration, a setValue, an early
    // return — and a text scan cannot tell which one a surface needed. What it
    // can say is that the author was handed the question.
    const importedButUnused = [
      'import { Animated } from "react-native";',
      'import { motionDuration } from "@/lib/reduced-motion";',
      "Animated.spring(value, { toValue: 0 }).start();",
    ].join("\n");
    assert.deepEqual(findUnaskedAnimations("components/x.tsx", importedButUnused), []);
  });
});

describe("the report and its annotations", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatReducedMotionReport([]), "");
    assert.deepEqual(reducedMotionAnnotations([]), []);
  });

  it("counts the animations and the files, and names the module and all three shapes", () => {
    const findings = [
      ...findUnaskedAnimations("components/banner.tsx", UNASKED),
      ...findUnaskedAnimations("app/x.tsx", UNASKED),
    ];
    const report = formatReducedMotionReport(findings);
    assert.match(report, /Found 2 animation\(s\) in 2 file\(s\)/);
    assert.ok(report.includes(REDUCED_MOTION_OWNER));
    assert.match(report, /motionDuration/);
    assert.match(report, /setValue/);
    assert.match(report, /early return for a loop/);
    assert.match(report, /components\/banner\.tsx:4:3/);
  });

  it("emits one well-formed annotation per animation", () => {
    const findings = findUnaskedAnimations("components/banner.tsx", UNASKED);
    const lines = reducedMotionAnnotations(findings);
    assert.equal(lines.length, 1);
    assert.ok(isAnnotationLine(lines[0]));
    assert.match(lines[0], /file=components\/banner\.tsx,line=4,col=3/);
  });
});

describe("the guard is wired in, and its subject is still there", () => {
  it("is a LINT_GUARDS entry pointing at its own wrapper", () => {
    const guard = LINT_GUARDS.find((g) => g.npmScript === "lint:reduced-motion");
    assert.ok(guard, "lint:reduced-motion must be in the registry so lint:all runs it");
    assert.equal(guard.scriptPath, "scripts/check-reduced-motion.ts");
  });

  it("declares a scanned floor over the roots its wrapper walks", () => {
    const floor = SCANNED_FLOORS["check-reduced-motion"];
    assert.ok(floor?.count, "a walk with no floor proves its negative over any tree");
    assert.deepEqual(floor.count.roots, ["app", "components", "lib"]);
    const wrapper = readRepoFile("scripts/check-reduced-motion.ts");
    assert.match(wrapper, /const SCANNED_DIRS = \["app", "components", "lib"\] as const;/);
  });

  it("refuses a run that recognised no animation at all", () => {
    // Every pattern here is a spelling of one library's API. The day this app
    // moves to Reanimated's withTiming they all stop matching at once, and a
    // clean report over a tree full of unguarded motion is the failure a floor
    // exists to catch.
    const wrapper = readRepoFile("scripts/check-reduced-motion.ts");
    assert.match(wrapper, /if \(animated < MOTION_FLOOR\)/);
    assert.match(wrapper, /lost its subject/);
  });

  it("finds every animated file in the tree, and every one of them asks", () => {
    // The list the sweep typed by hand, DERIVED instead — which is the whole
    // point of the guard. A fifth surface is a failure here rather than a
    // filename somebody forgot to add to an array.
    const files = sourceFiles("app", "components", "lib");
    const animated = files.filter((file) => findMotionDrivers(file, readRepoFile(file)).length > 0);
    assert.ok(
      animated.length > 0,
      "no Animated.timing/spring/decay/loop matched anywhere — the rule has lost its subject",
    );
    const unasked = animated.flatMap((file) => findUnaskedAnimations(file, readRepoFile(file)));
    assert.deepEqual(
      unasked.map((f) => `${f.file}:${f.line}`),
      [],
      "every animated surface must consult @/lib/reduced-motion",
    );
  });

  it("names the module by the suffix its owner actually has", () => {
    assert.equal(REDUCED_MOTION_MODULE, "reduced-motion");
    assert.equal(REDUCED_MOTION_OWNER, "@/lib/reduced-motion");
    assert.ok(readRepoFile("lib/reduced-motion.ts").includes("export function useReducedMotion"));
  });
});
