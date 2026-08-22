import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSLATION_BASE_LANGUAGE,
  TRANSLATION_LANGUAGES,
  UNTRANSLATABLE_KEYS,
} from "@/lib/i18n-coverage";
import { findLocaleBlock, localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { keysReadBy } from "./helpers/i18n-keys-read";

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
 *
 * TWO KINDS OF FAMILY, and the second one is why this comment grew.
 *
 * Six entries here are key PREFIXES, and that unit is spent: 175 keys remain
 * English in all four partial locales and the largest remaining prefix group
 * is seven, so a seventh prefix entry would be more ceremony than guard. The
 * unit that groups the remainder the way a user meets it is the SCREEN — every
 * key one file renders — which is also the unit that makes "this screen is
 * half-translated" a checkable claim rather than an impression.
 *
 * A screen family names a file and reads its keys through
 * `lib/i18n-key-usage.ts`, the same index `check-orphan-i18n-keys` decides
 * orphanhood with. That matters more than it sounds: the alternative is a
 * hand-written list of the keys somebody believed the screen rendered, which
 * is a second statement of the file's contents and drifts the moment a string
 * is added. Here the file IS the list, so a new string on a listed screen
 * arrives already inside the rule and has to be translated or the screen has
 * to leave the list.
 *
 * {@link UNTRANSLATABLE_KEYS} are subtracted from both kinds. `appName` and
 * `emailPlaceholder` are correct in English everywhere — the sign-in screen
 * renders the second one — and a rule demanding they be declared in six
 * locales would be demanding the English string be pasted five times.
 */

const source = readI18nSource();

type Family = {
  /** Human name, used in failure messages. */
  readonly name: string;
  /**
   * What the family IS: a pattern over base keys, or the screen whose rendered
   * keys are the family. Exactly one, so "which keys" always has one answer.
   */
  readonly pattern?: RegExp;
  /** Repo-relative path of the screen, for a screen family. */
  readonly screen?: string;
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
  {
    name: "item filters",
    pattern: /^filter[A-Z]/,
    size: 20,
    because:
      "the filter sheet opens from every list screen, and eight of its twenty strings are validation errors — the messages a user reads while already stuck, which is the worst moment to switch languages on them",
  },
  {
    name: "search",
    pattern: /^search[A-Z]/,
    size: 18,
    because:
      "the search overlay was already half-translated — four keys in every locale and fourteen in none, so the same overlay showed a translated placeholder above English result headings",
  },
  {
    name: "marketplace",
    pattern: /^marketplace[A-Z]/,
    size: 73,
    because:
      "the largest family in the map, and the only one that was 61/73 done in four locales — the twelve missing keys were the whole `marketplaceSoldPrompt*` sub-family, which is the dialog a seller meets the moment somebody claims their listing and has to choose between archiving, deleting and keeping the original",
  },
  {
    name: "collection",
    pattern: /^collection[A-Z]/,
    size: 14,
    because:
      "the last prefix family of any size, and the labels on the form a user meets before they own anything — naming a collection is the first thing the app asks anybody to do, so an English form here is the first English a new speaker of any of these four sees",
  },
  {
    name: "sign-in screen",
    screen: "components/login-screen.tsx",
    size: 22,
    because:
      "the first screen of the app and the last one anybody thought to translate — measured on 2026-08-22 as reading 23 base keys of which 23 were English in all four partial locales, the only screen in the tree at zero. A person who has just chosen Polish in the picker meets an English sign-in form, and the twenty-third key is `emailPlaceholder`, which is an address and stays English on purpose",
  },
];

describe("complete i18n families", () => {
  const baseKeys = [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)];

  /**
   * The family's keys, whichever kind it is, minus the exemptions.
   *
   * Sorted for the prefix kind and left in base-map order for the screen kind
   * — `keysReadBy` already answers in base-map order, which groups a screen's
   * keys the way the map does rather than alphabetically.
   */
  const keysOf = (family: Family): readonly string[] => {
    const declared = family.screen
      ? keysReadBy(family.screen)
      : baseKeys.filter((key) => family.pattern!.test(key)).sort();
    return declared.filter((key) => !(key in UNTRANSLATABLE_KEYS));
  };

  it("every entry says which keys it means, exactly once", () => {
    // A `Family` with neither a pattern nor a screen matches nothing, and one
    // with both has two answers to the question this table exists to answer.
    // The type permits both shapes because a discriminated union would make
    // six existing entries noisier than the rule is worth; this is the check
    // that buys that.
    for (const family of FAMILIES) {
      assert.equal(
        Number(family.pattern !== undefined) + Number(family.screen !== undefined),
        1,
        `'${family.name}' must name a pattern or a screen, not neither and not both`,
      );
    }
  });

  for (const family of FAMILIES) {
    describe(family.name, () => {
      const keys = keysOf(family);

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
          `'${family.name}' now has ${keys.length} base keys, measured at ${family.size}. If a key was added, translate it in all six locales and update the size; if the family stopped matching, update its ${family.screen ? "screen path" : "pattern"}.`,
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

      // The keys worth comparing by value: long enough that a copy-paste
      // actually reaches for them. Short labels can legitimately coincide
      // between related languages, and `Premium` is the same word in five of
      // the six. `filterActive` qualifies through its TEMPLATE rather than a
      // string literal — see `valueOf`.
      const long = keys.filter(
        (key) => (valueOf(TRANSLATION_BASE_LANGUAGE, key) ?? "").length >= 25,
      );

      it("says something different from English in each language", () => {
        // Declaring the key and pasting the English value satisfies the rule
        // above without meeting it, and the coverage counter cannot see the
        // difference — a declared key counts whatever its value is.
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

      it("compares the function-valued keys too, not just the literals", () => {
        // `filterActive` is the first function value to land in a listed
        // family, and it is exactly the shape that slips through: a locale can
        // declare `(params) => ⁠`Filters (${…})`⁠` with the English word in it
        // and satisfy every count in this file. So the comparison above must
        // reach it, which means this case has to assert that it DOES — a
        // reader that quietly returned null for functions would make the
        // verbatim check skip them and stay green.
        const functionKeys = keys.filter((key) => isFunctionValued(TRANSLATION_BASE_LANGUAGE, key));
        for (const key of functionKeys) {
          assert.ok(
            long.includes(key),
            `'${key}' is function-valued and is not being compared — the template reader stopped working`,
          );
        }
      });

      it("reads a real value for every long string in every language", () => {
        // The verbatim case compares two reads and passes when BOTH come back
        // null, which is what a reader that stopped working returns. This is
        // the half that would notice.
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
      for (const key of keysOf(family)) {
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
 * Reads one key's translatable TEXT out of one locale block, in either of the
 * two shapes this file uses.
 *
 * A string literal, tolerating the line-wrapped form (`key:\n    "…"`) the
 * long strings are written in — there is no prettier here, so both spellings
 * genuinely exist side by side.
 *
 * Or, for a function-valued key, the body of its template literal —
 * `` `Filters (${params?.count ?? 0})` `` yields ``Filters (${params?.count ??
 * 0})``. The interpolation is deliberately left in rather than stripped: it is
 * identical across locales, so it neither hides a difference nor invents one,
 * and stripping it would need a second brace-aware walk to do correctly.
 * Reading these matters because a function value is the shape most likely to
 * be copied wholesale — the English word sits inside what looks like code.
 *
 * Returns `null` when the key is absent or declared in some third shape; the
 * vacuity cases above are what stop a `null` being read as agreement.
 */
function valueOf(language: string, key: string): string | null {
  const block = findLocaleBlock(source, language);
  if (!block) return null;
  const literal = new RegExp(
    `(?:^|\\n)\\s{2}${key}:\\s*(?:\\n\\s+)?"((?:[^"\\\\]|\\\\.)*)"`,
  ).exec(block.body);
  if (literal) return literal[1];
  const template = new RegExp(
    `(?:^|\\n)\\s{2}${key}:\\s*\\([^)]*\\)\\s*=>\\s*(?:\\n\\s+)?\`([^\`]*)\``,
  ).exec(block.body);
  return template ? template[1] : null;
}

/** True when the base language declares this key as an arrow function. */
function isFunctionValued(language: string, key: string): boolean {
  const block = findLocaleBlock(source, language);
  if (!block) return false;
  return new RegExp(`(?:^|\\n)\\s{2}${key}:\\s*\\(`).test(block.body);
}
