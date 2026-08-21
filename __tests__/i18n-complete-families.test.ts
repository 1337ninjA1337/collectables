import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TRANSLATION_BASE_LANGUAGE, TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
import { findLocaleBlock, localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * Families that must be translated in every locale, all or nothing.
 *
 * `TRANSLATION_FLOORS` next door is deliberately a floor on the TOTAL count,
 * not a ceiling on what is inherited: a new English string ships before its
 * five translations, so a ceiling would go red on every feature PR. That is
 * the right rule for the map as a whole, and it says nothing about any
 * particular family — a locale can lose eight of the twenty-four empty states
 * and stay far above its floor, with no symptom except a Polish user reading
 * English on the screen they see first.
 *
 * So a family that HAS been finished gets the stricter rule the general case
 * cannot have. All-or-nothing rather than a count, deliberately: a count would
 * let the next person add a key to a finished family and leave it English
 * forever, which is the state this suite exists to end.
 *
 * A family joins this list when it is complete in all six locales, and not
 * before — a half-translated family listed here is a red suite that gets
 * exempted, which is how a rule stops being read.
 */

const source = readI18nSource();

type Family = {
  /** Human name, used in failure messages. */
  readonly name: string;
  /** Matches every base key in the family. */
  readonly pattern: RegExp;
  /** Measured size, so a family cannot silently shrink out from under a green run. */
  readonly size: number;
  /** Why this family earns the stricter rule. */
  readonly because: string;
};

const FAMILIES: readonly Family[] = [
  {
    name: "empty states",
    pattern: /^empty[A-Z]/,
    size: 24,
    because:
      "an empty state is what a NEW account sees on every tab, and a new account is exactly the user most likely to be reading in the language they just picked",
  },
  {
    name: "wishlist",
    pattern: /^wishlist([A-Z]|$)/,
    size: 14,
    because:
      "the wishlist empty states were translated on 2026-08-21 while `wishlist` itself was not, so the screen read a translated body under an English heading — the seam this family closes",
  },
];

describe("complete i18n families", () => {
  const baseKeys = [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)];

  for (const family of FAMILIES) {
    describe(family.name, () => {
      const keys = baseKeys.filter((key) => family.pattern.test(key)).sort();

      it("is still the size it was measured at", () => {
        // A vacuity guard, and not a theoretical one: every case below passes
        // trivially if the pattern stops matching — a rename or a move into a
        // nested object turns the whole family green and empty. Exact rather
        // than a floor, because a family GROWING is the moment somebody has to
        // translate the new key or take the family off this list; a `>=` would
        // let a 25th key arrive quietly.
        assert.equal(
          keys.length,
          family.size,
          `'${family.name}' now has ${keys.length} base keys, measured at ${family.size}. If a key was added, translate it in all six locales and update the size; if the family was renamed, update the pattern.`,
        );
      });

      it("is declared in every language, with nothing inherited from English", () => {
        for (const language of TRANSLATION_LANGUAGES) {
          const declared = localeKeys(source, language);
          const missing = keys.filter((key) => !declared.has(key));
          assert.deepEqual(
            missing,
            [],
            `'${language}' inherits ${missing.length} '${family.name}' key(s) from English: ${missing.join(", ")} — ${family.because}.`,
          );
        }
      });

      it("says something different from English in each language", () => {
        // Declaring the key and pasting the English value satisfies the rule
        // above without meeting it, and the coverage counter cannot see the
        // difference — a declared key counts whatever its value is. Checked on
        // the long strings, which are what a copy-paste actually reaches for;
        // short labels can legitimately coincide between related languages,
        // and `Premium` is the same word in five of the six.
        const long = keys.filter((key) => (valueOf(TRANSLATION_BASE_LANGUAGE, key) ?? "").length >= 25);
        assert.ok(
          long.length >= 4,
          `'${family.name}' has only ${long.length} long strings — too few for this case to mean anything`,
        );
        for (const language of TRANSLATION_LANGUAGES) {
          if (language === TRANSLATION_BASE_LANGUAGE) continue;
          const copied = long.filter((key) => {
            const mine = valueOf(language, key);
            return mine !== null && mine === valueOf(TRANSLATION_BASE_LANGUAGE, key);
          });
          assert.deepEqual(
            copied,
            [],
            `'${language}' declares ${copied.length} '${family.name}' string(s) with the English text verbatim: ${copied.join(", ")}`,
          );
        }
      });

      it("reads a real value for every long string in every language", () => {
        // The case above compares two reads and passes when BOTH come back
        // null, which is what a reader that stopped working returns. This is
        // the half that would notice.
        const long = keys.filter((key) => (valueOf(TRANSLATION_BASE_LANGUAGE, key) ?? "").length >= 25);
        for (const language of TRANSLATION_LANGUAGES) {
          for (const key of long) {
            const value = valueOf(language, key);
            assert.ok(
              value !== null && value.length > 0,
              `could not read '${language}'.${key} — the reader or the declaration shape changed`,
            );
          }
        }
      });
    });
  }

  it("names no family twice, and no pattern swallows another", () => {
    // Two entries matching the same key would report it under both names, and
    // a pattern like /^wish/ would quietly annex a future `wishGranted`.
    const seen = new Map<string, string>();
    for (const family of FAMILIES) {
      for (const key of baseKeys.filter((k) => family.pattern.test(k))) {
        const owner = seen.get(key);
        assert.equal(
          owner,
          undefined,
          `'${key}' is claimed by both '${owner}' and '${family.name}'`,
        );
        seen.set(key, family.name);
      }
    }
  });
});

/**
 * Reads one key's literal string out of one locale block, tolerating the
 * line-wrapped form (`key:\n    "…"`) the long strings are written in — there
 * is no prettier here, so both spellings genuinely exist side by side. Returns
 * `null` for a key declared as a function (`filterActive` is one, in a family
 * not yet listed here) or absent; the vacuity cases above are what stop a
 * `null` being read as agreement.
 */
function valueOf(language: string, key: string): string | null {
  const block = findLocaleBlock(source, language);
  if (!block) return null;
  const re = new RegExp(`(?:^|\\n)\\s{2}${key}:\\s*(?:\\n\\s+)?"((?:[^"\\\\]|\\\\.)*)"`);
  const match = re.exec(block.body);
  return match ? match[1] : null;
}
