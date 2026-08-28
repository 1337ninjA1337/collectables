import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertNoOffenders,
  assertOnlyTheseMatch,
  matchesRule,
} from "./helpers/offence-sweep";
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
        what: "do the thing",
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
          what: "spell the shape instead of importing it",
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
          what: "offend",
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
        what: "offend",
      }),
    );
  });

  it("takes a compound rule, and offends only when every conjunct matches", () => {
    // The shape three sweeps in this tree could not adopt: an offence that is a
    // conjunction, written as `text.includes(…) && /…/.test(text)` inside a
    // hand-rolled filter and therefore outside both refusals. `also-offends.ts`
    // is the only file with both halves.
    assert.throws(
      () =>
        assertNoOffenders({
          rule: [FORBIDDEN, /worse/],
          files: FILES,
          read,
          subject: "modules",
          what: "do both halves of the thing",
        }),
      /these modules do both halves of the thing: also-offends\.ts$/m,
    );
  });

  it("refuses a g flag on the conjunct that carries it, not on the rule as a whole", () => {
    // What the predicate this replaced would have hidden. A closure over a
    // stateful pattern has nothing in it to read, so the caller would get the
    // helper's two refusals in name only; a list is still every pattern, and
    // the message names the one to fix rather than saying "the rule".
    assert.throws(
      () =>
        assertNoOffenders({
          rule: [FORBIDDEN, /worse/g],
          files: FILES,
          read,
          subject: "modules",
          what: "offend",
        }),
      /carries "g" on worse, so \.test advances lastIndex/,
    );
  });

  it("refuses a rule with no conjuncts at all, which would match everything", () => {
    // A conjunction of nothing is true of everything, so an empty list reports
    // the whole walk. That is loud, and it is loud in the wrong words: the
    // reader gets a list of every file and has to work out that the rule, not
    // the tree, is what changed. A rule reaches this shape by being BUILT — a
    // filtered list of patterns whose source came back empty.
    assert.throws(
      () =>
        assertNoOffenders({
          rule: [],
          files: FILES,
          read,
          subject: "modules",
          what: "offend",
        }),
      /rule has no patterns in it, so it matches every file walked/,
    );
  });

  it("answers the same question through matchesRule, which is what an exemption asks", () => {
    // The two readers a compound rule has: the sweep, and the exemption case
    // asking whether a named hole still needs to be one. Those had been written
    // out separately per sweep — `stillNeeded` restating the conjunction — so a
    // rule tightened in one left the other vouching against the old one.
    assert.equal(matchesRule([FORBIDDEN, /worse/], read("also-offends.ts")), true);
    assert.equal(matchesRule([FORBIDDEN, /worse/], read("offends.ts")), false);
    assert.equal(matchesRule(FORBIDDEN, read("offends.ts")), true);
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
          what: "offend",
        }),
      /carries "g" on FORBIDDEN, so \.test advances lastIndex/,
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
          what: "offend",
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
          what: "offend",
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
          what: "offend",
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
        what: "offend",
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

  it("reports BOTH directions in one failure, each path labelled with its kind", () => {
    // The run where the allowlist is wrong in both directions at once — a file
    // matching that nobody sanctioned, and a sanctioned file that has stopped.
    // Two asserts would stop at the first and show half the answer, so both go
    // through one; the labels are what keep that one from being an object diff
    // the reader has to decode before reaching the sentence under it.
    let error: assert.AssertionError | undefined;
    try {
      assertOnlyTheseMatch({
        rule: FORBIDDEN,
        files: FILES,
        read,
        expected: ["offends.ts", "clean.ts"],
        subject: "modules",
        what: "use the sanctioned form",
      });
    } catch (thrown) {
      error = thrown as assert.AssertionError;
    }
    assert.ok(error !== undefined, "the sweep passed an allowlist wrong both ways");
    assert.deepEqual(error.actual, [
      "unsanctioned, use the sanctioned form: also-offends.ts",
      "sanctioned, no longer does: clean.ts",
    ]);
    assert.deepEqual(error.expected, []);
    assert.match(error.message, /1 unsanctioned modules use the sanctioned form/);
    assert.match(error.message, /1 sanctioned modules no longer do/);
  });
});

