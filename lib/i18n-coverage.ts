/**
 * How much of the app each language actually translates, measured from the
 * source of `lib/i18n-context.tsx` rather than believed from the picker.
 *
 * Every locale map in that file opens with `...en`, so a key nobody translated
 * is not a missing key: it is an English string served under a Polish flag. It
 * renders, it fits the layout, `t()` returns a non-empty value, and every test
 * that asserts a label appears on screen passes. The fallback is the right
 * runtime behaviour — an empty string would be worse — and it is also why the
 * gap survives: nothing in a green suite distinguishes "translated" from
 * "inherited". `deleteItem` existed in three of six languages for as long as it
 * was unused, and was noticed only when a new accessibility label reached for
 * it.
 *
 * So the fallback becomes a NUMBER here. Each language's declared-key count is
 * a fact about the file, floored in {@link TRANSLATION_FLOORS} the way the lint
 * guards floor their walks — a measurement with slack under it, not a target —
 * and the keys a language inherits are listed rather than counted, because the
 * list is what someone would work from.
 *
 * Why "declared" and not "differs from the English string": a locale may
 * legitimately serve the English text (`appName` is a brand, `emailPlaceholder`
 * is an address), and value comparison would report both as untranslated
 * forever. Declaring a key is the recorded decision that someone looked at it;
 * inheriting one is the absence of that decision. The two disagree on a handful
 * of keys, and the honest thing to publish is the count of decisions not made,
 * which is why {@link TranslationCoverage.inherited} carries the names.
 *
 * Node-pure on purpose, and measured from the source rather than from an
 * import: `lib/i18n-context.tsx` pulls React Native peers. The reading itself
 * lives in `lib/i18n-source.ts` — one parser for that file, shared with the
 * three other suites that used to match it by regex — so what is left here is
 * arithmetic over what the parser found.
 */

import {
  TRANSLATION_BASE_LANGUAGE,
  findLocaleBlock,
} from "./i18n-source";

export { TRANSLATION_BASE_LANGUAGE };

/**
 * The languages this module expects to find, in picker order.
 *
 * Declared here rather than imported from `lib/i18n-context.tsx` (React Native
 * peers) — `__tests__/i18n-translation-coverage.test.ts` asserts parity against
 * that file's `languageOptions`, so a seventh language cannot arrive in the
 * picker and stay out of this table.
 */
export const TRANSLATION_LANGUAGES = ["ru", "en", "be", "pl", "de", "es"] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/** One language's standing against the base map. */
export type TranslationCoverage = {
  readonly language: string;
  /** Keys the language writes for itself. */
  readonly declared: number;
  /** Keys in the base map this language does not declare, in base order. */
  readonly inherited: readonly string[];
  /** Size of the base map — the denominator. */
  readonly baseKeys: number;
  /**
   * Keys declared here that the base map does not have. Always empty today;
   * a non-empty list is a typo'd key, which `TranslationMap` would reject at
   * compile time but which this parser can also see without a compiler.
   */
  readonly unknown: readonly string[];
};

/** Translated share of the base map, 0–100, one decimal place. */
export function coveragePercent(row: TranslationCoverage): number {
  if (row.baseKeys === 0) return 0;
  const translated = row.baseKeys - row.inherited.length;
  return Math.round((translated / row.baseKeys) * 1000) / 10;
}

/** One line per language, for a report a person reads. */
export function formatCoverageRow(row: TranslationCoverage): string {
  return `${row.language}: ${row.baseKeys - row.inherited.length}/${row.baseKeys} keys (${coveragePercent(row).toFixed(1)}%), ${row.inherited.length} inherited from ${TRANSLATION_BASE_LANGUAGE}`;
}

/**
 * Coverage for every requested language, base language included (it inherits
 * nothing by definition, and its row carries the denominator every other row
 * is measured against).
 *
 * Throws when a language has no map: a caller asking about a language that is
 * not in the file has either renamed one or is asking the wrong question, and
 * answering "0% translated" would read as a finding about the translations.
 */
