import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findLocaleBlock } from "@/lib/i18n-source";
import { stripComments } from "@/lib/strip-comments";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * German addresses the reader as *du*, everywhere.
 *
 * This was a split, not a decision. Six families translated across 2026-08-21
 * — empty states, wishlist, filters, search, marketplace, collection — each
 * chose *du* because the nearest existing string did, while `templatePickerHint`,
 * `homeSubtitle`, `languageSubtitle`, `deleteAccountText` and
 * `deleteAccountFailed` still said *Sie*. Six local calls in one direction is
 * not a split any more; it is an unrecorded decision with five exceptions, and
 * a German speaker reads the mix as two people having written the app.
 *
 * The direction was chosen by precedent rather than by preference: converting
 * five strings to *du* is a smaller change than converting six families back,
 * and the informal register is what a collecting app aimed at enthusiasts
 * normally uses. Reverting is now the larger edit, which is the point of
 * writing the decision down as a rule instead of as a comment.
 *
 * **`Sie` alone cannot be the test, and the string that proves it is in here.**
 * `marketplaceListingNotFoundHint` reads "Sie wurde möglicherweise vom
 * Eigentümer entfernt" — third-person feminine, agreeing with *die Anzeige*,
 * rendering the English "It may have been removed by its owner". A sweep that
 * flagged every capitalised `Sie` would have "fixed" that into nonsense. So
 * the rule matches the two constructions that are unambiguously formal ADDRESS
 * and leaves the pronoun alone.
 */

const source = readI18nSource();

/**
 * Formal-address constructions, each unambiguous on its own.
 *
 * `Ihr…`/`Ihnen` capitalised: German capitalises the possessive and dative
 * only for formal address — the third-person "her/their" is lowercase `ihre`,
 * which is why `homeSubtitle` keeps "speichere **ihre** Herkunft" and does not
 * trip this.
 *
 * `<verb>en Sie`: the formal imperative and the formal subject after a
 * relative pronoun — "Wählen Sie", "Versuchen Sie", "denen Sie". A
 * third-person `Sie` is never preceded by an infinitive-form verb, which is
 * what keeps the listing string clear of it.
 */
const FORMAL: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\bIhr(?:e|er|en|em|es)?\b/g, what: "the capitalised formal possessive (Ihr/Ihre/Ihren…)" },
  { pattern: /\bIhnen\b/g, what: "the formal dative (Ihnen)" },
  // `[A-Za-zÄÖÜäöüß]` rather than `\w`: JS `\w` is ASCII-only, so "Wählen Sie"
  // matched as "hlen Sie" — the rule fired, and quoted a fragment starting
  // mid-word at the umlaut. It caught the defect and misdescribed it, which is
  // the half of a guard that decides whether the next reader trusts it.
  { pattern: /[A-Za-zÄÖÜäöüß]+en Sie\b/g, what: "the formal imperative or subject (<verb>en Sie)" },
];

describe("German speaks to the reader as du", () => {
  const located = findLocaleBlock(source, "de");
  assert.ok(located, "the German locale block is not in lib/i18n-context.tsx");
  const block = stripComments(located.body);

  it("uses no formal-address construction anywhere in the locale", () => {
    for (const { pattern, what } of FORMAL) {
      const found = block.match(pattern) ?? [];
      assert.deepEqual(
        found,
        [],
        `'de' uses ${what}: ${found.join(", ")}. This locale addresses the reader as du — see the header of this file for why the direction was settled that way, and convert rather than exempting.`,
      );
    }
  });

  it("leaves the third-person Sie alone, which is the case that makes this checkable", () => {
    // Not a formality: this string is the reason the rule is two narrow
    // patterns instead of one broad one. If it ever stops existing the rule
    // still holds, but the reader loses the example that explains its shape —
    // so the case names it rather than searching for whatever happens to match.
    assert.match(
      block,
      /marketplaceListingNotFoundHint: "Sie wurde/,
      "the third-person example moved; the rule is still right, but re-read its shape against whatever replaced it",
    );
  });

  it("actually says du somewhere, so the rule is not passing over an empty claim", () => {
    // The vacuity guard. Every assertion above is satisfied by a locale that
    // addresses the reader not at all — and a block that had lost its second
    // person entirely would be a worse bug than the split this replaced.
    const informal = block.match(/\b(du|dich|dir|dein(?:e|er|en|em|es)?)\b/gi) ?? [];
    assert.ok(
      informal.length >= 20,
      `'de' carries only ${informal.length} informal-address word(s), which is too few for this locale to be addressing anyone`,
    );
  });
});
