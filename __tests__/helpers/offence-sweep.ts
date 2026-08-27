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
 * Every file in `files` that `rule` matches, other than the exempt ones, is a
 * failure.
 *
 * `subject` and `instead` build the message a reader meets: "these {subject}
 * {instead}: a.ts, b.ts". Both are required, because the failure lands on
 * somebody who did not write this sweep and "expected [] to deepEqual [...]"
 * tells them the offenders and not what to do about them.
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
  readonly instead: string;
}): void {
  const { rule, files, read, exempt = [], subject, instead } = options;
  assert.ok(
    !rule.global && !rule.sticky,
    `the ${subject} sweep's rule carries ${JSON.stringify(rule.flags)}, so .test advances lastIndex between files and the filter skips offenders — drop the g/y flag or build a fresh RegExp per file`,
  );
  assert.ok(
    files.length > 0,
    `the ${subject} sweep walked no files at all, so it would pass against a tree that offends everywhere — the walk stopped matching, which is a failure rather than a clean result`,
  );
  const offenders = files.filter(
    (relative) => !exempt.includes(relative) && rule.test(read(relative)),
  );
  assert.deepEqual(offenders, [], `these ${subject} ${instead}: ${offenders.join(", ")}`);
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
  assert.ok(
    !rule.global && !rule.sticky,
    `the ${subject} sweep's rule carries ${JSON.stringify(rule.flags)}, so .test advances lastIndex between files and the filter skips matches — drop the g/y flag or build a fresh RegExp per file`,
  );
  assert.ok(
    files.length > 0,
    `the ${subject} sweep walked no files at all, so both halves of its claim are about an empty set — the walk stopped matching, which is a failure rather than a clean result`,
  );
  const unwalked = expected.filter((relative) => !files.includes(relative));
  assert.deepEqual(
    unwalked,
    [],
    `these ${subject} are expected to ${what} and are not in the walk at all, so nothing checks them: ${unwalked.join(", ")}`,
  );
  const matched = files.filter((relative) => rule.test(read(relative)));
  const unexpected = matched.filter((relative) => !expected.includes(relative));
  const missing = expected.filter((relative) => !matched.includes(relative));
  assert.deepEqual(
    { unexpected, missing },
    { unexpected: [], missing: [] },
    `${unexpected.length} unsanctioned ${subject} ${what} (${unexpected.join(", ") || "none"}), and ${missing.length} that are supposed to no longer do (${missing.join(", ") || "none"}) — the second kind is a sanctioned entry that has become a hole`,
  );
}
