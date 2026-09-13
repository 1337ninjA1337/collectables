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
   * The budget this measurement was taken to justify, in bytes.
   *
   * On the record rather than only in `lib/bundle-size.ts`, because the
   * argument for a raise is about a RATE — how much each one bought and how
   * fast it was spent — and a rate needs both numbers per row.
   */
  readonly budgetBytes: number;
  /**
   * The exported web JS bundle, in bytes, at the commit that last moved the
   * budget — a MEASUREMENT, never a re-measurement. Reading `dist/` for it
   * would make every claim depend on whether somebody had built, and turn a
   * real regression into a number that re-derives its own expectation.
   */
  readonly bundleBytes: number;
  /**
   * The locale maps' bytes at that same commit — the copy half. A proxy for
   * growth rather than a share of the bundle; see
   * `lib/translations-footprint.ts` for why the delta is fair even though the
   * absolute number is not.
   *
   * **The head row's figure was re-taken on a narrower basis on 2026-09-13**,
   * when the maps moved out of `lib/i18n-context.tsx` into six files of their
   * own and the measure started counting their headers. It is not a
   * re-measurement for growth: the maps at the commit that moved the budget
   * come to 236225 bytes and they come to 236225 bytes today, so the pair is
   * still two numbers from one commit — the second one is now in the unit it
   * always claimed to be in.
   */
  readonly translationsBytes: number | null;
  /** ISO date the pair was measured, for arguing about a rate. */
  readonly takenOn: string;
  /** One line on what spent the previous raise. */
  readonly because: string;
};

/**
 * Every budget move, newest first — RAISES AND ONE LOWERING.
 *
 * The list was five raises in three days and the doc block that reads it
 * called that a ratchet "that has never once said stop". The 2026-09-13 row is
 * the other direction: the composition report found 964 KiB of gesture stack
 * in the web bundle that no web screen uses, and a budget left at 4.60 MiB
 * over a 3732 KiB bundle is not a guard at all — 978 KiB of headroom catches
 * nothing, least of all the ~30 KiB SDK the number exists for. A saving has to
 * be banked by lowering the budget in the same commit, or it is spent by the
 * next four rounds without anybody deciding to.
 *
 * The doc block in `lib/bundle-size.ts` is four paragraphs of prose doing a
 * table's job: each raise was argued against the one before it, in sentences,
 * and a reader wanting the TREND had to reconstruct it by reading all four.
 * Eight rounds carried "nothing keeps a budget history" as a suggestion, and
 * it was the oldest unactioned item in that file and the one every raise
 * would have used.
 *
 * **Newest first, and the head is the live snapshot.** A raise adds a row
 * rather than editing one, which is what makes the trend accumulate instead
 * of being overwritten by the thing it is supposed to measure.
 *
 * `translationsBytes` is `null` for the three rows that predate the copy
 * measure: the honest answer for a number nobody took, and better than
 * back-filling one from today's file, which would describe a translations
 * module that has grown by nine keys since.
 */
export const BUDGET_HISTORY: readonly BudgetSnapshot[] = [
  {
    budgetBytes: 3.67 * 1024 * 1024,
    bundleBytes: 3_821_688,
    translationsBytes: 236_225,
    takenOn: "2026-09-13",
    because:
      "the first move that has ever gone DOWN: the gesture-handler root became a platform pair, and reanimated, worklets, hammerjs and semver left the web bundle with it — 964.2 KiB, a fifth of what the deployed site downloads, found by the composition report and confirmed by its drift section",
  },
  {
    budgetBytes: 4.60 * 1024 * 1024,
    bundleBytes: 4_802_272,
    translationsBytes: 243_824,
    takenOn: "2026-09-12",
    because:
      "seven rounds of ordinary work — a typed bulk-bar contract, two composed outcome toasts, a shared separator, a search-row cost fix and two marketplace locks — 16.3 KiB, of which 4.9 KiB is copy",
  },
  {
    budgetBytes: 4.59 * 1024 * 1024,
    bundleBytes: Math.round(4673.4 * 1024),
    translationsBytes: 238_763,
    takenOn: "2026-09-12",
    because:
      "a bulk archive with its listing pass and four counted strings in six languages — 17.9 KiB, of which the copy is a real share",
  },
  {
    budgetBytes: 4.57 * 1024 * 1024,
    bundleBytes: Math.round(4655.5 * 1024),
    translationsBytes: null,
    takenOn: "2026-09-12",
    because:
      "four rounds — the converted stats total, the export's money, the reversible archive, and the archive screen with its eleven keys in six languages",
  },
  {
    budgetBytes: 4.55 * 1024 * 1024,
    bundleBytes: Math.round(4634.4 * 1024),
    translationsBytes: null,
    takenOn: "2026-09-10",
    because:
      "three features — the dense-run reorder writer, the per-collection sort preference, and the toast action",
  },
  {
    budgetBytes: 4.53 * 1024 * 1024,
    bundleBytes: Math.round(4619.4 * 1024),
    translationsBytes: null,
    takenOn: "2026-09-10",
    because:
      "the first raise: the budget had reached 1.1 KiB of headroom under a comment claiming 190 KiB, and failed on five provider guards and one small module",
  },
];

/**
 * The live pair — the head of the history, named for the two readers that
 * only ever want the latest.
 *
 * Re-measure BOTH fields together, or neither; and add a ROW rather than
 * editing this one, or the trend is overwritten by the measurement that was
 * supposed to extend it.
 */
export const BUDGET_SNAPSHOT: BudgetSnapshot = BUDGET_HISTORY[0];
