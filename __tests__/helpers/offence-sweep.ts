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