describe("the refusals both shapes share", () => {
  /**
   * One check, two vocabularies.
   *
   * The g/y and empty-walk refusals were written out in both exports, word for
   * word apart from one noun each. They are checked in one private helper now,
   * and the nouns that made each message worth reading are still per-shape —
   * which is the property worth a case, because "say it once" is exactly the
   * change that would have flattened them into one abstract sentence.
   */
  it("tells a stateful rule what it would skip, in each shape's own noun", () => {
    assert.throws(
      () =>
        assertNoOffenders({
          rule: /FORBIDDEN/g,
          files: FILES,
          read,
          subject: "modules",
          what: "offend",
        }),
      /the filter skips offenders — drop the g\/y flag/,
    );
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
      /the filter skips matches — drop the g\/y flag/,
    );
  });

  it("tells an empty walk what it proved, which is a different nothing in each shape", () => {
    // The offender shape passes an absence; the allowlist shape passes BOTH
    // halves of a claim. A shared message could only have said one of them.
    assert.throws(
      () =>
        assertNoOffenders({
          rule: FORBIDDEN,
          files: [],
          read,
          subject: "suites",
          what: "offend",
        }),
      /so it would pass against a tree that offends everywhere — the walk stopped matching/,
    );
    assert.throws(
      () =>
        assertOnlyTheseMatch({
          rule: FORBIDDEN,
          files: [],
          read,
          expected: [],
          subject: "suites",
          what: "use the sanctioned form",
        }),
      /so both halves of its claim are about an empty set — the walk stopped matching/,
    );
  });
});

/** The two files that DECLARE the shape, so they are never counted as using it. */
const DECLARING = ["helpers/offence-sweep.ts", "offence-sweep.test.ts"];

/** Every option {@link assertNoOffenders} or {@link assertOnlyTheseMatch} takes. */
const OPTION_KEYS = "rule|files|read|exempt|expected|subject|what";

/** One call site, as much of it as reading collapsed source can honestly recover. */
interface SweepCall {
  /** The `rule:` argument verbatim, or `null` when this walk could not find one. */
  readonly rule: string | null;
  /** Whether the call names a hole, which is what gives its rule a second reader. */
  readonly exempt: boolean;
}

/**
 * The sweep calls in one suite, found by opening bracket rather than by shape.
 *
 * WHY THE TWO STEPS ARE SEPARATE. Finding a call and reading its arguments are
 * different reliabilities: an opening `assertNoOffenders({` is the name of the
 * export followed by two characters, and everything after it is a guess about
 * formatting. Splitting them is what lets a caller this cannot parse be
 * REPORTED — one `SweepCall` with a `null` rule — instead of vanishing from a
 * walk that then declares the tree clean. The previous reader was a single
 * regex anchored on `rule:` immediately followed by `files:`, so a call written
 * with `files` first, or built from a spread options object, was not a call it
 * had ever seen.
 *
 * The rule argument is terminated by the next OPTION key rather than by the
 * next comma, because an inline rule can contain one — `/colors=\{\[\s*
 * HERO_DARK_4\s*,/` did — and a capture stopping there reports a prefix rather
 * than the literal a reader has to go and name. Any key ends it, so argument
 * order is the caller's business.
 */
