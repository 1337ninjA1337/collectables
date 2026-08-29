import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertNoOffenders } from "./helpers/offence-sweep";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * A hole gets a name, because a hole written at the point of use goes stale in
 * private.
 *
 * Two stale exemptions were found in this tree on 2026-08-28, both by hand and
 * neither by anything that runs. They were the same shape from two directions:
 *
 *   - `privacy-translated-section` exempted the module that DECLARES the hex
 *     width from the sweep banning the width, on reasoning that had stopped
 *     being true — the module builds its pattern from the constant now, and the
 *     only literal left in it sits in a comment the reader strips.
 *   - `metabase-connection-doc` dropped `item_added_users` from its "quoted like
 *     an event but not in the taxonomy" check with
 *     `.filter((name) => !LIST.includes(name))`, LIST spelled inline, under a
 *     comment about "SQL keywords / non-event tokens" in the plural over a list
 *     of one. The guide had not contained the token in some time.
 *
 * The first was findable: the list had a name, the name had a reader, and the
 * sweep helpers now hold a rule's holes against the cases policing them. The
 * SECOND could not be found that way, because there was nothing to hold — an
 * array literal inside a `.filter` is a hole with no name, no declaration, and
 * no place for a reader to attach. It is invisible to every check here and to
 * the reviewer, who reads it as part of the expression rather than as a
 * decision somebody made.
 *
 * So: name it. Naming does not make a hole honest, and it is the precondition
 * for every mechanism in this tree that does — `assertExemptionsHonest` takes a
 * list, the sweep helpers' sharing check reads an identifier, and a const at
 * the top of a suite is a thing a reviewer can count.
 *
 * WHAT THIS DOES NOT BAN. `["a", "b"].includes(x)` un-negated is a membership
 * CHECK — "the value is one of these" — and 24 of them are written inline in
 * this tree, correctly: `web-security-headers` asking whether a directive is
 * `script-src`, `uuid` asking whether a nibble is one of the four legal
 * variants. Those are the assertion, not an escape from it. Only the negated
 * form is an exclusion, and only the exclusion needs the name.
 *
 * THE SECOND RULE, ADDED 2026-08-29. `!` + array literal + `.includes` is ONE
 * spelling of "drop this from the walk", and the metabase hole happened to be
 * written in it. Three others say the same thing and none of them matched:
 * `file !== "lib/x.ts"` in a filter predicate, and the two early exits — `if
 * (file === "lib/x.ts") continue;` in a loop, `… return false;` inside a
 * `.filter` callback. The rule's NAME promised the decision and the pattern
 * delivered one syntax for it, so the next hole had three ways out; the
 * widening found nine live ones in seven suites, two of them the same decision
 * copied rather than shared. `!new Set([…]).has(` is the fourth spelling and is
 * banned unused, because it is the one a reader reaches for the moment the
 * other three are closed. See {@link INLINE_WALK_EXCLUSION}.
 */

/**
 * `![…].includes(…)` — an exclusion whose list is written where it is used.
 *
 * Anchored on the negation, since that is what separates an exclusion from the
 * membership checks above. A list built from anything but string literals
 * already has a name by construction, which is the property being asked for.
 */
