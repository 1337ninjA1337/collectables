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
 */

/**
 * `![…].includes(…)` — an exclusion whose list is written where it is used.
 *
 * Anchored on the negation, since that is what separates an exclusion from the
 * membership checks above. A list built from anything but string literals
 * already has a name by construction, which is the property being asked for.
 */
const INLINE_EXCLUSION = /!\s*\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]\s*\.\s*includes\s*\(/;

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
   * form is the control: it is written 24 times here, and a scan finding none
   * of them is a scan reading nothing.
   */
  it("is reading a tree that writes the shape, so a clean report means something", () => {
    const MEMBERSHIP = /\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]\s*\.\s*includes\s*\(/g;
    const found = suiteFiles().flatMap((suite) => [
      ...suiteCode(suite).matchAll(MEMBERSHIP),
    ]);
    assert.ok(
      found.length >= 15,
      `only ${found.length} inline membership checks were found in ${suiteFiles().length} suites — the spelling this rule reads has moved, so its clean report is about nothing (24 at the last count, with slack for a suite that stops using the form)`,
    );
  });
});
