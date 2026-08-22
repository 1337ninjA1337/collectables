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
 * Those two keys are the reason {@link UNTRANSLATABLE_KEYS} exists. They are
 * not decisions nobody has made — they are decisions that were made and came
 * back "English is correct here" — so counting them as gaps made `ru` read
 * 99.6% forever and made every other row a percentage of something nobody can
 * finish. The list is the ONE place this module admits an exemption, and it is
 * kept honest by being small, reasoned per key, and checked against the base
 * map in the suite: an entry naming a key that no longer exists shrinks the
 * denominator by nothing and looks exactly like one that works, so something
 * has to go looking for it.
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

/**
 * Base keys that are correct in English in every language, and the reason each
 * one is.
 *
 * A reason per key rather than a bare set, because that is what stops the list
 * growing: an exemption is a key nobody has to justify again, and the smallest
 * defence against that is making somebody write the justification down where
 * the next reader will see it. Two entries today, both of them things rather
 * than words — a product's name and an address — and neither of them a
 * sentence a translator could improve.
 *
 * What this is NOT: a place to park a key that is merely hard, or one that
 * five locales have not got to yet. Those are the inherited list, which is a
 * worklist and is supposed to be long. The test for membership is whether a
 * translator handed this key would correctly hand it back unchanged.
 */
export const UNTRANSLATABLE_KEYS: Readonly<Record<string, string>> = {
  appName: "the product's name — a brand renders the same in every locale, and a translated one would be a different app",
  emailPlaceholder: "`you@example.com`, an address rather than a phrase; the RFC 2606 example domain is not localised",
  acquiredDatePlaceholder: "`2025-11-03`, an ISO 8601 date shown as the format the field expects — the format is what the parser accepts, so a locale writing `03.11.2025` would be documenting an input the field rejects",
};

/** One language's standing against the base map. */
export type TranslationCoverage = {
  readonly language: string;
  /** Keys the language writes for itself. */
  readonly declared: number;
  /**
   * Translatable base keys this language does not declare, in base order —
   * the worklist, and the numerator's complement.
   *
   * {@link UNTRANSLATABLE_KEYS} are excluded: a key that is correct in English
   * is not work anybody can do, and listing it here made the list a worklist
   * with two entries nobody could ever tick off. They are reported by
   * {@link untranslatable} instead, so nothing is hidden — only moved out of
   * the column that means "somebody still has to look at this".
   */
  readonly inherited: readonly string[];
  /**
   * The {@link UNTRANSLATABLE_KEYS} this language does not declare, in base
   * order.
   *
   * Per language rather than global because a locale MAY declare one — writing
   * `appName: "Collectables"` is a decision too, just a redundant one — and a
   * row that reported the exemptions it is not using would be claiming credit
   * for a gap it does not have.
   */
  readonly untranslatable: readonly string[];
  /** Size of the base map. The denominator is {@link translatable}. */
  readonly baseKeys: number;
  /**
   * The denominator: base keys minus the untranslatable ones.
   *
   * Separate from {@link baseKeys} rather than replacing it, because the two
   * answer different questions and a single number would silently mean the
   * second while being read as the first. `501 keys in the map, 499 of them
   * translatable` is the honest pair.
   */
  readonly translatable: number;
  /**
   * Keys declared here that the base map does not have. Always empty today;
   * a non-empty list is a typo'd key, which `TranslationMap` would reject at
   * compile time but which this parser can also see without a compiler.
   */
  readonly unknown: readonly string[];
};

/**
 * Translated share of what can be translated, 0–100, one decimal place.
 *
 * Measured against {@link TranslationCoverage.translatable} rather than the
 * whole map, which is what lets a finished locale read 100%. Before that,
 * `ru` sat at 99.6% with the missing 0.4% being a brand name and an email
 * address — a number that could not be moved, under a threshold somebody would
 * eventually be tempted to lower.
 */
export function coveragePercent(row: TranslationCoverage): number {
  if (row.translatable === 0) return 0;
  const translated = row.translatable - row.inherited.length;
  return Math.round((translated / row.translatable) * 1000) / 10;
}

/**
 * One line per language, for a report a person reads.
 *
 * Names the exemptions when the row has any, because a reader who knows the
 * map holds 501 keys and sees a denominator of 499 should not have to go
 * looking for the difference.
 */
