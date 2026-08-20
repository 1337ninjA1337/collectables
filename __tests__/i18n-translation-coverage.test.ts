import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSLATION_BASE_LANGUAGE,
  TRANSLATION_FLOORS,
  TRANSLATION_LANGUAGES,
  coveragePercent,
  formatCoverageRow,
  translationCoverage,
} from "@/lib/i18n-coverage";
import { findLocaleBlock, languageOptionCodes } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * The silent-fallback gap, turned into a number.
 *
 * Every locale map in `lib/i18n-context.tsx` opens with `...en`, so a key
 * nobody translated renders as English rather than as an error — which is the
 * right runtime behaviour and the reason `deleteItem` sat in three of six
 * languages until an accessibility label reached for it. No assertion in this
 * repository could have seen that: `t("deleteItem")` returns a non-empty string
 * in all six.
 *
 * So this suite publishes what each language actually declares, floors it so a
 * locale cannot silently LOSE translations, and pins the base language's
 * inherited list by name. It does not gate the inherited counts — a new English
 * string ships before its five translations, and a ceiling there would go red
 * on every feature PR (see the reasoning on `TRANSLATION_FLOORS`).
 *
 * `lib/i18n-context.tsx` pulls React Native peers, so the source is parsed
 * rather than imported. The parsing is `lib/i18n-source.ts` — one reader for
 * that file, shared with the three other suites that ask questions about it,
 * and defended in `__tests__/i18n-source.test.ts`. What is counted here is what
 * that parser found.
 */

const SOURCE = readI18nSource();

const COVERAGE = translationCoverage(SOURCE);
const rowFor = (language: string) => {
  const row = COVERAGE.find((entry) => entry.language === language);
  assert.ok(row, `no coverage row for '${language}'`);
  return row!;
};

describe("translation coverage", () => {
  it("covers every language the picker offers, and no others", () => {
    // `languageOptions` is what the UI actually surfaces; a language added
    // there and not here would never be measured.
    const offered = languageOptionCodes(SOURCE);
    assert.deepEqual([...offered].sort(), [...TRANSLATION_LANGUAGES].sort());
  });

  it("every non-base map inherits the base map", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      const block = findLocaleBlock(SOURCE, language);
      assert.ok(block);
      if (language === TRANSLATION_BASE_LANGUAGE) {
        assert.deepEqual(
          block!.spreads,
          [],
          "the base map spreading something would make the denominator someone else's",
        );
      } else {
        assert.equal(
          block!.inheritsBase,
          true,
          `'${language}' does not spread '${TRANSLATION_BASE_LANGUAGE}' — every key it omits would be undefined at runtime, not English`,
        );
      }
    }
  });

  it("declares no key twice in any language", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      const keys = findLocaleBlock(SOURCE, language)!.keys;
      const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
      assert.deepEqual(
        duplicates,
        [],
        `'${language}' declares ${duplicates.join(", ")} more than once — the later value silently wins`,
      );
    }
  });

  it("declares no key the base map does not have", () => {
    for (const row of COVERAGE) {
      assert.deepEqual(
        row.unknown,
        [],
        `'${row.language}' declares ${row.unknown.join(", ")}, which is in no base map — a typo'd key is dead weight that nothing reads`,
      );
    }
  });

  it("the base language inherits nothing and sets the denominator", () => {
    const base = rowFor(TRANSLATION_BASE_LANGUAGE);
    assert.deepEqual(base.inherited, []);
    assert.equal(base.declared, base.baseKeys);
    assert.equal(coveragePercent(base), 100);
  });

  it("names the three keys Russian still inherits", () => {
    // Small enough to pin by name rather than by count: two of the three are
    // legitimate (a brand and an email address render the same in Russian), and
    // the third is a real gap. A fourth arriving unnoticed is the thing this
    // catches — for the other four locales the list is in the hundreds, so
    // their floors do the watching instead.
    assert.deepEqual(rowFor("ru").inherited, [
      "emailPlaceholder",
      "appName",
      "visibilityPrivatePremiumOnly",
    ]);
  });

  it("every locale declares the delete-item family", () => {
    // The finding this suite was written for: `deleteItem` existed in three of
    // six languages, and `deleteItemTitle`/`deleteItemText` in two, while every
    // test that renders them passed on the English fallback.
    for (const language of TRANSLATION_LANGUAGES) {
      const keys = new Set(findLocaleBlock(SOURCE, language)!.keys);
      for (const key of ["deleteItem", "deleteItemTitle", "deleteItemText"]) {
        assert.ok(keys.has(key), `'${language}' does not translate '${key}'`);
      }
    }
  });

  it("throws for a language that has no map at all", () => {
    assert.throws(
      () => translationCoverage(SOURCE, ["fr"]),
      /no `const fr` translation map/,
      "answering '0% translated' would read as a finding about the translations",
    );
  });

  it("throws when there is no base map to measure against", () => {
    assert.throws(
      () => translationCoverage(`const ru: TranslationMap = {\n  a: "1",\n};\n`),
      /no `const en` map/,
    );
  });

  it("counts inherited keys in base order, against a source it can be checked by hand", () => {
    const source = [
      `const en = {`,
      `  first: "one",`,
      `  second: "two",`,
      `  third: "three",`,
      `  fourth: "four",`,
      `} as const;`,
      ``,
      `const ru: TranslationMap = {`,
      `  ...en,`,
      `  third: "три",`,
      `  first: "один",`,
      `};`,
      ``,
    ].join("\n");
    const [en, ru] = translationCoverage(source, ["en", "ru"]);
    assert.equal(en.declared, 4);
    assert.equal(ru.declared, 2);
    assert.deepEqual(ru.inherited, ["second", "fourth"]);
    assert.equal(ru.baseKeys, 4);
    assert.equal(coveragePercent(ru), 50);
    assert.equal(
      formatCoverageRow(ru),
      "ru: 2/4 keys (50.0%), 2 inherited from en",
    );
  });

  it("rounds the published percentage to one decimal", () => {
    const row = { language: "x", declared: 1, inherited: ["a", "b"], baseKeys: 3, unknown: [] };
    assert.equal(coveragePercent(row), 33.3);
    assert.equal(coveragePercent({ ...row, baseKeys: 0, inherited: [] }), 0);
  });
});

