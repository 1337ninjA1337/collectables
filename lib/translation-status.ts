/**
 * Which languages the picker may offer without qualification, and which it owes
 * the reader a warning about.
 *
 * `lib/i18n-coverage.ts` measures the gap and publishes it: four of the six
 * locales sit below half, because every locale map opens with `...en` and an
 * untranslated key renders as an English string under a Polish flag. That
 * measurement has been a report and nothing more — the settings picker lists
 * `Deutsch` (39% translated) in the same chip, the same weight and the same
 * order as `Русский` (99%), which is a promise of parity the app cannot keep.
 * A reader who picks one of the four meets an interface that is mostly still in
 * English and has no way to know that was expected.
 *
 * So the classification lands here, in the one module the PICKER can import.
 * `lib/i18n-coverage.ts` reads the source of `lib/i18n-context.tsx` and parses
 * it, which is a thing a test does and an app cannot; what the app needs is the
 * verdict, which is four names and a threshold.
 *
 * A CLASSIFICATION and not the percentages, deliberately, and it is the same
 * argument `TRANSLATION_FLOORS` makes next door. Committing "de is at 38.8%"
 * would go red on every feature PR that adds an English string, because the
 * denominator moves and every other row falls — the failure mode
 * `lib/scanned-floor.ts` names for a number that trips on churn. Committing "de
 * is one of the partial ones" is stable under exactly that churn and still
 * catches both events worth catching: a locale that gets FINISHED and keeps a
 * badge it no longer deserves, and one that silently collapses into the
 * partial set. `__tests__/translation-status.test.ts` derives the set from the
 * real measurement and asserts this list equals it, so the two cannot drift.
 *
 * Badged rather than hidden or reordered. Hiding a language below a threshold
 * takes it away from the reader who wants it half-translated and knows it;
 * sorting by coverage rewrites a familiar list every time a translation lands.
 * A badge changes what the picker CLAIMS without changing what it offers.
 */

/**
 * The share of the base map a language must declare before the picker offers
 * it without qualification.
 *
 * 90 rather than 100: a locale that has translated all but a handful of keys is
 * a maintained locale, and a badge that appears on `ru` at 99.4% would train
 * every reader to ignore it. The real gap this exists for is the 40-point one.
 */
export const TRANSLATION_COMPLETE_PERCENT = 90;

/**
 * Languages below {@link TRANSLATION_COMPLETE_PERCENT}, in picker order.
 *
 * Measured 2026-08-17 against a 538-key base map: `be` 41.3%, `pl` 39.6%, `de`
 * 38.8%, `es` 38.8% — versus `en` 100% and `ru` 99.4%. The gap between the two
 * groups is fifty points wide, which is why one threshold separates them
 * cleanly and why no ordinary run of translation work moves a name across it.
 */
export const PARTIALLY_TRANSLATED_LANGUAGES: readonly string[] = ["be", "pl", "de", "es"];

/**
 * True when the picker should qualify this language.
 *
 * Takes a plain string rather than the app's `AppLanguage` union: this module
 * must not import `lib/i18n-context.tsx` (React Native peers, and that file
 * imports this one's verdict through the picker). An unknown code answers
 * `false` — a language nobody measured is not one this module may accuse, and
 * the parity case next door is what stops a seventh language arriving
 * unmeasured.
 */
export function isPartiallyTranslated(code: string): boolean {
  return PARTIALLY_TRANSLATED_LANGUAGES.includes(code);
}