export function translationCoverage(
  source: string,
  languages: readonly string[] = TRANSLATION_LANGUAGES,
): readonly TranslationCoverage[] {
  const base = findLocaleBlock(source, TRANSLATION_BASE_LANGUAGE);
  if (!base) {
    throw new Error(
      `no \`const ${TRANSLATION_BASE_LANGUAGE}\` map in the source — every ratio here is measured against it`,
    );
  }
  const baseKeys = base.keys;
  const baseSet = new Set(baseKeys);

  return languages.map((language) => {
    const block =
      language === TRANSLATION_BASE_LANGUAGE
        ? base
        : findLocaleBlock(source, language);
    if (!block) {
      throw new Error(`no \`const ${language}\` translation map in the source`);
    }
    const declared = new Set(block.keys);
    return {
      language,
      declared: block.keys.length,
      inherited:
        language === TRANSLATION_BASE_LANGUAGE
          ? []
          : baseKeys.filter((key) => !declared.has(key)),
      baseKeys: baseKeys.length,
      unknown: block.keys.filter((key) => !baseSet.has(key)),
    };
  });
}

/** A committed measurement of one language's declared-key count. */
export type TranslationFloor = {
  /** Minimum declared keys, measured with slack under it. */
  readonly minimum: number;
  /** What was measured, when, and how much slack the floor leaves. */
  readonly note: string;
};

/**
 * Per-language floors on DECLARED keys, in the same spirit as `SCANNED_FLOORS`:
 * a measured number with slack, not a target.
 *
 * Deliberately a floor on what is translated rather than a ceiling on what is
 * inherited. A new English string ships before its five translations — that is
 * the ordinary way a feature lands here — so a ceiling on `inherited` would go
 * red on every feature PR and be deleted within a week, which is the failure
 * mode `lib/scanned-floor.ts` names for a floor that trips on churn. What must
 * never happen is the other direction: a locale LOSING translations, from a
 * bad merge or a block deleted while resolving a conflict. That is what these
 * catch, and the inherited counts are published by the suite instead of gated.
 *
 * Exhaustive over {@link TRANSLATION_LANGUAGES}, so a seventh language cannot
 * be added to the picker without a measurement of its own.
 */
export const TRANSLATION_FLOORS: Readonly<
  Record<TranslationLanguage, TranslationFloor>
> = {
  en: {
    minimum: 466,
    note: "501 keys on 2026-08-21, re-measured after the three dead-key families (35 orphaned base keys) were removed — 538 before them. The base map and the denominator of every other row: a drop here shrinks the whole table's meaning, so the slack is the tightest of the six (~7%).",
  },
  ru: {
    minimum: 465,
    note: "499 of 501 on 2026-08-21 (99.6%) — the only fully-maintained locale, and the row that forced this re-measurement: it declared every one of the 35 removed keys, so the last family took it to exactly its old floor of 500 and the slack assertion (strict `<`) went red at equality. ~7% slack; the two inherited keys are pinned by name in the suite rather than left to this number.",
  },
  be: {
    minimum: 266,
    note: "290 of 501 on 2026-08-21 (57.9%) — the first partial locale to pass half, and it did so by translation rather than by the denominator shrinking: the empty-state (24), wishlist (14) and item-filter (19) families all landed in all four partial locales the same day. 271 after the wishlist, 257 after the empty states, 233 before them, 222 of 538 before the dead-key removals. ~8% slack, which is roughly one feature's worth of keys.",
  },
  pl: {
    minimum: 258,
    note: "281 of 501 on 2026-08-21 (56.1%) — 262 after the wishlist, 248 after the empty states, 224 before them, 213 of 538 before the removals. ~8% slack, same reasoning as be.",
  },
  de: {
    minimum: 254,
    note: "277 of 501 on 2026-08-21 (55.3%) — 258 after the wishlist, 244 after the empty states, 220 before them, 209 of 538 before the removals. ~8% slack, same reasoning as be.",
  },
  es: {
    minimum: 255,
    note: "278 of 501 on 2026-08-21 (55.5%) — 259 after the wishlist, 245 after the empty states, 221 before them, 209 of 538 before the removals. One ahead of de because it never declared the 'opened for you' header, so the collections-list removal took two declarations from it rather than three. ~8% slack, same reasoning as be.",
  },
};
