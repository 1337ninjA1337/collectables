import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
import { findLocaleBlock } from "@/lib/i18n-source";
import { stripComments } from "@/lib/strip-comments";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * Each locale quotes with its own marks.
 *
 * Eight of the item-filter strings name a field inside quotation marks —
 * `“Price from” must be a number.` — and each language wants a different pair.
 * Pasting the English `“…”` through into Polish is invisible to every other
 * check in this repository: the key is declared, the words around it are
 * translated, and the coverage counter is satisfied. It is only wrong to a
 * reader of that language.
 *
 * **The rule cannot be "no English quotes".** `de` closes with `“` and `pl`
 * closes with `”`, so both English marks are legitimate somewhere. What is
 * checkable is narrower and exact: every curly quote inside a locale's block
 * must be one of THAT locale's two, which still catches the paste — an English
 * `“…”` in `de` brings a `”` that `de` never uses, and in `pl` brings a `“`
 * that `pl` never uses.
 */

const source = readI18nSource();

/** Opening and closing marks, per locale. */
const QUOTES: Readonly<Record<string, readonly [string, string]>> = {
  en: ["“", "”"], // “…”
  ru: ["«", "»"], // «…»
  be: ["«", "»"], // «…»
  pl: ["„", "”"], // „…”
  de: ["„", "“"], // „…“
  es: ["«", "»"], // «…»
};

/** Every curly mark any locale here uses, so a stray one is findable. */
const ALL_MARKS = [...new Set(Object.values(QUOTES).flat())];

/**
 * One locale's map, comments blanked.
 *
 * Not optional politeness: a comment near these declarations naturally SAYS
 * which marks the locale uses, and the first version of this suite reported
 * its own explanatory header in all four partial locales. A rule that fires on
 * prose about itself is a rule that gets exempted.
 */
function blockBody(language: string): string {
  const block = findLocaleBlock(source, language);
  assert.ok(block, `no locale block for '${language}'`);
  return stripComments(block.body);
}

describe("quotation marks per locale", () => {
  it("declares a pair for every language and nothing else", () => {
    assert.deepEqual(Object.keys(QUOTES).sort(), [...TRANSLATION_LANGUAGES].sort());
  });

  it("gives every language two distinct marks", () => {
    for (const [language, [open, close]] of Object.entries(QUOTES)) {
      assert.notEqual(open, close, `'${language}' opens and closes with the same mark`);
    }
  });

  for (const language of TRANSLATION_LANGUAGES) {
    it(`'${language}' uses only its own marks`, () => {
      const [open, close] = QUOTES[language];
      const mine = new Set([open, close]);
      const body = blockBody(language);
      const strays = ALL_MARKS.filter((mark) => !mine.has(mark) && body.includes(mark));
      assert.deepEqual(
        strays,
        [],
        `'${language}' contains ${strays.map((m) => JSON.stringify(m)).join(", ")}, which is not one of its own marks (${JSON.stringify(open)}…${JSON.stringify(close)}). This is what an English string pasted through looks like.`,
      );
    });

    it(`'${language}' opens as often as it closes`, () => {
      // The half-converted string: somebody replaced the opener and left the
      // closer, which passes the case above whenever both marks happen to
      // belong to this locale — `pl` writing `„Cena od“` is exactly that, since
      // `„` is its opener and `“` is nobody's business but `de`'s… except `de`
      // and `pl` share `„`, so the counts are what tells them apart.
      const [open, close] = QUOTES[language];
      const body = blockBody(language);
      const opens = body.split(open).length - 1;
      const closes = body.split(close).length - 1;
      assert.equal(
        opens,
        closes,
        `'${language}' has ${opens} ${JSON.stringify(open)} and ${closes} ${JSON.stringify(close)} — a quoted phrase is missing one half`,
      );
    });
  }

  it("is checking something — the quoted strings still exist", () => {
    // A vacuity guard. Every case above passes trivially on a file with no
    // quotation marks in it at all, which is what deleting the filter family's
    // validation messages would leave behind.
    const quoted = TRANSLATION_LANGUAGES.filter((language) =>
      blockBody(language).includes(QUOTES[language][0]),
    );
    assert.deepEqual(
      [...quoted].sort(),
      [...TRANSLATION_LANGUAGES].sort(),
      "some locale has no quoted strings left — this suite has stopped meaning anything for it",
    );
  });
});
