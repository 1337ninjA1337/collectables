import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TRANSLATION_BASE_LANGUAGE, TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
import { findLocaleBlock, localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * The empty-state family, translated in every locale.
 *
 * `TRANSLATION_FLOORS` next door is deliberately a floor on the TOTAL count,
 * not a ceiling on what is inherited: a new English string ships before its
 * five translations, so a ceiling would go red on every feature PR. That is
 * the right rule for the map as a whole, and it says nothing about any
 * particular family — a locale can lose eight of these twenty-four and stay
 * far above its floor, and the only symptom is a Polish user reading English
 * on the screen they see first.
 *
 * So this family gets the stricter rule the general case cannot have. It is
 * the right one to single out: an empty state is what a NEW account sees on
 * every tab, and a new account is exactly the user most likely to be reading
 * in the language they just picked. It is also complete — 24 keys, all six
 * locales, no partial rows to exempt — which is what makes all-or-nothing
 * enforceable here and not for the map at large.
 *
 * All-or-nothing rather than a count, deliberately: a count would let the next
 * person add a 25th English key and leave it untranslated forever, which is
 * the state this suite exists to end.
 */

const source = readI18nSource();

/** Every `empty*` key the base language declares. */
const EMPTY_STATE_KEYS = [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)]
  .filter((key) => /^empty[A-Z]/.test(key))
  .sort();

describe("empty-state copy", () => {
  it("finds the family in the base language at all", () => {
    // A vacuity guard, and not a theoretical one: every case below passes
    // trivially if the prefix stops matching — a rename to `emptystate*` or a
    // move into a nested object would turn this whole suite green and empty.
    assert.ok(
      EMPTY_STATE_KEYS.length >= 20,
      `only ${EMPTY_STATE_KEYS.length} empty-state keys found in '${TRANSLATION_BASE_LANGUAGE}' — has the family been renamed?`,
    );
  });

  it("is declared in every language, with nothing inherited from English", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      const declared = localeKeys(source, language);
      const missing = EMPTY_STATE_KEYS.filter((key) => !declared.has(key));
      assert.deepEqual(
        missing,
        [],
        `'${language}' inherits ${missing.length} empty-state key(s) from English: ${missing.join(", ")}. An empty state is the first screen a new account sees on that tab — the worst place in the app to fall back to a language the user did not pick.`,
      );
    }
  });

  it("says something different from English in each language", () => {
    // Declaring the key and pasting the English value satisfies the rule above
    // without meeting it, and the coverage counter cannot see the difference —
    // a declared key counts whatever its value is. Checked on the hint
    // strings, which are the long ones a copy-paste actually reaches for;
    // short CTAs can legitimately coincide between related languages.
    const hints = EMPTY_STATE_KEYS.filter((key) => key.endsWith("Hint"));
    assert.ok(hints.length >= 8, `expected the hints to be the bulk of the family, got ${hints.length}`);
    for (const language of TRANSLATION_LANGUAGES) {
      if (language === TRANSLATION_BASE_LANGUAGE) continue;
      const copied = hints.filter((key) => {
        const mine = valueOf(language, key);
        return mine !== null && mine === valueOf(TRANSLATION_BASE_LANGUAGE, key);
      });
      assert.deepEqual(
        copied,
        [],
        `'${language}' declares ${copied.length} empty-state hint(s) with the English text verbatim: ${copied.join(", ")}`,
      );
    }
  });

  it("reads a real value for every hint in every language", () => {
    // The case above compares two reads and passes when BOTH come back null,
    // which is what a reader that stopped working returns. This is the half
    // that would notice.
    const hints = EMPTY_STATE_KEYS.filter((key) => key.endsWith("Hint"));
    for (const language of TRANSLATION_LANGUAGES) {
      for (const key of hints) {
        const value = valueOf(language, key);
        assert.ok(
          value !== null && value.length > 0,
          `could not read '${language}'.${key} — the reader or the declaration shape changed`,
        );
      }
    }
  });
});

/**
 * Reads one key's literal string out of one locale block, tolerating the
 * line-wrapped form (`key:\n    "…"`) the long hints are written in — there is
 * no prettier here, so both spellings genuinely exist side by side. Returns
 * `null` for a key declared as a function (none in this family today) or
 * absent; the vacuity case above is what stops a `null` being read as
 * agreement.
 */
function valueOf(language: string, key: string): string | null {
  const block = findLocaleBlock(source, language);
  if (!block) return null;
  const re = new RegExp(`(?:^|\\n)\\s{2}${key}:\\s*(?:\\n\\s+)?"((?:[^"\\\\]|\\\\.)*)"`);
  const match = re.exec(block.body);
  return match ? match[1] : null;
}
