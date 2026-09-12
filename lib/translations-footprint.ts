/**
 * How much of the app is sentences.
 *
 * `lib/bundle-size.ts` prints how far a build has drifted since the budget
 * last moved, and its doc block asks for that number split between code and
 * copy — because the four raises in three days turned on exactly that
 * distinction and nobody could state it. One round cost 17.9 KiB with four
 * counted strings in six languages in it; the next cost 0.2 KiB with none.
 *
 * **This is a proxy and says so.** It measures the SOURCE bytes of
 * `lib/i18n-context.tsx`, not that module's contribution to the minified
 * bundle, and the two are not equal: the bundler renames the locals, strips
 * the types and drops the comments. What survives almost untouched is the
 * string literals themselves — a translated sentence minifies to itself — so
 * the DELTA between two measurements of this file tracks the delta the bundle
 * sees far better than either absolute number does. It is a proxy for growth,
 * never a figure to subtract from the bundle total, and the report labels it
 * that way rather than leaving the reader to assume.
 *
 * Pure and node-safe: it takes source text somebody else read, the same split
 * `lib/i18n-coverage.ts` has from `lib/i18n-source.ts`.
 */

import { BUDGET_SNAPSHOT } from "@/lib/budget-snapshot";
import { languageOptionCodes, localeKeys } from "@/lib/i18n-source";

export type TranslationsFootprint = {
  /** UTF-8 bytes of the translations module's source. */
  readonly sourceBytes: number;
  /** Locales the picker offers. */
  readonly locales: number;
  /**
   * Distinct keys in the base map — the app's vocabulary.
   *
   * The BASE map's count, so it includes the handful `lib/i18n-required-keys.ts`
   * exempts from translation: the coverage report's smaller denominator is a
   * different question (how much is translatABLE) and the two are not meant to
   * agree.
   */
  readonly baseKeys: number;
  /**
   * Declarations across every locale.
   *
   * The number that actually costs bytes: a key translated into six languages
   * is six strings in the bundle, and a key only `en` declares is one. So a
   * round that adds four keys everywhere spends roughly six times what a round
   * adding four English-only keys does, which is invisible in `baseKeys`.
   */
  readonly declarations: number;
};

export function translationsFootprint(source: string): TranslationsFootprint {
  const codes = languageOptionCodes(source);
  let declarations = 0;
  for (const code of codes) declarations += localeKeys(source, code).size;
  return {
    // `Buffer` is available in the node contexts that run this (the check
    // script and its suite) and `TextEncoder` is available everywhere, so the
    // encoder is the one that cannot be wrong about the environment.
    sourceBytes: new TextEncoder().encode(source).length,
    locales: codes.length,
    baseKeys: localeKeys(source, "en").size,
    declarations,
  };
}

/**
 * The translations module as it stood when the budget last moved — the copy
 * half of `LAST_MEASURED_BUNDLE_BYTES`, measured in the same breath and moving
 * only when it moves.
 *
 * Re-exported from `lib/budget-snapshot.ts`, which holds both halves: a raise
 * that updated the bundle figure and left this one behind reported a copy
 * delta measured against the wrong baseline, silently and plausibly, on the
 * output somebody reads when deciding whether to raise again.
 */
export const LAST_MEASURED_TRANSLATIONS_BYTES: number | null =
  BUDGET_SNAPSHOT.translationsBytes;

/** Signed KiB, one decimal — the report's own spelling. */
function formatKiB(bytes: number): string {
  const sign = bytes < 0 ? "-" : "+";
  return `${sign}${(Math.abs(bytes) / 1024).toFixed(1)} KiB`;
}

/**
 * "of which +6.2 KiB is translated copy (535 keys × 6 locales)" — the sentence
 * that turns the drift line into an argument somebody can act on.
 *
 * Returns `null` when the copy has not moved, because a build that added no
 * sentences should not print a line about sentences: the drift line above it
 * already says the growth was code.
 */
export function formatCopyDriftLine(
  footprint: TranslationsFootprint,
  lastMeasuredBytes: number | null = LAST_MEASURED_TRANSLATIONS_BYTES,
): string | null {
  // `null` is the honest answer for a baseline nobody took — the three budget
  // moves that predate this measure carry it, and a row without one cannot
  // support a delta. Saying nothing beats subtracting from zero, which would
  // report the whole translations module as this round's growth.
  if (lastMeasuredBytes === null) return null;
  const drift = footprint.sourceBytes - lastMeasuredBytes;
  if (drift === 0) return null;
  return (
    `check-bundle-size: ${formatKiB(drift)} of that is translated copy ` +
    `(${String(footprint.baseKeys)} keys × ${String(footprint.locales)} locales, ` +
    `${String(footprint.declarations)} declarations) — source bytes, a proxy for growth rather than a share of the bundle.`
  );
}
