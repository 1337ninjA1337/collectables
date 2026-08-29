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
 * `file !== "lib/x.ts" &&` as a conjunct in a filter predicate, and the two
 * early exits — `if (file === "lib/x.ts") continue;` in a loop, `… return
 * false;` inside a `.filter` callback. The rule's NAME promised the decision
 * and the pattern delivered one syntax for it, so the next hole had three ways
 * out; the widening found eight live ones in six suites, two of them the same
 * decision copied rather than shared. See {@link INLINE_FILE_EXCLUSION}.
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
 * A string literal that names a FILE — a path segment, or a source extension.
 *
 * This is the half that separates a hole from a domain skip, and it is why the
 * second rule is narrower than "an exclusion by literal". Ten exclusions in
 * this tree are written in exactly the banned syntax over a VALUE — `if (code
 * === "en") continue;` in three i18n suites, `mode !== "default" &&` in the
 * render helper, `if (id === "invalid_floor") continue;` in the floor cases —
 * and every one of them is the rule rather than an escape from it: the base
 * locale genuinely has nothing to translate, and naming that would be
 * ceremony. A hole is an exclusion from a WALK, and a walk here yields file
 * paths, so the literal is what tells the two apart.
 */
const FILE_LITERAL = String.raw`[^"]*(?:/[^"]*|\.(?:ts|tsx|js|jsx|json|md|xml|yml|yaml))`;

/**
 * The other three spellings of "drop this file", each excluding one path.
 *
 * `!== "p" &&` catches the conjunct form, because a lone `!==` in a filter is
 * the whole predicate and a predicate that only excludes is a walk narrowing
 * rather than a hole in a rule. The two early exits are caught on the exit
 * keyword, which is what makes them exclusions rather than comparisons.
 *
 * One entry apiece is the point rather than a limitation. `!["a"].includes(x)`
 * is a list, and this is the shape a list GROWS FROM — the metabase hole had
 * one entry too, under a comment in the plural. Naming the first entry is
 * cheap; naming the third, after two people have copied the line, is a
 * refactor nobody does.
 */
const INLINE_FILE_EXCLUSION = new RegExp(
  `!==\\s*"${FILE_LITERAL}"\\s*&&` +
    `|===\\s*"${FILE_LITERAL}"\\s*\\)\\s*(?:continue|return\\s+false)\\s*;`,
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
      rule: INLINE_FILE_EXCLUSION,
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
      INLINE_FILE_EXCLUSION,
      "the exempt suite stopped writing the shape it exists to describe, so the hole is standing open over nothing",
    );
  });

  it("reads all three spellings, and none of the ten value skips written the same way", () => {
    // The three forms the first rule missed, which is the whole reason for the
    // second one.
    assert.match('const x = files.filter((f) => f !== "lib/a.ts" && read(f));', INLINE_FILE_EXCLUSION);
    assert.match('if (file === "lib/sentry.ts") continue;', INLINE_FILE_EXCLUSION);
    assert.match('if (relative === "lib/source-dirs.ts") return false;', INLINE_FILE_EXCLUSION);
    // And the ten that are the rule rather than a hole in it. Same syntax, a
    // literal that names a value instead of a file, so the narrowing is doing
    // the work rather than an exemption list.
    assert.doesNotMatch('if (code === "en") continue;', INLINE_FILE_EXCLUSION);
    assert.doesNotMatch('.filter((m) => m !== "default" && known(m))', INLINE_FILE_EXCLUSION);
    assert.doesNotMatch('if (id === "invalid_floor") continue;', INLINE_FILE_EXCLUSION);
    // A lone `!==` predicate is a narrowed WALK, not a hole in a rule: there is
    // no assertion behind it for the exclusion to be an escape from.
    assert.doesNotMatch('const others = files.filter((f) => f !== "lib/a.ts");', INLINE_FILE_EXCLUSION);
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
   * {@link INLINE_FILE_EXCLUSION} is "this syntax" AND "this literal names a
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
        (match) => !INLINE_FILE_EXCLUSION.test(match[0]),
      ),
    );
    assert.ok(
      skips.length >= 6,
      `only ${skips.length} of ${suiteFiles().length} suites write an exclusion over a value in the syntax this rule reads — the syntax half has stopped matching, so the narrowing below it is deciding nothing (ten at the last count): ${skips.join(", ")}`,
    );
  });
});
