/**
 * One walk, one reader, one rule: the sweep shape this tree writes over and
 * over.
 *
 * A structural rule here is almost always the same four lines — walk a set of
 * files, read each one with comments stripped, `.test` a pattern, report the
 * ones that matched — and the four lines had been written per scan root. The
 * hex-width rule was the case that made it obvious: the identical offence
 * pattern swept twice, once over `lib`/`scripts` with a path exclusion and once
 * over the suites with a named exemption list, the two cases differing only in
 * which walk they called. A third root would have been a third copy.
 *
 * WHAT THIS ADDS THAT A COPY CANNOT. Two properties every caller now gets by
 * construction rather than by remembering:
 *
 *   1. **The rule may not carry state.** A `g` or `y` flag makes `.test`
 *      advance `lastIndex` between calls, so a pattern reused across a filter
 *      SKIPS offenders — every other file, in the worst case — and the sweep
 *      goes green while the rule reads half the tree. Two shared patterns in
 *      this repo were flagless by luck and said so only in prose; here it is
 *      refused.
 *   2. **The walk may not be empty.** A sweep asserts an ABSENCE, and an empty
 *      file list satisfies any absence perfectly. A walk that stops matching —
 *      a renamed directory, a filter that got too clever — otherwise reads as a
 *      clean tree.
 *
 * TWO SHAPES, BECAUSE THE SWEEPS ASK TWO QUESTIONS. {@link assertNoOffenders}
 * is "nobody does this". {@link assertOnlyTheseMatch} is "these files do this
 * and no others" — the allowlist shape, which three sweeps here had written as
 * a sorted `deepEqual` and which carries a third hazard of its own (an
 * expected entry the walk never reaches). They are two exports rather than one
 * option, because folding them together would make one name mean two rules.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not decide the offence, own the
 * exemption LIST, or know what any rule means. `assertExemptionsHonest` in
 * `helpers/suite-files.ts` still holds the "is this hole still needed" half,
 * because an exemption is a recorded human decision and this is a loop.
 */

import assert from "node:assert/strict";

/**
 * The two refusals both shapes owe their caller, checked once.
 *
 * Both exports opened with the same two `assert.ok`s written out word for word,
 * differing in one noun apiece — a stateful rule "skips offenders" in one and
 * "skips matches" in the other; an empty walk "would pass against a tree that
 * offends everywhere" in one and leaves "both halves of its claim about an
 * empty set" in the other. Two copies of a refusal is the shape this module was
 * written to end, one level down from where it ends it.
 *
 * The nouns stay parameters rather than being generalised away. They are the
 * only place each shape's failure is phrased in its own terms, and a reader who
 * meets one of these messages is reading it because their sweep is broken in a
 * way they did not anticipate — a message about "the sweep" in the abstract is
 * the one they cannot act on.
 */
function refuseUnsweepableInput(options: {
  readonly rule: RegExp;
  readonly files: readonly string[];
  readonly subject: string;
  /** What a stateful rule would skip, in this shape's terms: "offenders", "matches". */
  readonly skipped: string;
  /** What an empty walk proves instead, phrased to finish "so …". */
  readonly vacuously: string;
}): void {
  const { rule, files, subject, skipped, vacuously } = options;
  assert.ok(
    !rule.global && !rule.sticky,
    `the ${subject} sweep's rule carries ${JSON.stringify(rule.flags)}, so .test advances lastIndex between files and the filter skips ${skipped} — drop the g/y flag or build a fresh RegExp per file`,
  );
  assert.ok(
    files.length > 0,
    `the ${subject} sweep walked no files at all, so ${vacuously} — the walk stopped matching, which is a failure rather than a clean result`,
  );
}

/**
 * Every file in `files` that `rule` matches, other than the exempt ones, is a
 * failure.
 *
 * `subject` and `what` build the message a reader meets: "these {subject}
 * {what}: a.ts, b.ts". Both are required, because the failure lands on
 * somebody who did not write this sweep and "expected [] to deepEqual [...]"
 * tells them the offenders and not what to do about them.
 *
 * `what` is spelled the same here as in {@link assertOnlyTheseMatch}, where it
 * used to be called `instead`. They were always one parameter — a verb phrase
 * finishing "these {subject} …" — under two names chosen to read well in each
 * message, and the cost was that whoever wrote their second sweep this week got
 * it wrong once. Callers whose phrase ends by naming the fix ("… — render
 * <HeroBanner> instead") keep doing that; it is a clause of the description,
 * not a different argument.
 */
