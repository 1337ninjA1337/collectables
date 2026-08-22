import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findLocaleBlock, localeKeys, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";
import { slavicPlural } from "@/lib/plural-slavic";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * A noun standing next to a count, in the three languages where it has to
 * agree with one.
 *
 * `lib/plural-slavic.ts` states the rule and `__tests__/plural-slavic.test.ts`
 * checks the branch; neither says anything about whether the map USES it. That
 * gap is exactly how the defect this suite exists for survived: the rule was
 * already written twice, inline inside `ru.selectedCount` and
 * `ru.deleteItemsTitle`, and applied to two count-bearing keys out of sixteen.
 * The other fourteen were flat templates carrying the "many" form, so
 * `itemsCount` rendered "1 предметов", "1 прадметаў" and "1 przedmiotów" — the
 * plural under the number one, on the screen a collector with one item sees.
 *
 * Nothing could report it. Those keys are DECLARED in all six locales, so
 * every coverage number counts them as done and every family suite passes:
 * they are translated, and translated wrongly. A count of decisions cannot see
 * a decision made badly, which is the boundary of what the coverage work
 * measures and the reason this is a separate rule rather than another case
 * over there.
 *
 * THE RULE: in `ru`, `be` and `pl`, a value that interpolates the count and
 * then puts a word next to it must call `slavicPlural`. Deliberately syntactic
 * — it cannot tell a noun from an adverb, and it does not need to: what it
 * catches is the shape "number, then a word that was written once", which is
 * the shape that cannot be right in three forms.
 *
 * NOT applied to `en`, `de` or `es`. Two-form languages get their agreement
 * from a ternary at the call site (`change${count === 1 ? "" : "s"}`), and a
 * rule demanding a three-form helper there would be demanding the wrong
 * grammar.
 *
 * NOT applied to the other shapes either, and that is most of the map:
 * `Перамешчана: 5` puts the number after a colon, `Фільтры (3)` parenthesises
 * it, `осталось ${count}` ends on it. Those agree with nothing and are correct
 * flat — the rule only fires where a word FOLLOWS the number.
 */

const source = readI18nSource();

/** The languages whose nouns take one, few and many forms. */
const SLAVIC = ["ru", "be", "pl"] as const;

/**
 * The interpolated count with a word immediately after it.
 *
 * `${…}` and a backtick end the match without firing, which is what makes a
 * `slavicPlural(…)` interpolation the fix rather than an exemption: the helper
 * call IS an interpolation, so a corrected value no longer matches. Punctuation
 * after the number — `)`, `,`, `:`, `.`, `…`, an em dash — is the "agrees with
 * nothing" shape and passes.
 */
