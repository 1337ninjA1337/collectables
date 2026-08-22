import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TRANSLATION_LANGUAGES, UNTRANSLATABLE_KEYS } from "@/lib/i18n-coverage";
import { findLocaleBlock, localeKeys, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readableText } from "./helpers/i18n-readable-text";

/**
 * A declared key whose value is the English one, anywhere in the map.
 *
 * Coverage counts DECLARATIONS: a key a locale writes for itself is a decision
 * somebody made, and a key it inherits through `...en` is a decision nobody
 * made. That is the right unit for the question it answers, and it has one
 * blind spot, which is the shape this suite exists for — declaring the key and
 * pasting the English text satisfies every count in the tree while shipping
 * exactly the string the count was invented to find. `be` at 100% and `be` at
 * 100% with fourteen English strings in it read identically from every
 * percentage in this repository.
 *
 * `i18n-complete-families.test.ts` has made this comparison since the families
 * were introduced, and only over the keys a LISTED family owns. That covered
 * the work as it was being done family by family; it stopped covering the work
 * on 2026-08-22, when `be` and `pl` were finished by a per-locale sweep of the
 * 62 keys no family grouped — 129 hand-written values, none of them under a
 * listed family, and a bulk sweep is the single likeliest place for a paste.
 * So the same comparison is made here over the whole map, which is where it
 * always belonged: the family suite compares the keys a family owns because
 * that is its subject, not because those are the keys worth comparing.
 *
 * NOT a coverage rule and deliberately not a ceiling on what a locale
 * inherits. `TRANSLATION_FLOORS` explains at length why a ceiling would go red
 * on every feature PR — a new English string ships before its five
 * translations, and that is the ordinary way a feature lands here. This one
 * only ever looks at values a locale DECLARED, so a new untranslated key is
 * invisible to it and stays invisible until somebody decides to translate it.
 * What it refuses is the decision recorded wrongly, which no amount of feature
 * churn can produce on its own.
 */

const source = readI18nSource();

/**
 * Keys where at least one locale legitimately serves the English string, and
 * the reason each one does.
 *
 * A reason per key rather than a bare set, for the reason the
 * `UNTRANSLATABLE_KEYS` header next door gives: an exemption is a line nobody
 * has to justify again, and the smallest defence against a growing list is
 * making somebody write down why, where the next reader will see it.
 *
 * These are NOT `UNTRANSLATABLE_KEYS`, and the difference is what keeps the two
 * lists apart. That list removes a key from every locale's DENOMINATOR — the
 * key is correct in English in all six, so counting it as a gap makes a
 * percentage nobody can finish. These are keys some locales translate and
 * others correctly do not: `ru` writes `premiumTitle` in Cyrillic and German
 * says *Premium*, both right. Moving one of these into the denominator
 * exemption would credit the locales that DID translate it with a gap they do
 * not have.
 *
 * The test for membership is the same one: would a translator handed this key
 * correctly hand it back unchanged? Ten entries today, and every one of them is
 * a brand, a loanword the language actually took, or a string with no words in
 * it at all.
 */
const SAME_AS_ENGLISH: Readonly<Record<string, string>> = {
  profileIdPlaceholder:
    "`my-collectables-id`, an example handle rather than a phrase — the hyphenated ASCII form is what the field accepts, so a locale writing it in Cyrillic would be documenting an input the field rejects",
  templateHotWheelsName: "Hot Wheels is a brand, and a translated brand is a different product",
  templateComicsName: "`Comics` is the loanword German took for the medium — *Comics* is the German plural",
  premiumTitle: "`Premium` is the same word in pl, de and es, and it is also the tier's name",
  chatsTitle: "`Chats` is the ordinary word in de and es for the screen, loaned whole",
  chatTitle: "`Chat`, the singular of the above, same reason",
  tagsLabel: "`Tags` is the loanword German uses for exactly this — a metadata label, not a price tag",
  costPlaceholder:
    "`Optional` is a German word spelled the same as the English one; it is the placeholder in a cost field, where German capitalises it the same way",
  sortNameAsc: "`A → Z` has no words in it — two Latin letters and an arrow, which sort the same way in every locale here",
  sortNameDesc: "`Z → A`, the same string reversed, same reason",
};

/** {@link readableText} of one key's value in one locale, or `null` if absent. */
function valueOf(language: string, key: string): string | null {
  const value = findLocaleBlock(source, language)?.values.get(key);
  return value === undefined ? null : readableText(value);
}

/**
 * Letters in a value that a translator could have written, which is every
 * letter outside an interpolation.
 *
 * The gate this feeds is structural rather than an exemption, and the
 * difference matters: `itemValueApprox` is ``≈ ${amount} ${currency}`` and
 * `galleryCounter` is ``${current} / ${total}``, so "this locale kept the
 * English text" is not a claim either value can be measured against — there is
 * no text in them. Six locales serve those two identically because there is
 * one way to write them, not because anybody pasted anything. Naming them in
 * SAME_AS_ENGLISH would have recorded a judgement about two strings; this
 * records the property, so the next wordless value added to the map is out of
 * the rule without a line being written for it.
 *
 * Only the GATE strips interpolations. The comparison itself is on the whole
 * readable text, interpolations included, because that is where a copy-paste
 * hides: `${slavicPlural(params?.count, "предмет", …)}` puts the translated
 * words inside what looks like code.
 */
function proseLetters(text: string): number {
  return (text.replace(/\$\{[^}]*\}/g, " ").match(/\p{L}/gu) ?? []).length;
}