function sweepCalls(code: string): readonly SweepCall[] {
  const calls: SweepCall[] = [];
  for (const opening of code.matchAll(
    /\b(?:assertNoOffenders|assertOnlyTheseMatch)\(\{/g,
  )) {
    const from = (opening.index ?? 0) + opening[0].length;
    // `suiteCode` strips comments and collapses whitespace, so the whole call
    // arrives on one line and closes at the first `})`. A call this bound cuts
    // in half loses its rule and is reported as unreadable, which is the loud
    // failure rather than the silent one.
    const closes = code.indexOf("})", from);
    const body = code.slice(from, closes === -1 ? code.length : closes);
    // Terminated by the next OPTION key in any of its spellings — `files:`,
    // the shorthand `read,`, or a shorthand `read` sitting last — because a
    // terminator that only knew `key:` swallowed the shorthand and reported
    // `RULE, read` as the rule, which is an identifier that is not one.
    const rule = body.match(
      new RegExp(`\\brule:\\s*(.*?)\\s*(?:,\\s*(?:${OPTION_KEYS})\\s*(?::|,|$)|,?\\s*$)`),
    );
    calls.push({
      rule: rule ? rule[1].trim() : null,
      exempt: new RegExp(`\\bexempt\\s*:`).test(body),
    });
  }
  return calls;
}

/** The suites that sweep through this module, derived rather than listed. */
function adoptingSuites(): readonly string[] {
  return suiteFiles().filter(
    (suite) =>
      !DECLARING.includes(suite) &&
      /\bassertNoOffenders\b|\bassertOnlyTheseMatch\b/.test(suiteCode(suite)),
  );
}

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
    const adopters = adoptingSuites();
    assert.ok(
      adopters.length >= 9,
      `only ${adopters.length} suites sweep through this module (${adopters.join(", ")}) — the floor is 9, and a sweep that went back to walk.filter(...) + deepEqual([]) has given up the stateful-rule and empty-walk refusals`,
    );
  });

  /**
   * Every adopter's rule is a NAMED const, not a literal typed into the call.
   *
   * Not a style preference. A sweep's rule has a second reader — the case
   * asserting the sweep's exempt files still offend, which is the only thing
   * standing between a named hole and a hole nobody notices — and an inline
   * literal cannot be shared with it, so the recipe gets typed a second time
   * and the two drift. `hero-banner.test.ts` had exactly that: the four-line
   * eyebrow recipe written once as the sweep's rule and once in the assert
   * vouching for the exemption, where tightening one leaves the other
   * certifying the hole against a rule the sweep no longer has.
   *
   * The helper's OWN suite is excluded, because its rules are the fixtures: a
   * case about the `g` flag has to hand a `g`-flagged literal straight to the
   * call, and naming each one would move the interesting character away from
   * the assertion that exists to read it.
   */
  it("name their rule, so the sweep and the case policing its holes can share it", () => {
    const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
    const inlined: string[] = [];
    for (const suite of adoptingSuites()) {
      for (const call of sweepCalls(suiteCode(suite))) {
        if (call.rule !== null && !IDENTIFIER.test(call.rule)) {
          inlined.push(`${suite}: ${call.rule}`);
        }
      }
    }
    assert.deepEqual(
      inlined,
      [],
      `these sweeps pass a rule the file cannot name, so the case policing their exempt files has to write the recipe out a second time: ${inlined.join(", ")}`,
    );
  });

  /**
   * The premise the case above stands on, stated as an equality rather than a
   * floor.
   *
   * A reader that stopped matching the call shape reports every sweep clean,
   * which is the failure this whole module exists to refuse, made about itself.
   * That used to be guarded by "at least nine suites matched the shape I read"
   * — a number that WAS the current count, so the first sweep written in an
   * argument order the regex did not know about would have taken the walk from
   * nine to nine and passed.
   *
   * Both halves are derived now. Every suite that names either export must be
   * one this walk found a call in, and every call it found must be one it could
   * read a rule out of: a spread options object, a `files`-first call, or a
   * formatting the `})` bound cuts in half all land in the same list, named.
   * The floor stays where it belongs — on the adopter count, one case up, where
   * the number means adoption rather than parseability.
   */
  it("are all calls this walk can actually read, so a clean report is about something", () => {
    const unreadable: string[] = [];
    for (const suite of adoptingSuites()) {
      const calls = sweepCalls(suiteCode(suite));
      if (calls.length === 0) {
        unreadable.push(`${suite}: names a sweep export and this walk found no call`);
        continue;
      }
      calls.forEach((call, index) => {
        if (call.rule === null) {
          unreadable.push(`${suite}: call ${index + 1} of ${calls.length} has no rule this walk could find`);
        }
      });
    }
    assert.deepEqual(
      unreadable,
      [],
      `these sweeps are invisible to the case that vouches for their rules being named: ${unreadable.join(", ")}`,
    );
  });

  /**
   * A named rule is only worth naming if something else READS it.
   *
   * Naming the rule made sharing possible and nothing checked that it happened:
   * `hero-banner.test.ts` shares its eyebrow recipe between the sweep and the
   * assert vouching for the exemption because that change did it by hand, and
   * the next sweep to name a rule could still write the recipe out a second
   * time in the case below it. So this is the property itself rather than its
   * precondition — a call that names a HOLE must read its rule somewhere else
   * in the suite, because the hole's honesty case is asking the sweep's own
   * question ("would this file still offend") and two copies of the answer
   * drift the moment one is tightened.
   *
   * Only calls carrying `exempt` are held to it. A sweep with no holes has
   * nothing to police, so its rule legitimately has one reader.
   *
   * THE ONE EXEMPTION, and why it is not a loophole. `SOLID_HERO` is policed by
   * what its exempt file PROTECTS rather than by the rule: the component splits
   * the fill from the radius across two style objects, so it cannot match a
   * pattern whose whole subject is the two written together. Sharing the rule
   * there would assert something false. The entry below is held to that being
   * still true — an exempt call whose rule IS shared has stopped needing it.
   */
  it("share a rule with the case policing the hole, wherever the hole can be asked about", () => {
    /** `suite: RULE` whose exemption is honestly policed by something else. */
    const POLICED_OTHERWISE = ["hero-banner.test.ts: SOLID_HERO"];
    const unshared: string[] = [];
    const overPoliced: string[] = [];
    for (const suite of adoptingSuites()) {
      const code = suiteCode(suite);
      const calls = sweepCalls(suiteCode(suite));
      for (const call of calls) {
        if (!call.exempt || call.rule === null) continue;
        if (!/^[A-Za-z_$][\w$]*$/.test(call.rule)) continue;
        // The identifier's readers, minus the one declaration and minus every
        // `rule:` argument naming it: what is left is a SECOND reader.
        const uses = [...code.matchAll(new RegExp(`\\b${call.rule}\\b`, "g"))].length;
        const asRule = calls.filter((other) => other.rule === call.rule).length;
        const shared = uses > 1 + asRule;
        const entry = `${suite}: ${call.rule}`;
        if (POLICED_OTHERWISE.includes(entry)) {
          if (shared) overPoliced.push(entry);
        } else if (!shared) {
          unshared.push(entry);
        }
      }
    }
    assert.deepEqual(
      unshared,
      [],
      `these sweeps name a hole and name a rule and never put the two together, so the case vouching for the hole is asking its own copy of the question: ${unshared.join(", ")}`,
    );
    assert.deepEqual(
      overPoliced,
      [],
      `these entries are recorded as policed by something other than the rule and now read the rule anyway, so the exemption is stale: ${overPoliced.join(", ")}`,
    );
    // The premise: a walk that found no exempt-carrying call would report both
    // directions clean. Four sweeps name holes today; the floor carries one of
    // slack, since deleting an exemption is an ordinary edit and deleting all
    // of them is not.
    const withHoles = adoptingSuites().flatMap((suite) =>
      sweepCalls(suiteCode(suite)).filter((call) => call.exempt),
    );
    assert.ok(
      withHoles.length >= 4,
      `only ${withHoles.length} sweep calls name a hole, so this case is vouching for exemptions it never saw`,
    );
  });
});