const WORD_AFTER_COUNT = /\$\{params\?\.count \?\? 0\}\s+[^\s$`)(,:;.…—-]/;

/**
 * Values where a word follows the count and the word does not decline.
 *
 * One word, in two locales, and it is the same loanword: *фото* / *фота* is
 * indeclinable in both Russian and Belarusian, so "1 фота" and "5 фота" are
 * both correct and a three-form helper would have three identical arguments.
 * Polish is not here because Polish declines it (`zdjęcie`/`zdjęcia`/`zdjęć`)
 * and `pl.photosCount` uses the helper.
 *
 * A reason per entry rather than a bare list, for the reason the
 * `UNTRANSLATABLE_KEYS` header gives: an exemption is a line nobody has to
 * justify again, and the smallest defence is making somebody write down why.
 * The test for membership is whether the word is the SAME in all three forms —
 * not whether writing it out is inconvenient.
 */
const INDECLINABLE: Readonly<Record<string, string>> = {
  "ru.photosCount": "фото is an indeclinable loanword — 1 фото, 2 фото, 5 фото",
  "be.photosCount": "фота is indeclinable in Belarusian, same as its Russian cognate",
};

describe("Slavic locales agree their nouns with the count", () => {
  const baseKeys = [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)];

  it("parses enough of the map for the scan below to mean anything", () => {
    // Every case here is a filter over declared values, and a parse that came
    // back empty would make all of them pass while checking nothing.
    assert.ok(baseKeys.length >= 400, `only ${baseKeys.length} base keys parsed`);
    for (const language of SLAVIC) {
      const block = findLocaleBlock(source, language);
      assert.ok(block, `no '${language}' locale block`);
      const counted = baseKeys.filter((key) => block.values.get(key)?.includes("params?.count"));
      assert.ok(
        counted.length >= 5,
        `'${language}' declares only ${counted.length} count-bearing value(s) — the scan has nothing to look at`,
      );
    }
  });

  it("uses slavicPlural wherever a word follows the count", () => {
    const flat: string[] = [];
    for (const language of SLAVIC) {
      const block = findLocaleBlock(source, language);
      if (!block) continue;
      for (const key of baseKeys) {
        const value = block.values.get(key);
        if (value === undefined) continue;
        if (!WORD_AFTER_COUNT.test(value)) continue;
        if (`${language}.${key}` in INDECLINABLE) continue;
        if (value.includes("slavicPlural(")) continue;
        flat.push(`${language}.${key}: ${value.replace(/\s+/g, " ")}`);
      }
    }
    assert.deepEqual(
      flat,
      [],
      `these values put a word next to the count without agreeing it — under the number one they read as plurals ("1 предметов"):\n  ${flat.join("\n  ")}`,
    );
  });

  it("names no exemption that has stopped applying", () => {
    // An entry for a value that no longer matches the scan exempts nothing and
    // looks exactly like one that works — the same failure `UNTRANSLATABLE_KEYS`
    // is checked against the base map for.
    for (const [entry, reason] of Object.entries(INDECLINABLE)) {
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
    const defect = "(params?: TranslationParams) => `${params?.count ?? 0} предметов`";
    assert.ok(WORD_AFTER_COUNT.test(defect), "the scan no longer sees a bare noun after the count");
    const fixed =
      '(params?: TranslationParams) => `${params?.count ?? 0} ${slavicPlural(params?.count, "предмет", "предмета", "предметов")}`';
    assert.ok(!WORD_AFTER_COUNT.test(fixed), "the scan fires on a value that already agrees");

    // And the shapes that agree with nothing, which are most of the map: a
    // pattern that flagged these would make the rule unusable and get it
    // exempted key by key.
    for (const fine of [
      "(params?: TranslationParams) => `Перамешчана: ${params?.count ?? 0}`",
      "(params?: TranslationParams) => `Фільтры (${params?.count ?? 0})`",
      "(params?: TranslationParams) => `Загрузіць яшчэ (засталося ${params?.count ?? 0})`",
    ]) {
      assert.ok(!WORD_AFTER_COUNT.test(fine), `the scan fires on a correct flat value: ${fine}`);
    }
  });

  it("renders the singular under one, in each of the three languages", () => {
    // The end of the chain the rest of this file only approaches through
    // source text: the forms the map now passes, evaluated. `1` must not
    // produce the same word as `5`, which is the entire defect, restated as
    // the thing a user would have seen.
    const forms = [
      { language: "ru", one: "предмет", few: "предмета", many: "предметов" },
      { language: "be", one: "прадмет", few: "прадметы", many: "прадметаў" },
      { language: "pl", one: "przedmiot", few: "przedmioty", many: "przedmiotów" },
    ] as const;
    for (const { language, one, few, many } of forms) {
      assert.equal(slavicPlural(1, one, few, many), one, `'${language}' at 1`);
      assert.equal(slavicPlural(3, one, few, many), few, `'${language}' at 3`);
      assert.equal(slavicPlural(5, one, few, many), many, `'${language}' at 5`);
      assert.notEqual(
        slavicPlural(1, one, few, many),
        slavicPlural(5, one, few, many),
        `'${language}' reads the same at 1 and 5, which is the defect this suite exists for`,
      );
      // The forms are the ones the map declares, so a locale that renamed a
      // noun without updating this list is caught rather than shadowed.
      const value = findLocaleBlock(source, language)?.values.get("itemsCount") ?? "";
      for (const form of [one, few, many]) {
        assert.ok(
          value.includes(`"${form}"`),
          `'${language}'.itemsCount does not name the form '${form}': ${value.replace(/\s+/g, " ")}`,
        );
      }
    }
  });
});