/**
 * Base keys whose English value has words in it, and which are not already
 * exempt from every denominator.
 *
 * {@link UNTRANSLATABLE_KEYS} is subtracted rather than duplicated here: those
 * three are the recorded decision that English is right in ALL six locales, so
 * a locale declaring one verbatim is doing exactly what that list says it
 * should — `ru` declares `acquiredDatePlaceholder` as the ISO date the parser
 * accepts. Re-listing them below would state the same exemption twice, and the
 * overlap case at the bottom is what keeps the two lists from drifting into
 * each other.
 */
function comparableKeys(): readonly string[] {
  return [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)].filter((key) => {
    if (key in UNTRANSLATABLE_KEYS) return false;
    const english = valueOf(TRANSLATION_BASE_LANGUAGE, key);
    return english !== null && proseLetters(english) > 0;
  });
}

/**
 * Every (locale, key) pair where the locale declares a comparable key and
 * reads back exactly what English does.
 *
 * Includes the exempt keys — the hygiene case below needs them, and filtering
 * them out here would make an exemption that stopped applying indistinguishable
 * from one that still does.
 */
function verbatimPairs(): readonly { readonly language: string; readonly key: string }[] {
  const keys = comparableKeys();
  const pairs: { language: string; key: string }[] = [];
  for (const language of TRANSLATION_LANGUAGES) {
    if (language === TRANSLATION_BASE_LANGUAGE) continue;
    const declared = localeKeys(source, language);
    for (const key of keys) {
      if (!declared.has(key)) continue;
      if (valueOf(language, key) === valueOf(TRANSLATION_BASE_LANGUAGE, key)) {
        pairs.push({ language, key });
      }
    }
  }
  return pairs;
}

describe("no locale declares a key and keeps the English text", () => {
  const baseKeys = [...localeKeys(source, TRANSLATION_BASE_LANGUAGE)];

  it("compares enough of the map for the case below to mean anything", () => {
    // Every claim here is a filter over declared values, and a parse that came
    // back empty — or a reader that returned `null` for everything — would make
    // all of them pass while comparing nothing. `null === null` looks exactly
    // like agreement.
    assert.ok(baseKeys.length >= 400, `only ${baseKeys.length} base keys parsed`);
    for (const language of TRANSLATION_LANGUAGES) {
      const readable = baseKeys.filter((key) => valueOf(language, key) !== null);
      assert.ok(
        readable.length >= 400,
        `only ${readable.length} readable values in '${language}' — the reader or the declaration shape changed`,
      );
    }
    // And the gate has to leave most of the map inside the rule. A
    // `proseLetters` that started returning 0 — a broken interpolation strip
    // eating the whole value — would empty every case below silently.
    assert.ok(
      comparableKeys().length >= 400,
      `only ${comparableKeys().length} of ${baseKeys.length} base keys have words in them — the wordless gate is swallowing the map`,
    );
  });

  for (const language of TRANSLATION_LANGUAGES) {
    if (language === TRANSLATION_BASE_LANGUAGE) continue;
    it(`'${language}' translates every string it declares`, () => {
      const copied = verbatimPairs()
        .filter((pair) => pair.language === language)
        .map((pair) => pair.key)
        .filter((key) => !(key in SAME_AS_ENGLISH));
      assert.deepEqual(
        copied,
        [],
        `'${language}' declares ${copied.length} key(s) with the English text verbatim: ${copied.join(", ")}. ` +
          `Declaring a key is the recorded decision that somebody looked at it, so a pasted English value records a decision that was not made — every coverage percentage in this repo counts it as translated. ` +
          `If the English string is genuinely right in this language, add the key to SAME_AS_ENGLISH with the reason.`,
      );
    });
  }

  it("keeps no exemption that has stopped applying", () => {
    // The failure mode a reasoned list has that a bare set does not: an entry
    // naming a key nobody serves in English any more exempts nothing, looks
    // exactly like one that works, and is the line the next reader copies. The
    // agreement suite's INVARIANT list carries the same case for the same
    // reason.
    const inUse = new Set(verbatimPairs().map((pair) => pair.key));
    const stale = Object.keys(SAME_AS_ENGLISH).filter((key) => !inUse.has(key));
    assert.deepEqual(
      stale,
      [],
      `these keys are exempted from the verbatim rule and no locale serves them in English any more: ${stale.join(", ")} — somebody translated them, so the exemption should go`,
    );
  });

  it("exempts only keys the base map actually declares", () => {
    // A typo'd or renamed entry removes nothing from the rule and reads as
    // though it does. `TranslationMap` would reject the key in the map itself;
    // nothing type-checks a string in this table.
    const baseSet = new Set(baseKeys);
    const unknown = Object.keys(SAME_AS_ENGLISH).filter((key) => !baseSet.has(key));
    assert.deepEqual(unknown, [], `SAME_AS_ENGLISH names key(s) the base map does not declare: ${unknown.join(", ")}`);
  });

  it("gives every exemption a reason somebody wrote", () => {
    for (const [key, reason] of Object.entries(SAME_AS_ENGLISH)) {
      assert.ok(
        reason.trim().length >= 20,
        `'${key}' is exempt with a reason of ${reason.trim().length} characters — the list stays short by being expensive to add to`,
      );
    }
  });

  it("does not overlap the denominator exemption", () => {
    // Two lists, two meanings, and a key in both would be claiming the English
    // string is right in ALL six locales (which removes it from every
    // denominator) and separately that some locales translate it. The one that
    // would be wrong is whichever list the reader found first.
    const shared = Object.keys(SAME_AS_ENGLISH).filter((key) => key in UNTRANSLATABLE_KEYS);
    assert.deepEqual(
      shared,
      [],
      `${shared.join(", ")} is in both SAME_AS_ENGLISH and UNTRANSLATABLE_KEYS — a key correct in English everywhere belongs in the denominator exemption only`,
    );
  });
});
