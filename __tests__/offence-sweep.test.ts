import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertNoOffenders, assertOnlyTheseMatch } from "./helpers/offence-sweep";
import { sourceCode, sourceFiles } from "./helpers/source-files";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * The sweep loop four lines long that this tree had written once per scan root.
 *
 * Its callers all point it at a clean tree, so every one of them passes and
 * none exercises a failure — the same gap the declared-shape and console-capture
 * helpers were written against one directory over. The cases below hand it
 * fabricated walks and readers, which is exactly what it takes: `files` and
 * `read` are parameters precisely so the helper can be tested on a tree that
 * does not exist.
 *
 * The two properties worth the helper are the ones no caller could be trusted
 * to remember: a stateful rule skips files, and an empty walk passes every
 * absence. Both are refusals here rather than paragraphs.
 */

/** A three-file tree where exactly one file offends. */
const FILES = ["clean.ts", "offends.ts", "also-offends.ts"];
const CONTENT: Record<string, string> = {
  "clean.ts": "const x = 1;",
  "offends.ts": "const bad = FORBIDDEN;",
  "also-offends.ts": "const worse = FORBIDDEN;",
};
const read = (relative: string): string => CONTENT[relative];
const FORBIDDEN = /FORBIDDEN/;

describe("assertNoOffenders", () => {
  it("passes a walk in which nothing matches", () => {
    assert.doesNotThrow(() =>
      assertNoOffenders({
        rule: FORBIDDEN,
        files: ["clean.ts"],
        read,
        subject: "modules",
        instead: "do the thing",
      }),
    );
  });

  it("names every offender, in the message the caller wrote", () => {
    assert.throws(
      () =>
        assertNoOffenders({
          rule: FORBIDDEN,
          files: FILES,
          read,
          subject: "modules",
          instead: "spell the shape instead of importing it",
        }),
      /these modules spell the shape instead of importing it: offends\.ts, also-offends\.ts/,
    );
  });

  it("skips the exempt ones and reports the rest", () => {
    assert.throws(
      () =>
        assertNoOffenders({
          rule: FORBIDDEN,
          files: FILES,
          read,
          exempt: ["offends.ts"],
          subject: "modules",
          instead: "offend",
        }),
      /these modules offend: also-offends\.ts$/m,
    );
  });

  it("does not care whether an exempt file still offends, which is the other helper's job", () => {
    // The division of labour, pinned: a hole over a file that stopped offending
    // is stale, and noticing that is `assertExemptionsHonest`. This is a loop,
    // and a loop that also judged its exemptions would be two rules in one
    // failure message.
    assert.doesNotThrow(() =>
      assertNoOffenders({
        rule: FORBIDDEN,
        files: ["clean.ts"],
        read,
        exempt: ["clean.ts"],
        subject: "modules",
        instead: "offend",
      }),
    );
  });

  it("refuses a rule carrying a g flag, because .test would skip every other file", () => {
    // The failure this exists to make impossible: `lastIndex` survives between
    // `.test` calls, so a sweep over a hundred files reads about fifty of them
    // and reports the offenders it happened to land on.
    assert.throws(
      () =>
        assertNoOffenders({
          rule: /FORBIDDEN/g,
          files: FILES,
          read,
          subject: "modules",
          instead: "offend",
        }),
      /carries "g", so \.test advances lastIndex/,
    );
  });

  it("refuses a sticky rule for the same reason", () => {
    assert.throws(
      () =>
        assertNoOffenders({
          rule: /FORBIDDEN/y,
          files: FILES,
          read,
          subject: "modules",
          instead: "offend",
        }),
      /advances lastIndex/,
    );
  });

  it("keeps the flags it has no quarrel with", () => {
    // The negative control. Case-insensitivity and multiline carry no state,
    // and a refusal that banned every flag would push callers into building a
    // fresh RegExp per file for no reason.
    assert.throws(
      () =>
        assertNoOffenders({
          rule: /forbidden/i,
          files: FILES,
          read,
          subject: "modules",
          instead: "offend",
        }),
      /these modules offend/,
    );
  });

  it("refuses an empty walk, which would satisfy any absence", () => {
    assert.throws(
      () =>
        assertNoOffenders({
          rule: FORBIDDEN,
          files: [],
          read,
          subject: "suites",
          instead: "offend",
        }),
      /walked no files at all/,
    );
  });

  it("reads through the reader it was given, not off disk", () => {
    // `read` is a parameter because the two shipped callers need different
    // readers — one strips comments and keeps offsets, the other also flattens
    // — and because a helper that opened files itself could not be handed a
    // tree like this one.
    const seen: string[] = [];
    assert.doesNotThrow(() =>
      assertNoOffenders({
        rule: FORBIDDEN,
        files: ["clean.ts"],
        read: (relative) => {
          seen.push(relative);
          return read(relative);
        },
        subject: "modules",
        instead: "offend",
      }),
    );
    assert.deepEqual(seen, ["clean.ts"]);
  });
});

