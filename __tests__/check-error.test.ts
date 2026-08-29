import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHECK_ERROR_PREFIX, checkError } from "@/lib/check-error";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";
import { assertExemptionsHonest } from "./helpers/suite-files";

/**
 * The line every build-time guard refuses in, and the sweep that keeps it one
 * line.
 *
 * `<check-name>: ERROR — <prose>` was spelled out at nineteen sites in eleven
 * modules. The convention is load-bearing in two ways that no single copy shows:
 * the check name comes FIRST, so a log holding four guards' output can be read
 * by guard, and the em dash separates a machine-readable prefix from a sentence.
 * Nineteen copies is nineteen chances to write `ERROR: ` or drop the name, and
 * the result is not a broken build — it is a line that scrolls past looking
 * almost right.
 */

/**
 * The helper module, which the adoption floor has to skip: it spells
 * `checkError(` in its own signature and would otherwise count as its own first
 * caller.
 *
 * Until 2026-08-29 the path was written inline in TWO sweeps, in two different
 * spellings — `if (file === "lib/check-error.ts") return false;` in the offender
 * filter and `file !== "lib/check-error.ts" &&` in the floor. One decision in
 * two spellings, neither declared, is the drift `inline-exclusion.test.ts` bans,
 * and it had already happened here: the first skip was stale (see the offender
 * sweep's own note) while the second was live, and nothing could tell them
 * apart because neither was a thing a reader could ask about.
 */
const HELPER = "lib/check-error.ts";

describe("checkError", () => {
  it("puts the check name first, then the separator, then the prose", () => {
    assert.equal(
      checkError("check-privacy-baseline-provenance", "the table is empty."),
      "check-privacy-baseline-provenance: ERROR — the table is empty.",
    );
  });

  it("is the em dash and not a hyphen, which is what a grep would miss", () => {
    // The two are indistinguishable at a glance and not to a `grep -F`. Pinned
    // by codepoint rather than by pasting the character into an assertion,
    // because pasting it is exactly how the wrong one arrives.
    assert.equal(CHECK_ERROR_PREFIX, `: ERROR — `);
    assert.ok(!CHECK_ERROR_PREFIX.includes("-"));
  });

  it("does not punctuate or capitalise for the caller", () => {
    // Callers pass a whole finding, and several of them look their phrasing up
    // in a table. A helper that appended a full stop would double it on most of
    // them and be wrong on the ones ending in a path.
    assert.equal(checkError("g", "lib/x.ts moved"), "g: ERROR — lib/x.ts moved");
  });
});

/**
 * A refusal line BUILT rather than mentioned.
 *
 * The first version of this sweep asked whether a module's source contains the
 * separator anywhere, which is the offence plus two things that are not: a
 * fixture that quotes a guard's output, and a module documenting the convention
 * itself. `lib/provenance-key-set.ts` misses being reported only because its
 * mention sits in a comment that `stripComments` removes — a mention inside a
 * real string would have read as a hand-built line.
 *
 * What a hand-built line actually looks like is the prefix with a NAME in front
 * of it, and there are two ways to write that: interpolate one
 * (`` `${checkName}: ERROR — …` ``, which is all nineteen of the sites this
 * replaced) or spell one (`"guard: ERROR — …"`). Both are matched; a bare
 * mention of the separator with no name before it is not.
 *
 * A NAME, not any token. The first narrowing of this rule asked for `[\w-]+`,
 * which is also the shape of a line number: `  1: ERROR — …` inside a quoted
 * compiler diagnostic — the single most likely thing for a fixture in this tree
 * to hold — read as a hand-built refusal. A check name here is `check-…` or
 * some other identifier, so it starts with a letter and is at least two
 * characters; digits alone are a coordinate, not a guard.
 *
 * Exported to the cases below rather than inlined in the filter, because a
 * sweep's rule is worth testing against strings a walk over a healthy tree can
 * never produce.
 */
export function buildsARefusalByHand(source: string): boolean {
  // `${…}: ERROR — ` (interpolated name) or `<name>: ERROR — ` (spelled name),
  // where a name starts with a letter and is two or more characters long.
  return /(\$\{[^}]*\}|[A-Za-z][\w-]+)(?=: ERROR — )/.test(source);
}

