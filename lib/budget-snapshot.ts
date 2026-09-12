/**
 * The two numbers the budget is argued from, in one place, moving together.
 *
 * `LAST_MEASURED_BUNDLE_BYTES` lived in `lib/bundle-size.ts` and
 * `LAST_MEASURED_TRANSLATIONS_BYTES` in `lib/translations-footprint.ts`, and
 * the pair is taken in the same breath: the bundle at the commit that last
 * moved the budget, and the translations module at that same commit. The
 * report subtracts one from today's bundle and the other from today's copy,
 * and prints the second as a share OF the first.
 *
 * **The trap is forgetting half of it.** A raise that updates the bundle
 * figure and leaves the copy figure behind reports a copy delta measured
 * against the wrong baseline — silently, with a plausible number, on the one
 * output somebody reads when deciding whether to raise again. The suite
 * could only catch it with a tolerance loose enough not to go red on ordinary
 * work, which is exactly the size of the error it needed to catch.
 *
 * One object, so "update the measurement" is one edit and a half-done one
 * does not type-check into a wrong report. `takenOn` is here for the same
 * reason the doc block in `lib/bundle-size.ts` dates every paragraph: the
 * argument for a raise is about a rate, and a rate needs the date.
 *
 * **No imports, deliberately.** `lib/translations-footprint.ts` reaches the
 * i18n parser and `lib/bundle-size.ts` must not; a module both can import has
 * to be one that cannot carry anything into either. The same argument
 * `lib/translation-status.ts` makes, and `budget-snapshot.test.ts` asserts it
 * the same way.
 */

export type BudgetSnapshot = {
  /**
   * The exported web JS bundle, in bytes, at the commit that last moved the
   * budget — a MEASUREMENT, never a re-measurement. Reading `dist/` for it
   * would make every claim depend on whether somebody had built, and turn a
   * real regression into a number that re-derives its own expectation.
   */
  readonly bundleBytes: number;
  /**
   * `lib/i18n-context.tsx`'s source bytes at that same commit — the copy half.
   * A proxy for growth rather than a share of the bundle; see
   * `lib/translations-footprint.ts` for why the delta is fair even though the
   * absolute number is not.
   */
  readonly translationsBytes: number;
  /** ISO date the pair was measured, for arguing about a rate. */
  readonly takenOn: string;
};

/**
 * Measured on 2026-09-12 by `npm run lint:bundle-size` against a fresh
 * `dist/`, at the commit that raised the budget to 4.59 MiB.
 *
 * Re-measure BOTH fields together, or neither.
 */
export const BUDGET_SNAPSHOT: BudgetSnapshot = {
  bundleBytes: Math.round(4673.4 * 1024),
  translationsBytes: 238_763,
  takenOn: "2026-09-12",
};