export function assertNoOffenders(options: {
  readonly rule: RegExp;
  readonly files: readonly string[];
  readonly read: (relative: string) => string;
  /** Named holes, each of which `assertExemptionsHonest` should also police. */
  readonly exempt?: readonly string[];
  /** The plural noun for what is walked: "modules", "suites". */
  readonly subject: string;
  /** What the offenders did, phrased to finish "these modules …". */
  readonly what: string;
}): void {
  const { rule, files, read, exempt = [], subject, what } = options;
  refuseUnsweepableInput({
    rule,
    files,
    subject,
    skipped: "offenders",
    vacuously: "it would pass against a tree that offends everywhere",
  });
  const offenders = files.filter(
    (relative) => !exempt.includes(relative) && rule.test(read(relative)),
  );
  assert.deepEqual(offenders, [], `these ${subject} ${what}: ${offenders.join(", ")}`);
}

/**
 * The other half of the same shape: these files match the rule, and no others.
 *
 * {@link assertNoOffenders} answers "nobody does this". Three sweeps here ask
 * the sharper question — the sanctioned static Sentry import, the single
 * `TAG_COLORS` definition, the one component declaring a row — and each had
 * written it as `deepEqual(matches.sort(), EXPECTED.sort())`. That is the same
 * loop with the same two hazards plus a third of its own: an `expected` entry
 * naming a file the walk does not contain passes silently, because a claim
 * about a file nobody reads is a claim about nothing.
 *
 * WHY NOT `exempt`. Passing the sanctioned files as exemptions would keep the
 * "nobody else does this" half and drop the half that matters more: an
 * allowlist entry that STOPPED doing the thing is a hole standing open with
 * nothing about it looking stale. Both directions are reported here, named.
 */
export function assertOnlyTheseMatch(options: {
  readonly rule: RegExp;
  readonly files: readonly string[];
  readonly read: (relative: string) => string;
  /** The files that must match — the sanctioned set, in any order. */
  readonly expected: readonly string[];
  /** The plural noun for what is walked: "modules", "files". */
  readonly subject: string;
  /** What matching means, phrased to finish "these {subject} …". */
  readonly what: string;
}): void {
  const { rule, files, read, expected, subject, what } = options;
  refuseUnsweepableInput({
    rule,
    files,
    subject,
    skipped: "matches",
    vacuously: "both halves of its claim are about an empty set",
  });
  const unwalked = expected.filter((relative) => !files.includes(relative));
  assert.deepEqual(
    unwalked,
    [],
    `these ${subject} are expected to ${what} and are not in the walk at all, so nothing checks them: ${unwalked.join(", ")}`,
  );
  const matched = files.filter((relative) => rule.test(read(relative)));
  const unexpected = matched.filter((relative) => !expected.includes(relative));
  const missing = expected.filter((relative) => !matched.includes(relative));
  // ONE assert over a FLAT, LABELLED list rather than over `{unexpected,
  // missing}`. Both directions have to be reported together — two asserts stop
  // at the first, and a run where both are wrong would show half the answer —
  // but an object diff makes the reader decode a structure before they reach
  // the sentence explaining it. Labelling each path says which kind it is at
  // the point the diff prints it, so the diff is the answer and the message is
  // the reason.
  const problems = [
    ...unexpected.map((relative) => `unsanctioned, ${what}: ${relative}`),
    ...missing.map((relative) => `sanctioned, no longer does: ${relative}`),
  ];
  assert.deepEqual(
    problems,
    [],
    `${unexpected.length} unsanctioned ${subject} ${what}, and ${missing.length} sanctioned ${subject} no longer do — the second kind is an entry that has become a hole, which is the half an exempt list cannot see`,
  );
}