describe("translation floors", () => {
  it("declares a floor for every language and none for anything else", () => {
    assert.deepEqual(
      Object.keys(TRANSLATION_FLOORS).sort(),
      [...TRANSLATION_LANGUAGES].sort(),
    );
  });

  for (const language of TRANSLATION_LANGUAGES) {
    it(`'${language}' has not lost translations`, () => {
      const floor = TRANSLATION_FLOORS[language];
      const row = rowFor(language);
      assert.ok(
        row.declared >= floor.minimum,
        `'${language}' declares ${row.declared} keys, below the committed floor of ${floor.minimum} — translations do not get deleted on purpose, so this is a bad merge or a lost block. ${formatCoverageRow(row)}`,
      );
    });
  }

  it("every floor is a positive integer with slack under the measurement", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      const floor = TRANSLATION_FLOORS[language];
      assert.ok(
        Number.isInteger(floor.minimum) && floor.minimum > 0,
        `'${language}' floor of ${floor.minimum} is not a positive integer`,
      );
      assert.ok(
        floor.minimum < rowFor(language).declared,
        `'${language}' floor sits at or above the current count, so ordinary churn — one deleted English key removing a translated one with it — turns it red`,
      );
    }
  });

  it("every floor note records what was measured and when", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      const { note } = TRANSLATION_FLOORS[language];
      assert.ok(note.trim().length > 0, `'${language}' floor carries no note`);
      assert.match(
        note,
        /\d{4}-\d{2}-\d{2}/,
        `'${language}' floor note names no date — an undated measurement is a magic constant with prose around it`,
      );
    }
  });

  it("publishes the honest number for every language", () => {
    // Not an assertion so much as the report: six languages are offered, one is
    // complete, and four sit below half. The `assert.ok(true)` keeps the line
    // in the runner's output next to the rows above it.
    const report = COVERAGE.map(formatCoverageRow).join("\n");
    // 540 as of 2026-08-20: the two `languagePartial*` keys the settings picker
    // needs to say a language is partly translated, added to all six locales in
    // the same change — which is why every row rose by two rather than the
    // partial ones falling.
    assert.match(report, /en: 540\/540 keys \(100\.0%\)/);
    assert.ok(
      COVERAGE.every((row) => row.baseKeys === rowFor("en").declared),
      "every row must be measured against the same denominator",
    );
    assert.ok(
      COVERAGE.filter((row) => coveragePercent(row) < 50).length === 4,
      `four of the six locales sit below half; the report reads:\n${report}`,
    );
  });
});