describe("assertOnlyTheseMatch", () => {
  it("passes when exactly the sanctioned files match", () => {
    assert.doesNotThrow(() =>
      assertOnlyTheseMatch({
        rule: FORBIDDEN,
        files: FILES,
        read,
        expected: ["offends.ts", "also-offends.ts"],
        subject: "modules",
        what: "use the sanctioned form",
      }),
    );
  });

  it("names an unsanctioned match", () => {
    assert.throws(
      () =>
        assertOnlyTheseMatch({
          rule: FORBIDDEN,
          files: FILES,
          read,
          expected: ["offends.ts"],
          subject: "modules",
          what: "use the sanctioned form",
        }),
      /also-offends\.ts/,
    );
  });

  it("names a sanctioned file that has STOPPED matching, which the other shape cannot", () => {
    // The half an `exempt` list drops. An allowlist entry that no longer does
    // the thing is a hole standing open, and nothing about it looks stale.
    assert.throws(
      () =>
        assertOnlyTheseMatch({
          rule: FORBIDDEN,
          files: FILES,
          read,
          expected: ["offends.ts", "also-offends.ts", "clean.ts"],
          subject: "modules",
          what: "use the sanctioned form",
        }),
      /clean\.ts/,
    );
  });

  it("refuses an expected file the walk never reaches", () => {
    // A claim about a file nobody reads is a claim about nothing, and it is
    // the failure mode this shape has that the offender shape does not: the
    // walk narrows, the allowlist keeps naming a path outside it, and the
    // sweep goes on passing.
    assert.throws(
      () =>
        assertOnlyTheseMatch({
          rule: FORBIDDEN,
          files: ["clean.ts"],
          read,
          expected: ["offends.ts"],
          subject: "modules",
          what: "use the sanctioned form",
        }),
      /not in the walk at all/,
    );
  });

  it("refuses a stateful rule and an empty walk, like its sibling", () => {
    assert.throws(
      () =>
        assertOnlyTheseMatch({
          rule: /FORBIDDEN/g,
          files: FILES,
          read,
          expected: ["offends.ts", "also-offends.ts"],
          subject: "modules",
          what: "use the sanctioned form",
        }),
      /lastIndex/,
    );
    assert.throws(
      () =>
        assertOnlyTheseMatch({
          rule: FORBIDDEN,
          files: [],
          read,
          expected: [],
          subject: "modules",
          what: "use the sanctioned form",
        }),
      /walked no files/,
    );
  });
});

describe("the sweeps built on it", () => {
  /**
   * The two shipped walks, asserted to be non-empty here as well as inside the
   * helper.
   *
   * The helper's own refusal fires at the call site that uses a broken walk,
   * which is the right place for it and is one case per caller. This says the
   * two walks this repo actually has are populated, so a `sourceFiles()` that
   * started returning nothing is one failure with a name rather than a refusal
   * from whichever sweep happened to run first.
   */
  it("walk a tree that is really there", () => {
    assert.ok(sourceFiles().length > 0, "sourceFiles() walked no application source");
    assert.ok(suiteFiles().length > 0, "suiteFiles() walked no suites");
    // And the readers answer for a file from each, so a walk that returns paths
    // no reader can open is not mistaken for a clean sweep.
    assert.ok(sourceCode(sourceFiles()[0]).length > 0);
    assert.ok(suiteCode(suiteFiles()[0]).length > 0);
  });

  /**
   * How many of them there are, recorded rather than remembered.
   *
   * `walk.filter((f) => RULE.test(read(f)))` then `deepEqual(offenders, [])` is
   * the shape most structural rules in this tree take, and for a day exactly
   * one pair went through the helper while the rest carried the two hazards it
   * refuses with nothing saying so. The number is a floor rather than an
   * equality: a rule DELETED is a real outcome and should not fail here, while
   * a rule quietly rewritten back into the four lines should. The list is
   * derived — a suite that imports the helper is an adopter — so a new one
   * counts without being added anywhere.
   */
  it("are counted, so the adoption is a number rather than a memory", () => {
    const DECLARING = ["helpers/offence-sweep.ts", "offence-sweep.test.ts"];
    const adopters = suiteFiles().filter(
      (suite) =>
        !DECLARING.includes(suite) &&
        /\bassertNoOffenders\b|\bassertOnlyTheseMatch\b/.test(suiteCode(suite)),
    );
    assert.ok(
      adopters.length >= 8,
      `only ${adopters.length} suites sweep through this module (${adopters.join(", ")}) — the floor is 8, and a sweep that went back to walk.filter(...) + deepEqual([]) has given up the stateful-rule and empty-walk refusals`,
    );
  });
});