export function formatCoverageRow(row: TranslationCoverage): string {
  const line = `${row.language}: ${row.translatable - row.inherited.length}/${row.translatable} keys (${coveragePercent(row).toFixed(1)}%), ${row.inherited.length} inherited from ${TRANSLATION_BASE_LANGUAGE}`;
  return row.untranslatable.length === 0
    ? line
    : `${line}, ${row.untranslatable.length} not translatable (${row.untranslatable.join(", ")})`;
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

  // Intersected with the base map rather than trusted, so an exemption naming
  // a key this source does not declare removes nothing from its denominator.
  //
  // NOT a throw, and the difference is worth stating: a stale entry is a
  // finding about THIS REPOSITORY's map, and this function is handed any
  // source — every hand-checkable fixture in the suite declares four keys and
  // none of them is a brand name. Refusing here would make the general
  // function unusable to prove the arithmetic, so the staleness claim is made
  // where it can be made honestly, in `i18n-translation-coverage.test.ts`
  // against the real map.
  const exempt = baseKeys.filter((key) => key in UNTRANSLATABLE_KEYS);

  return languages.map((language) => {
    const block =
      language === TRANSLATION_BASE_LANGUAGE
        ? base
        : findLocaleBlock(source, language);
    if (!block) {
      throw new Error(`no \`const ${language}\` translation map in the source`);
    }
    const declared = new Set(block.keys);
    const missing = (keys: readonly string[]) =>
      language === TRANSLATION_BASE_LANGUAGE
        ? []
        : keys.filter((key) => !declared.has(key));
    return {
      language,
      declared: block.keys.length,
      inherited: missing(baseKeys).filter((key) => !(key in UNTRANSLATABLE_KEYS)),
      untranslatable: missing(exempt),
      baseKeys: baseKeys.length,
      translatable: baseKeys.length - exempt.length,
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
    note: "499 of 501 on 2026-08-21 (99.6%) — the only fully-maintained locale, and the row that forced this re-measurement: it declared every one of the 35 removed keys, so the last family took it to exactly its old floor of 500 and the slack assertion (strict `<`) went red at equality. ~7% slack. It reads 100% since 2026-08-22 without declaring one more key: the two it inherits are `appName` and `emailPlaceholder`, now in UNTRANSLATABLE_KEYS and out of the denominator, and they are pinned by name in the suite rather than left to this number.",
  },
  be: {
    minimum: 463,
    note: "498 of 501 on 2026-08-22 (100.0%) — the first partial locale to finish, by the per-locale sweep the screen families ran out before reaching: 62 keys in one pass, spread over ~26 files that no unit grouped. 304 on 2026-08-21 (60.7%), 290 after the filters, 271 after the wishlist, 257 after the empty states, 233 before them, 222 of 538 before the dead-key removals. Re-measured to ~7% slack, the tighter figure the complete locales carry: a floor of 279 under a 498-key map caught nothing a bad merge could do.",
  },
  pl: {
    minimum: 463,
    note: "498 of 501 on 2026-08-22 (100.0%) — finished in the same sweep as be, 67 keys rather than 62 because it had also never declared `addFriend`, `removeFriend`, `follow`, `unfollow` or `saveCollection`. 295 on 2026-08-21 (58.9%), 281 after the filters, 262 after the wishlist, 248 after the empty states, 224 before them, 213 of 538 before the removals. ~7% slack, same reasoning as be.",
  },
  de: {
    minimum: 463,
    note: "498 of 501 on 2026-08-22 (100.0%) — the second half of the per-locale sweep, 67 keys. 291 on 2026-08-21 (58.1%), 277 after the filters, 258 after the wishlist, 244 after the empty states, 220 before them, 209 of 538 before the removals. ~7% slack, same reasoning as be.",
  },
  es: {
    minimum: 463,
    note: "498 of 501 on 2026-08-22 (100.0%) — finished alongside de, and the two now declare the same 498 keys. 292 on 2026-08-21 (58.3%), 278 after the filters, 259 after the wishlist, 245 after the empty states, 221 before them, 209 of 538 before the removals. One ahead of de through that whole stretch because it never declared the 'opened for you' header. ~7% slack, same reasoning as be.",
  },
};
