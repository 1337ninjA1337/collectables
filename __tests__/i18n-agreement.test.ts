import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findLocaleBlock, localeKeys, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";
import { TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
import { plural, slavicPlural } from "@/lib/plural";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * A word standing next to a count, in all six languages.
 *
 * `lib/plural.ts` states the two rules and `__tests__/plural.test.ts` checks
 * both branches; neither says anything about whether the MAP uses them. That
 * gap is exactly how the defect this suite exists for survived — and survived
 * twice, because the tree already had agreement logic when it was written.
 * Four of the sixteen count-bearing keys agreed something (`en.deleteItemsTitle`
 * and the two `syncingPill*` keys had inline ternaries, `ru.selectedCount` had
 * the Slavic rule by hand); the other twelve were flat templates carrying the
 * plural form. Under the number one they read:
 *
 *   "1 items", "1 photos", "Shared with 1 people", "Moved 1 items"     (en)
 *   "1 Objekte", "Mit 1 Personen geteilt"                              (de)
 *   "1 objetos", "Cargar más (1 restantes)"                            (es)
 *   "1 предметов", "1 прадметаў", "1 przedmiotów"                      (ru/be/pl)
 *
 * Including the BASE map, which is the part worth sitting with: this was not a
 * translation lagging behind English, it was English. A collection holding one
 * item is the most ordinary state in the app.
 *
 * Nothing could report it. Those keys are DECLARED in all six locales, so
 * every coverage percentage counts them as done and every completeness suite
 * passes: they are translated, and translated wrongly. A count of decisions
 * made cannot see a decision made badly, which is the boundary of what six
 * runs of coverage work measured and the reason this is a rule of its own.
 *
 * THE RULE: a value that interpolates the count and then puts a WORD next to
 * it must take that word from `lib/plural.ts`. Deliberately syntactic — it
 * cannot tell a noun from a participle, and does not need to. What it catches
 * is the shape "number, then a word somebody wrote once", which is the shape
 * that cannot be right for every number.
 *
 * NOT applied to the other shapes, which are most of the map: `Перамешчана: 5`
 * puts the number after a colon, `Filters (3)` brackets it, `noch 5` and
 * `zostało 5` end on it. Those agree with nothing and are correct flat — the
 * rule only fires where a word FOLLOWS the number.
 *
 * Which of the two functions a locale needs is not checked here, on purpose. A
 * three-form language calling `plural` would be a real defect and it is a
 * defect about vocabulary, not shape: the honest check is that somebody chose,
 * and `__tests__/plural.test.ts` plus the last case below are where the forms
 * themselves are pinned.
 */

const source = readI18nSource();

/**
 * The interpolated count with a word immediately after it.
 *
 * `${…}` and a backtick end the match without firing, which is what makes a
 * `plural(…)` interpolation the fix rather than an exemption: the helper call
 * IS an interpolation, so a corrected value stops matching. Punctuation after
 * the number — `)`, `,`, `:`, `.`, `…`, an em dash — is the "agrees with
 * nothing" shape and passes.
 */
const WORD_AFTER_COUNT = /\$\{params\?\.count \?\? 0\}\s+[^\s$`)(,:;.…—-]/;

/**
 * Values where a word follows the count and the word does not inflect.
 *
 * Five entries, and every one of them is a word that is genuinely the same
 * for every number rather than a value somebody did not want to fix. Two are
 * the same indeclinable loanword in two languages; three are English
 * participles, which do not agree with anything in English at all.
 *
 * A reason per entry rather than a bare set, for the reason the
 * `UNTRANSLATABLE_KEYS` header gives: an exemption is a line nobody has to
 * justify again, and the smallest defence is making somebody write down why
 * where the next reader will see it. The test for membership is whether the
 * word is the SAME at one and at five — not whether writing the forms out is
 * inconvenient.
 */
const INVARIANT: Readonly<Record<string, string>> = {
  "ru.photosCount": "фото is an indeclinable loanword — 1 фото, 2 фото, 5 фото",
  "be.photosCount": "фота is indeclinable in Belarusian, same as its Russian cognate",
  "en.selectedCount": "'selected' is a past participle and does not agree — 1 selected, 5 selected",
  "en.loadMoreItems": "'remaining' is a participle — 1 remaining, 5 remaining",
  "en.loadMoreItemsA11y": "'remaining' is a participle, same string as loadMoreItems",
};

/** Every base key one locale declares a count-bearing value for. */
function countedValues(language: string, baseKeys: readonly string[]) {
  const block = findLocaleBlock(source, language);
  if (!block) return [];
  return baseKeys
    .map((key) => ({ key, value: block.values.get(key) }))
    .filter((entry): entry is { key: string; value: string } =>
      entry.value !== undefined && entry.value.includes("params?.count"),
    );
}

describe("every locale agrees its words with the count", () => {
  const baseKeys = [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)];

  it("parses enough of the map for the scan below to mean anything", () => {
    // Every case here is a filter over declared values, and a parse that came
    // back empty would make all of them pass while checking nothing.
    assert.ok(baseKeys.length >= 400, `only ${baseKeys.length} base keys parsed`);
    for (const language of TRANSLATION_LANGUAGES) {
      const counted = countedValues(language, baseKeys);
      assert.ok(
        counted.length >= 5,
        `'${language}' declares only ${counted.length} count-bearing value(s) — the scan has nothing to look at`,
      );
    }
  });

  it("takes every word beside a count from lib/plural.ts", () => {
    const flat: string[] = [];
    for (const language of TRANSLATION_LANGUAGES) {
      for (const { key, value } of countedValues(language, baseKeys)) {
        if (!WORD_AFTER_COUNT.test(value)) continue;
        if (`${language}.${key}` in INVARIANT) continue;
        if (/\bplural\(/.test(value)) continue;
        flat.push(`${language}.${key}: ${value.replace(/\s+/g, " ")}`);
      }
    }
    assert.deepEqual(
      flat,
      [],
      `these values put a word next to the count without agreeing it — under the number one they read as plurals ("1 items"):\n  ${flat.join("\n  ")}`,
    );
  });

  it("names no exemption that has stopped applying", () => {
    // An entry for a value that no longer matches the scan exempts nothing and
    // looks exactly like one that works — the same failure `UNTRANSLATABLE_KEYS`
    // is checked against the base map for.
    for (const [entry, reason] of Object.entries(INVARIANT)) {
      const [language, key] = entry.split(".");
      const value = findLocaleBlock(source, language)?.values.get(key);
      assert.ok(value !== undefined, `'${entry}' is exempt and '${language}' does not declare it`);
      assert.ok(
        WORD_AFTER_COUNT.test(value),
        `'${entry}' is exempt and no longer puts a word after the count, so the exemption is dead: ${reason}`,
      );
      assert.ok(reason.length >= 20, `'${entry}' is exempt without a real reason`);
    }
  });

  it("still fires on the shape it was written for", () => {
    // The rule is a regex over source text and its whole value is that it
    // matches "number, then a word". Pinned against the defect as it was
    // actually written, and against the fix, so a loosened pattern that
    // stopped seeing either is a failure rather than a green scan.
    for (const defect of [
      "(params?: TranslationParams) => `${params?.count ?? 0} предметов`",
      "(params?: TranslationParams) => `${params?.count ?? 0} items`",
      "(params?: TranslationParams) => `Mit ${params?.count ?? 0} Personen geteilt`",
    ]) {
      assert.ok(WORD_AFTER_COUNT.test(defect), `the scan no longer sees: ${defect}`);
    }
    for (const fixed of [
      '(params?: TranslationParams) => `${params?.count ?? 0} ${plural(params?.count, "item", "items")}`',
      '(params?: TranslationParams) => `${params?.count ?? 0} ${slavicPlural(params?.count, "предмет", "предмета", "предметов")}`',
    ]) {
      assert.ok(!WORD_AFTER_COUNT.test(fixed), `the scan fires on a value that already agrees: ${fixed}`);
    }

    // And the shapes that agree with nothing, which are most of the map: a
    // pattern that flagged these would make the rule unusable and get it
    // exempted key by key until it meant nothing.
    for (const fine of [
      "(params?: TranslationParams) => `Перамешчана: ${params?.count ?? 0}`",
      "(params?: TranslationParams) => `Filter (${params?.count ?? 0})`",
      "(params?: TranslationParams) => `Mehr laden (noch ${params?.count ?? 0})`",
      "(params?: TranslationParams) => `Cargar más objetos — ${params?.count ?? 0}`",
    ]) {
      assert.ok(!WORD_AFTER_COUNT.test(fine), `the scan fires on a correct flat value: ${fine}`);
    }
  });

  it("renders a different word at one than at five, in every language", () => {
    // The end of the chain the rest of this file only approaches through
    // source text: the forms the map now passes, evaluated. Reading the same
    // at 1 and at 5 IS the defect, restated as the thing a user would have
    // seen, and asserted per language rather than for the rule in general.
    const forms = [
      { language: "en", key: "itemsCount", one: "item", other: "items" },
      { language: "de", key: "itemsCount", one: "Objekt", other: "Objekte" },
      { language: "es", key: "itemsCount", one: "objeto", other: "objetos" },
    ] as const;
    for (const { language, key, one, other } of forms) {
      assert.equal(plural(1, one, other), one, `'${language}' at 1`);
      assert.equal(plural(0, one, other), other, `'${language}' at 0`);
      assert.equal(plural(5, one, other), other, `'${language}' at 5`);
      assertNamesForms(language, key, [one, other]);
    }

    const slavic = [
      { language: "ru", key: "itemsCount", one: "предмет", few: "предмета", many: "предметов" },
      { language: "be", key: "itemsCount", one: "прадмет", few: "прадметы", many: "прадметаў" },
      { language: "pl", key: "itemsCount", one: "przedmiot", few: "przedmioty", many: "przedmiotów" },
    ] as const;
    for (const { language, key, one, few, many } of slavic) {
      assert.equal(slavicPlural(1, one, few, many), one, `'${language}' at 1`);
      assert.equal(slavicPlural(3, one, few, many), few, `'${language}' at 3`);
      assert.equal(slavicPlural(5, one, few, many), many, `'${language}' at 5`);
      assert.equal(slavicPlural(11, one, few, many), many, `'${language}' at 11`);
      assertNamesForms(language, key, [one, few, many]);
    }
  });
});

/**
 * Asserts the locale's value actually names these forms.
 *
 * Without this the case above tests `lib/plural.ts` twice and the map not at
 * all: a locale that renamed its noun would leave the assertions green against
 * a list nobody updated.
 */
function assertNamesForms(language: string, key: string, forms: readonly string[]): void {
  const value = findLocaleBlock(source, language)?.values.get(key) ?? "";
  for (const form of forms) {
    assert.ok(
      value.includes(`"${form}"`),
      `'${language}'.${key} does not name the form '${form}': ${value.replace(/\s+/g, " ")}`,
    );
  }
}
