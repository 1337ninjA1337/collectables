import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { captureConsole } from "./helpers/capture-console";
import { sourceCode, sourceFiles } from "./helpers/source-files";
import { suiteCode, topLevelSuites } from "./helpers/suite-files";

/**
 * A seam that defaults to the global console, and the overload nobody calls.
 *
 * The shape: a function that logs takes its console as a parameter defaulted to
 * the real one — `out: Pick<Console, "log" | "error"> = console` — so a case can
 * be the console. Then every case is, and the DEFAULT goes unexercised. Which
 * means the spelling that runs in production is the one with no cover at all:
 * it could name a method the console does not have, could be dropped in favour
 * of a required parameter, could be changed to `console.error` for both
 * streams, and the suite beside it stays green while the guard prints nothing
 * and the dev build crashes on its first debug line.
 *
 * It is not a hypothetical failure mode; it is what both seams in this tree
 * looked like this morning. `printProvenanceOutput`'s default is what
 * `npm run lint:baseline-provenance` prints through, and `createDevLogger`'s is
 * what the app-wide `devLog` is built from — neither had a case that omitted
 * the argument.
 *
 * WHY A SWEEP AND NOT TWO CASES. Two cases fix today's two. The rule is that a
 * THIRD seam cannot arrive without one, and the population is derivable: a
 * defaulted console parameter is a distinctive line, so the modules that have
 * one can be found rather than listed. What cannot be derived is "the default
 * is exercised" — no static read tells you a case omitted an argument — so the
 * rule asks for the closest observable proxy: the module's suite reaches for
 * {@link captureConsole}, which is the only way in this tree to watch the
 * global console. A suite that imports it and asserts nothing is a way to pass
 * this dishonestly; a suite that never imports it is a seam with no cover, and
 * that is the state the sweep exists to catch.
 */

/**
 * `= console` on a parameter, whatever the parameter is called or typed.
 *
 * Bounded by `[^\n=]` rather than by `[^,()]`: both seams today are typed
 * `Pick<Console, "log" | "error">`, so a comma and a pair of angle brackets sit
 * between the colon and the default, and a character class that excluded commas
 * matched neither of them.
 */
const DEFAULTS_TO_CONSOLE = /:\s*[^\n=]*Console[^\n=]*=\s*console\s*[,)]/;

/** Modules declaring a console-defaulted parameter, found rather than listed. */
const SEAMS = sourceFiles("lib", "scripts").filter((file) =>
  DEFAULTS_TO_CONSOLE.test(sourceCode(file)),
);

/** `../lib/safe-log` and `@/lib/safe-log` both name `lib/safe-log.ts`. */
function importsModule(suite: string, module: string): boolean {
  const stem = module.replace(/^lib\//, "").replace(/\.ts$/, "");
  return new RegExp(`from\\s+"(?:\\.\\./lib|@/lib)/${stem}"`).test(
    suiteCode(suite),
  );
}

describe("a console-defaulted seam", () => {
  it("is a shape this tree still has, so the rule below is not swept over nothing", () => {
    // The positive control. This sweep reads an ABSENCE — no seam without
    // cover — and a tree with no seams at all would satisfy it perfectly. Two
    // is the count today and the floor, because a seam being REMOVED is a real
    // outcome (the parameter becomes required) and should not be ratified here;
    // what must not happen silently is the set emptying.
    assert.ok(
      SEAMS.length >= 1,
      `no module declares a console-defaulted parameter any more — either the seams became required parameters, in which case delete this suite, or the pattern stopped matching: ${DEFAULTS_TO_CONSOLE.source}`,
    );
  });

  it("has a suite that watches the real console, not only the parameter", () => {
    const uncovered = SEAMS.filter((seam) => {
      const suites = topLevelSuites().filter((suite) =>
        importsModule(suite, seam),
      );
      return !suites.some((suite) => suiteCode(suite).includes("captureConsole"));
    });
    assert.deepEqual(
      uncovered,
      [],
      `these modules default a console parameter and no suite of theirs calls captureConsole, so the overload that runs in production is the one with no case: ${uncovered.join(", ")}`,
    );
  });

  it("is watched by a helper that gives the console back", () => {
    // The one thing that makes this helper worse than the gap it closes: a
    // callback that throws, leaving the runner with a console that pushes into
    // a dead array. Asserted rather than trusted to the `finally` being read.
    const before = console.log;
    assert.throws(() => {
      captureConsole(() => {
        throw new Error("boom");
      });
    }, /boom/);
    assert.equal(
      console.log,
      before,
      "captureConsole did not restore console.log after a throwing callback",
    );
  });

  it("is watched by a helper that reports what was written, per stream", () => {
    const written = captureConsole(() => {
      console.log("one", "two");
      console.error("bad");
    });
    // Joined the way the console joins them, so a caller that spreads several
    // values into one call reads back as one line rather than as three.
    assert.deepEqual(written.log, ["one two"]);
    assert.deepEqual(written.error, ["bad"]);
  });
});