describe("the sweep's own rule", () => {
  it("reports a line built from an interpolated check name", () => {
    assert.ok(buildsARefusalByHand("return `${checkName}: ERROR — nope`;"));
  });

  it("reports a line built from a spelled check name", () => {
    assert.ok(buildsARefusalByHand('throw new Error("my-guard: ERROR — nope");'));
  });

  it("tolerates a module that MENTIONS the convention without building one", () => {
    // The two shapes the first version of this sweep would have reported: a
    // module explaining the format, and a fixture holding a guard's output for
    // a case to assert against. Neither is a second copy of the formatter.
    assert.ok(!buildsARefusalByHand('const FORMAT = ": ERROR — ";'));
    assert.ok(!buildsARefusalByHand('expect(out).toContain(": ERROR — ");'));
  });

  it("tolerates a line NUMBER before the separator, which is not a check name", () => {
    // What `[\w-]+` also matches: the left-hand side of a quoted compiler
    // diagnostic. A guard that reported the output it had just refused over
    // would have been reported for refusing, which is the failure mode this
    // sweep exists to avoid — a rule collecting exceptions instead of stating
    // a shape.
    assert.ok(!buildsARefusalByHand('const out = "  1: ERROR — not assignable";'));
    assert.ok(!buildsARefusalByHand('const diag = "lib/x.ts:12: ERROR — bad";'));
  });

  it("still reports a name that merely CONTAINS digits", () => {
    // The narrowing is "starts with a letter", not "has no digits" — a guard
    // named `check-i18n` is a name and must stay an offender.
    assert.ok(buildsARefusalByHand('fail("check-i18n: ERROR — nope");'));
  });
});

describe("the guards that print refusals", () => {
  /**
   * Every module that builds a refusal line by hand, found rather than listed.
   *
   * The population is the offence itself, so a module that stopped refusing
   * anything drops out on its own and a twelfth guard is covered without being
   * added to anything.
   *
   * THE HELPER IS NOT SKIPPED HERE, AND HAD BEEN SINCE IT STOPPED NEEDING TO
   * BE (removed 2026-08-29). `buildsARefusalByHand` asks for a NAME in front of
   * the separator, and `lib/check-error.ts` has never written one — it declares
   * `CHECK_ERROR_PREFIX = ": ERROR — "` bare and interpolates the caller's name
   * around it. The skip was correct against the first version of this rule,
   * which asked whether a module's source contains the separator at all; the
   * narrowing that made the rule about a BUILT line rather than a mentioned one
   * left it behind, excusing nothing, in the one file where a second hand-built
   * line would be least conspicuous. It falls out of the population on its own
   * merits now, which is what the doc block above claims for every module.
   */
  const OFFENDERS = sourceFiles("lib", "scripts").filter((file) =>
    buildsARefusalByHand(stripComments(readRepoFile(file))),
  );

  it("build the line through the helper, not by hand", () => {
    assert.deepEqual(
      OFFENDERS,
      [],
      `these modules spell the guard refusal prefix themselves instead of calling checkError: ${OFFENDERS.join(", ")}`,
    );
  });

  it("still refuse things, so the sweep above is not passing over silence", () => {
    // The positive control the sweep needs: it looks for a string's ABSENCE, and
    // a tree where nothing refuses anything would satisfy it perfectly. Eleven
    // modules called the helper on the run that introduced it; the floor is
    // argued at eight so ordinary consolidation does not have to be ratified,
    // and a collapse to nothing is caught.
    const callers = sourceFiles("lib", "scripts").filter(
      (file) =>
        file !== HELPER &&
        stripComments(readRepoFile(file)).includes("checkError("),
    );
    assert.ok(
      callers.length >= 8,
      `only ${String(callers.length)} module(s) build a refusal through checkError — the sweep above is reading a tree that stopped refusing things: ${callers.join(", ")}`,
    );
  });

  it("keeps the helper a leaf, because every guard module would import it", () => {
    assert.ok(
      !/^\s*import\s/m.test(stripComments(readRepoFile(HELPER))),
      "lib/check-error.ts has grown an import — it is reached from eleven guard modules and a build script, and may depend on nothing",
    );
  });

  it("is still skipped by the adoption floor for the reason it is skipped", () => {
    // The half neither inline copy could have, and the half that found the
    // stale one: both skips rested on the sentence "it is the helper", which is
    // a claim about the FILE and expires quietly when a rule around it moves.
    // Through the shared helper, which is where this tree keeps the "is this
    // hole still needed" question — a one-entry hole is as entitled to it as a
    // list, and `expected` is the tripwire that keeps the widening visible.
    assertExemptionsHonest({
      exemptions: [HELPER],
      expected: ["lib/check-error.ts"],
      rule: "the checkError adoption floor",
      walk: sourceFiles("lib", "scripts"),
      stillNeeded: (module) => stripComments(readRepoFile(module)).includes("checkError("),
    });
    assert.ok(
      !buildsARefusalByHand(stripComments(readRepoFile(HELPER))),
      `${HELPER} has started building a refusal line by hand — the offender sweep above no longer skips it (the skip was stale from the day the rule asked for a name), so this is now a real finding in the module that exists to prevent it`,
    );
  });
});
