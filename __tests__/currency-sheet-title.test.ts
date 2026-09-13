import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * One sheet, two questions, and until now one heading.
 *
 * The settings currency card opens `<CurrencySheet>` for the DISPLAY currency
 * ("what are totals shown in") and for the ENTRY currency ("what are new costs
 * typed in"). Deliberately one mounted picker rather than two — the list, the
 * search box and the modal are identical — and the cost of that was a heading
 * that could not tell the user which preference they had just opened. The only
 * difference on screen was which row carried a checkmark, which is the LAST
 * thing a screen-reader user reaches and which a sighted user reads as "this
 * is what I picked" rather than as "this is what you are picking".
 *
 * The prop is OPTIONAL, and that is the other half of the rule: a create form
 * has a labelled field above the button it was opened from, so the generic
 * "Select currency" is still the right heading there. A required title would
 * have made three call sites restate what their own screens already say.
 */

const SHEET = readRepoFile("components/currency-sheet.tsx");
const SETTINGS = readRepoFile("app/settings.tsx");

/** The `<CurrencySheet …/>` element in a screen's source. */
function callSite(source: string): string {
  const match = /<CurrencySheet\s+[\s\S]*?\/>/.exec(source);
  assert.ok(match, "<CurrencySheet> call site not found");
  return match[0];
}

describe("the currency sheet names the question it is asking", () => {
  it("takes an optional title and falls back to the generic one", () => {
    assert.match(SHEET, /title\?: string;/);
    assert.match(SHEET, /\{title \?\? t\("currencySelectTitle"\)\}/);
  });

  it("marks the heading as a heading", () => {
    // A sheet that slides up over a screen gives a screen-reader user no
    // landmark of its own; the title is the only thing that says where they
    // are, and until it is a header it is one more line of text.
    assert.match(SHEET, /accessibilityRole="header"/);
  });

  it("settings names each of its two preferences", () => {
    const site = callSite(SETTINGS);
    assert.match(site, /title=\{/);
    assert.match(site, /currencySelectEntryTitle/);
    assert.match(site, /currencySelectDisplayTitle/);
    // The same target that chooses the selected row chooses the heading, so
    // the two cannot disagree about which preference is open.
    assert.match(site, /currencySheetTarget === "entry"/);
  });

  it("leaves the screens that ask once alone", () => {
    // The cost input and the collection screen open the sheet from a labelled
    // field, so a title there would be the field's own label said twice. The
    // collection screen opens it in two MODES — defer the save to the modal,
    // or persist on the spot — and both are the same question about the same
    // collection, which is what makes one heading right there and wrong in
    // settings.
    for (const rel of ["components/currency-input.tsx", "app/collection/[id].tsx"]) {
      assert.doesNotMatch(callSite(readRepoFile(rel)), /title=/, `${rel} needs no title`);
    }
  });
});

describe("the two headings are translated everywhere", () => {
  const SOURCE = readI18nSource();

  it("every locale declares both", () => {
    assertDeclaredInEveryLocale(SOURCE, "currencySelectDisplayTitle");
    assertDeclaredInEveryLocale(SOURCE, "currencySelectEntryTitle");
  });

  it("no locale gives the two preferences the same words", () => {
    // The whole point is telling them apart; a locale that translated both to
    // "Currency" would pass a declaration check and ship the original bug.
    const display = localeValuesOf(SOURCE, "currencySelectDisplayTitle");
    const entry = localeValuesOf(SOURCE, "currencySelectEntryTitle");
    const generic = localeValuesOf(SOURCE, "currencySelectTitle");
    for (const [code, value] of display) {
      assert.notEqual(value, entry.get(code), `${code} names both preferences the same`);
      assert.notEqual(value, generic.get(code), `${code}'s display title is the generic one`);
    }
    for (const [code, value] of entry) {
      assert.notEqual(value, generic.get(code), `${code}'s entry title is the generic one`);
    }
  });
});
