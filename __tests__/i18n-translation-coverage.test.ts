import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  TRANSLATION_BASE_LANGUAGE,
  TRANSLATION_FLOORS,
  TRANSLATION_LANGUAGES,
  coveragePercent,
  declaredKeysByIndentation,
  findLocaleBlock,
  formatCoverageRow,
  parseObjectLiteral,
  translationCoverage,
} from "@/lib/i18n-coverage";

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
 * rather than imported — the same pattern as `i18n-translations.test.ts` and
 * `i18n-locale-map-parity.test.ts`, with the regex replaced by a scanner that
 * understands strings and template literals.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

const COVERAGE = translationCoverage(SOURCE);
const rowFor = (language: string) => {
  const row = COVERAGE.find((entry) => entry.language === language);
  assert.ok(row, `no coverage row for '${language}'`);
  return row!;
};

describe("translation literal parser", () => {
  it("reads the keys and the spread of a plain map", () => {
    const parsed = parseObjectLiteral(`
  ...en,
  first: "one",
  second: "two",
`);
    assert.deepEqual(parsed.keys, ["first", "second"]);
    assert.deepEqual(parsed.spreads, ["en"]);
  });

  it("does not read braces inside a string value as structure", () => {
    // The brace-counting version of this parser reported one key here and then
    // ran off the end of the literal looking for a close.
    const parsed = parseObjectLiteral(`
  opener: "a { brace",
  closer: "a } brace",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["opener", "closer", "after"]);
  });

  it("does not read a template ternary's colon as a key separator", () => {
    // `Number(count) === 1 ? "item" : "items"` is a colon inside a `${}` slot,
    // which a line-oriented scan sees at the literal's own level.
    const parsed = parseObjectLiteral(`
  plural: (params?: TranslationParams) =>
    \`Delete \${params?.count ?? 0} \${Number(params?.count) === 1 ? "item" : "items"}?\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["plural", "after"]);
  });

  it("treats a template's `${}` slot as code rather than as more text", () => {
    // The one input that tells the two readings apart. A slot holding a NESTED
    // template balances either way — backticks come in pairs, so a scan that
    // reads the slot as text still ends the outer literal in the right place by
    // luck. A slot holding a string that CONTAINS a backtick does not: read as
    // text, that backtick closes the outer template, the `}` after it is taken
    // for the literal's own closing brace, and every key below this one
    // disappears from the count without anything looking wrong.
    const parsed = parseObjectLiteral(
      '\n  nested: (p) => `a ${p.n ? "`" : ""} b`,\n  after: "still here",\n',
    );
    assert.deepEqual(parsed.keys, ["nested", "after"]);
  });

  it("does not read a function body's own keys", () => {
    const parsed = parseObjectLiteral(`
  outer: (params?: TranslationParams) => {
    const inner = { nested: 1, alsoNested: 2 };
    return \`\${inner.nested}\`;
  },
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["outer", "after"]);
  });

  it("does not read a URL inside a string as a comment", () => {
    // Real row: `runtimeConfigUrlPlaceholder: "https://your-project.supabase.co"`.
    const parsed = parseObjectLiteral(`
  url: "https://your-project.supabase.co",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["url", "after"]);
  });

  it("skips comments and escaped quotes", () => {
    const parsed = parseObjectLiteral(`
  // leading: "not a key",
  real: "value",
  /* blockKey: "also not a key" */
  quoted: "she said \\"hi: there\\"",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["real", "quoted", "after"]);
  });

  it("stops at the brace that closes the literal", () => {
    const source = `const a = {\n  only: "1",\n};\n\nconst b = {\n  ...en,\n  other: "2",\n};\n`;
    const a = findLocaleBlock(source, "a");
    assert.ok(a);
    assert.deepEqual(a!.keys, ["only"]);
    assert.equal(a!.body.includes("other"), false);
    const b = findLocaleBlock(source, "b");
    assert.deepEqual(b!.keys, ["other"]);
  });

  it("returns null for a language with no map", () => {
    assert.equal(findLocaleBlock(`const en = {\n  a: "1",\n};\n`, "fr"), null);
  });

  it("reads the TranslationMap annotation the non-base maps carry", () => {
    const block = findLocaleBlock(
      `const ru: TranslationMap = {\n  ...en,\n  a: "1",\n};\n`,
      "ru",
    );
    assert.ok(block);
    assert.equal(block!.inheritsBase, true);
    assert.deepEqual(block!.keys, ["a"]);
  });
});

describe("translation literal parser — second derivation", () => {
  // The scanner reads syntax; `declaredKeysByIndentation` reads prettier's
  // output. Two statements of "what does this literal declare" that can
  // disagree, which is the point: a scanner bug that swallows entries shows up
  // here rather than as a smaller number that still looks plausible.
  for (const language of TRANSLATION_LANGUAGES) {
    it(`agrees with the indentation derivation for '${language}'`, () => {
      const block = findLocaleBlock(SOURCE, language);
      assert.ok(block, `no '${language}' map`);
      assert.deepEqual(
        [...block!.keys],
        [...declaredKeysByIndentation(block!.body)],
        `the two derivations disagree about what '${language}' declares`,
      );
    });
  }

  it("the two derivations can disagree, so the agreement above is worth asserting", () => {
    // A continuation line inside a multi-line template: the indentation rule
    // reads `fake` as a key, the scanner reads it as text.
    const spanning = "\n  note: `line one\n  fake: still inside the template`,\n";
    assert.deepEqual(parseObjectLiteral(spanning).keys, ["note"]);
    assert.deepEqual(declaredKeysByIndentation(spanning), ["note", "fake"]);

    // And the other direction: two entries on one line, which the indentation
    // rule can only ever see the first of.
    const packed = `\n  first: "one", second: "two",\n`;
    assert.deepEqual(parseObjectLiteral(packed).keys, ["first", "second"]);
    assert.deepEqual(declaredKeysByIndentation(packed), ["first"]);
  });
});

describe("translation coverage", () => {
  it("covers every language the picker offers, and no others", () => {
    // `languageOptions` is what the UI actually surfaces; a language added
    // there and not here would never be measured.
    const block = SOURCE.match(
      /languageOptions\s*:\s*\{\s*code[\s\S]*?\}\s*\[\s*\]\s*=\s*\[([\s\S]*?)\];/,
    );
    assert.ok(block, "languageOptions declaration not found");
    const offered = [...block![1].matchAll(/code:\s*"([a-z-]+)"/g)].map((m) => m[1]);
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
    assert.match(report, /en: 538\/538 keys \(100\.0%\)/);
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