const INLINE_EXCLUSION = /!\s*\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]\s*\.\s*includes\s*\(/;

/**
 * A string literal that names something a WALK yields, not a domain value.
 *
 * This is the half that separates a hole from an ordinary skip, and it is why
 * the second rule is narrower than "an exclusion by literal". Ten exclusions in
 * this tree are written in exactly the banned syntax over a VALUE — `if (code
 * === "en") continue;` in three i18n suites, `mode !== "default" &&` in the
 * render helper, `if (id === "invalid_floor") continue;` in the floor cases —
 * and every one of them is the rule rather than an escape from it: the base
 * locale genuinely has nothing to translate, and naming that would be
 * ceremony. A hole is an exclusion from a WALK, so what the walk YIELDS is what
 * tells the two apart.
 *
 * TWO CLASSES, BECAUSE THIS TREE WALKS TWO THINGS (guard ids added 2026-08-29).
 * Most walks here yield paths, and the first version of this rule read only
 * those — which left a live hole standing that the same day's suggestion had
 * to record by hand: `lint-guard-partial-root` narrows the guard table with
 * `walk.checkName !== "check-problem-phrasing-imports"`, an exclusion from a
 * walk whose members are guard NAMES. Every guard in this repository is
 * `check-…`, so that class is as recognisable as a path and needs no
 * judgement. A walk yielding a third kind of member is outside the rule again;
 * the suggestion file carries that, because the alternative is a rule that
 * guesses.
 */
const WALKED_MEMBER = String.raw`[^"]*(?:/[^"]*|\.(?:ts|tsx|js|jsx|json|md|xml|yml|yaml))|check-[a-z0-9-]+`;

/**
 * The other three spellings of "drop this one", each excluding one member.
 *
 * `!== "m"` catches the inequality wherever it stands. It was written `!== "m"
 * &&` for a day, on the reasoning that a LONE `!==` is a whole predicate and so
 * narrows a walk rather than holing a rule — which is a real distinction and
 * was not this rule's to draw: `SINGLE_ROOT_LOCKS` is built by a lone `!==` and
 * is a documented hole in a lock table, and the carve-out was what let it
 * through. Measured across the suites the conjunct requirement was excusing
 * exactly that one site and this file's own fixture, so it bought nothing.
 * The two early exits are caught on the exit keyword, which is what makes them
 * exclusions rather than comparisons; `!new Set([…]).has(` is the fourth
 * spelling, live nowhere today and one character from being reached for — the
 * 36 `!someName.has(` calls in 23 suites are all over NAMED sets and are what
 * the negation is measured against.
 *
 * One entry apiece is the point rather than a limitation. `!["a"].includes(x)`
 * is a list, and this is the shape a list GROWS FROM — the metabase hole had
 * one entry too, under a comment in the plural. Naming the first entry is
 * cheap; naming the third, after two people have copied the line, is a
 * refactor nobody does.
 */
const INLINE_WALK_EXCLUSION = new RegExp(
  `!==\\s*"(?:${WALKED_MEMBER})"` +
    `|===\\s*"(?:${WALKED_MEMBER})"\\s*\\)\\s*(?:continue|return\\s+false)\\s*;` +
    `|!\\s*new\\s+Set\\s*\\(\\s*\\[`,
);

/** This suite, which must write the banned shape in order to assert on it. */
const DECLARING = "inline-exclusion.test.ts";

describe("exclusions are named", () => {
  it("no suite excludes with a list written at the point of use", () => {
    assertNoOffenders({
      rule: INLINE_EXCLUSION,
      files: suiteFiles(),
      read: suiteCode,
      // This file, because its rule IS its fixture: the case below writes the
      // banned spelling out as a string so it can assert the rule reads it, and
      // a sweep that walked its own negative control would report the one file
      // guaranteed to contain the shape. `offence-sweep.test.ts` excludes
      // itself for the same reason. The hole is policed by that case — it fails
      // the moment this file stops containing an example.
      exempt: [DECLARING],
      subject: "suites",
      what: "exclude with an array literal spelled inside the call — lift it into a named const so something can ask whether the entries are still needed",
    });
    assert.match(
      suiteCode(DECLARING),
      INLINE_EXCLUSION,
      "the exempt suite stopped writing the shape it exists to describe, so the hole is standing open over nothing",
    );
  });

  it("no suite drops one file from a walk with the path spelled at the point of use", () => {
    assertNoOffenders({
      rule: INLINE_WALK_EXCLUSION,
      files: suiteFiles(),
      read: suiteCode,
      // Same reason as above, and the same policing: the negative control below
      // writes all three banned spellings out as strings so it can assert the
      // rule reads them, and the case after it fails the moment this file stops
      // containing them.
      exempt: [DECLARING],
      subject: "suites",
      what: "drop a file from their walk with its path written inline — lift it into a named const so something can ask whether the exclusion is still earning its place",
    });
    assert.match(
      suiteCode(DECLARING),
      INLINE_WALK_EXCLUSION,
      "the exempt suite stopped writing the shape it exists to describe, so the hole is standing open over nothing",
    );
  });

  it("reads all four spellings, and none of the ten value skips written the same way", () => {
    // The forms the first rule missed, which is the whole reason for the second
    // one. The lone `!==` is here rather than in the tolerated set below: it was
    // carved out for a day and the carve-out is what left `SINGLE_ROOT_LOCKS`
    // standing.
    assert.match('const x = files.filter((f) => f !== "lib/a.ts" && read(f));', INLINE_WALK_EXCLUSION);
    assert.match('const others = files.filter((f) => f !== "lib/a.ts");', INLINE_WALK_EXCLUSION);
    assert.match('if (file === "lib/sentry.ts") continue;', INLINE_WALK_EXCLUSION);
    assert.match('if (relative === "lib/source-dirs.ts") return false;', INLINE_WALK_EXCLUSION);
    assert.match('walks.filter((w) => w.checkName !== "check-inline-hex")', INLINE_WALK_EXCLUSION);
    assert.match('.filter((f) => !new Set(["a.ts", "b.ts"]).has(f))', INLINE_WALK_EXCLUSION);
    // And the ten that are the rule rather than a hole in it. Same syntax, a
    // literal that names a value instead of a walk member, so the narrowing is
    // doing the work rather than an exemption list.
    assert.doesNotMatch('if (code === "en") continue;', INLINE_WALK_EXCLUSION);
    assert.doesNotMatch('.filter((m) => m !== "default" && known(m))', INLINE_WALK_EXCLUSION);
    assert.doesNotMatch('if (id === "invalid_floor") continue;', INLINE_WALK_EXCLUSION);
    // The 36 negated set reads in this tree, every one over a NAMED set. The
    // fourth spelling is banned on the `new Set([` that follows the negation,
    // not on the negation, so none of them is touched.
    assert.doesNotMatch('const missing = keys.filter((k) => !declared.has(k));', INLINE_WALK_EXCLUSION);
  });

  it("still allows the membership check, which is an assertion rather than a hole", () => {
    // The negative control, and the reason the rule is anchored on `!`. Both
    // spellings appear in this tree; only one of them is a decision to skip
    // something.
    assert.doesNotMatch('if (["script-src"].includes(name)) return;', INLINE_EXCLUSION);
    assert.match('.filter((n) => !["skipped"].includes(n))', INLINE_EXCLUSION);
    // And the multi-entry form, which is what the metabase hole would have
    // grown into rather than being noticed.
    assert.match('!["a", "b", "c"].includes(name)', INLINE_EXCLUSION);
  });

  /**
   * The premise: this sweep is reading suites that contain the shape it allows.
   *
   * A rule anchored on `.includes(` that stopped matching the call spelling
   * would report a clean tree, which is the failure the helper's own refusals
   * exist to prevent one level up — and the empty-walk refusal cannot see it,
   * because the walk is full and the rule is what went blind. The un-negated
   * form is the control: it is written in six suites here, and a scan finding
   * none of them is a scan reading nothing.
   *
   * COUNTED IN SUITES, NOT MATCHES. The floor was 15 over 27 occurrences until
   * 2026-08-29, and 20 of the 27 are written by `web-security-headers` alone —
   * one file was five-sixths of the control, so the floor moved with that
   * file's STYLE rather than with the spelling's currency. Collapsing its
   * twenty checks into a table would have turned this case red with nothing
   * wrong, and every other suite could have dropped the form without it
   * noticing. Six suites, floor four: no single file can carry it or sink it.
   */
  it("is reading a tree that writes the shape, so a clean report means something", () => {
    const MEMBERSHIP = /\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]\s*\.\s*includes\s*\(/;
    const writers = suiteFiles().filter((suite) => MEMBERSHIP.test(suiteCode(suite)));
    assert.ok(
      writers.length >= 4,
      `only ${writers.length} of ${suiteFiles().length} suites write an inline membership check — the spelling this rule reads has moved, so its clean report is about nothing (six at the last count, with slack for two that stop using the form): ${writers.join(", ")}`,
    );
  });

  /**
   * The same premise for the second rule, whose two halves can go blind apart.
   *
   * {@link INLINE_WALK_EXCLUSION} is "this syntax" AND "this literal names a
   * file", and a clean report follows from either half ceasing to match — a
   * prettier rewrap that puts the `&&` on the next line, an exit keyword the
   * tree stops using. The syntax half is the one with a control: ten
   * exclusions over VALUES are written in it, spread across ten suites, and
   * they are deliberately allowed. A run that finds none of them is reading a
   * tree whose spelling has moved, whatever the narrowing then says.
   */
  it("is reading a tree that writes the exclusion syntax over values, which it allows", () => {
    const EXCLUSION_SYNTAX = /!==\s*"[^"]*"\s*&&|===\s*"[^"]*"\s*\)\s*(?:continue|return\s+false)\s*;/g;
    const skips = suiteFiles().filter((suite) =>
      [...suiteCode(suite).matchAll(EXCLUSION_SYNTAX)].some(
        (match) => !INLINE_WALK_EXCLUSION.test(match[0]),
      ),
    );
    assert.ok(
      skips.length >= 6,
      `only ${skips.length} of ${suiteFiles().length} suites write an exclusion over a value in the syntax this rule reads — the syntax half has stopped matching, so the narrowing below it is deciding nothing (ten at the last count): ${skips.join(", ")}`,
    );
  });
});
