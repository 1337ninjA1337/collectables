import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { STORAGE_FAILURE_SITES } from "@/lib/report-storage-failure";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { sourceCode } from "./helpers/source-files";

/**
 * Splitting the currency key left a second preference no screen mentioned.
 *
 * Before the split, one slot meant both things, so the settings screen showing
 * one currency was the whole truth. After it, a collector who displays in USD
 * and types in JPY sees "USD" under Display currency and a JPY chip on every
 * add form, with nothing anywhere connecting the two — a preference they can
 * only change by opening a form they did not want to fill in.
 *
 * ONLY WHEN THE TWO DIFFER. "New costs are entered in USD" under a display
 * currency of USD is a sentence about nothing, and this card's subject is the
 * display currency; the entry one earns its space exactly when it is a
 * surprise. That is also why this is a line under the existing row rather than
 * a second picker: a second currency control in this card would read as two
 * equal settings, and one of them is a convenience the other is not.
 *
 * CLEARING IS THE ACTION, NOT WRITING THE DISPLAY CURRENCY IN. The empty slot
 * already means "follow the display currency" — `getEntryCurrency` reads
 * through to the display one, which shipped as the migration for
 * installations predating the split and never expires. Writing today's display
 * currency into the entry slot would pin the forms to it and silently stop
 * following a later change, which is the opposite of what the button says.
 * So the read-through stops being an accident of the migration and becomes the
 * documented meaning of the empty state.
 */

const SETTINGS = sourceCode("app/settings.tsx");

describe("the notice", () => {
  it("renders only when the entry currency differs from the display one", () => {
    assert.match(SETTINGS, /\{entryCurrency != null && entryCurrency !== displayCurrency \? \(/);
  });

  it("sits in the display-currency card, under the row it qualifies", () => {
    const card = SETTINGS.indexOf('{t("displayCurrencyTitle")}');
    const row = SETTINGS.indexOf("{displayCurrency}", card);
    const notice = SETTINGS.indexOf("entryCurrency !== displayCurrency", card);
    const rates = SETTINGS.indexOf("currencyRatesUpdatedAt != null", card);
    assert.ok(card > 0 && row > card, "could not parse the currency card");
    assert.ok(notice > row, "the notice sits above the row it is about");
    assert.ok(notice < rates, "the notice is below the rates line, which is a different subject");
  });

  it("names the currency rather than saying one is set", () => {
    // A notice that said "a different entry currency is in use" would send the
    // reader to a form to find out which.
    assert.match(SETTINGS, /t\("entryCurrencyNotice", \{ currency: entryCurrency \}\)/);
  });

  it("is a button, and the label says the outcome not the mechanism", () => {
    // "Use display currency" and not "Clear entry currency": the second names
    // a storage slot the user has never been told about.
    assert.match(SETTINGS, /accessibilityLabel=\{t\("entryCurrencyReset"\)\}/);
    assert.match(SETTINGS, /accessibilityRole="button"/);
  });
});

describe("what the button does", () => {
  it("clears the slot instead of writing the display currency into it", () => {
    // Writing today's value would pin the forms to it and stop following a
    // later change to the display currency — the opposite of what it says.
    assert.match(SETTINGS, /void clearEntryCurrency\(\)\.then\(loadEntryCurrency\)/);
    assert.ok(
      !/setEntryCurrency\(/.test(SETTINGS),
      "settings sets an entry currency — that is what a cost form does",
    );
  });

  it("re-reads afterwards rather than assuming what the read will say", () => {
    // The read falls through to the display currency, so the state after a
    // clear is not null — it is whatever the fallback answers. Assuming
    // either would put the notice one render out of date.
    assert.match(SETTINGS, /const loadEntryCurrency = useCallback\(\(\) => \{\s*void getEntryCurrency\(\)\.then\(setEntryCurrencyState\);/);
    assert.match(SETTINGS, /useEffect\(loadEntryCurrency, \[loadEntryCurrency\]\)/);
  });

  it("keeps the entry currency out of the provider", () => {
    // The provider owns the DISPLAY currency and every total re-renders on it.
    // An entry currency added there would re-render all of them on a change
    // that cannot affect any of them.
    const provider = sourceCode("lib/collections-context.tsx");
    assert.ok(!provider.includes("getEntryCurrency("), "the provider reads the entry currency");
    assert.ok(!provider.includes("clearEntryCurrency("), "the provider clears the entry currency");
  });
});

describe("clearEntryCurrency", () => {
  const SRC = sourceCode("lib/locale-helpers.ts");
  const BODY = SRC.slice(SRC.indexOf("export async function clearEntryCurrency("));

  it("removes the entry slot and touches nothing else", () => {
    const fn = BODY.slice(0, BODY.indexOf("\n}\n") + 3);
    assert.ok(fn.length > 0, "could not parse it");
    assert.match(fn, /AsyncStorage\.removeItem\(ENTRY_CURRENCY_KEY\)/);
    assert.ok(!/\bCURRENCY_KEY\b/.test(fn), "it reaches the display slot");
  });

  it("reports a failed remove rather than swallowing it", () => {
    // A silent failure leaves the user typing in a currency they just asked
    // the app to forget.
    const fn = BODY.slice(0, BODY.indexOf("\n}\n") + 3);
    assert.match(fn, /reportStorageFailure\("locale-helpers\.removeItem"/);
  });

  it("its scope is a declared reporting site", () => {
    // The list is the source and the type is derived, so an undeclared scope
    // does not compile — asserted here too because the entry is the FIRST
    // removeItem in that list and the convention it follows is worth pinning.
    const sites: readonly string[] = STORAGE_FAILURE_SITES;
    assert.ok(sites.includes("locale-helpers.removeItem"));
    assert.ok(sites.includes("locale-helpers.getItem"));
    assert.ok(sites.includes("locale-helpers.setItem"));
  });
});

describe("the two new keys", () => {
  const I18N = readI18nSource();

  for (const key of ["entryCurrencyNotice", "entryCurrencyReset"] as const) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(I18N, key);
    });
  }

  it("the notice takes the currency as a parameter in every locale", () => {
    // A locale that hard-coded a code, or dropped the placeholder, would
    // render a sentence about the wrong currency or about none.
    for (const [code, value] of localeValuesOf(I18N, "entryCurrencyNotice")) {
      assert.match(value, /params\?\.currency/, `${code} drops the currency`);
    }
  });

  it("the reset label is not the notice", () => {
    const notice = localeValuesOf(I18N, "entryCurrencyNotice");
    for (const [code, value] of localeValuesOf(I18N, "entryCurrencyReset")) {
      assert.notEqual(value, notice.get(code), `${code} uses one string for both`);
    }
  });

  it("each locale writes its own words for the reset label", () => {
    const values = [...localeValuesOf(I18N, "entryCurrencyReset").values()];
    assert.equal(new Set(values).size, values.length, "two locales share a value");
  });

  it("the reset label names the display currency, not the storage slot", () => {
    // "Use display currency" says the outcome; "clear entry currency" names a
    // thing the user has never been shown. So every locale's label has to
    // reach for the words its own settings card already uses for the thing
    // being adopted.
    //
    // A STEM AND NOT THE WORD, because three of these locales decline it: ru
    // says "Валюта отображения" in the title and "валюту отображения" in the
    // label, and pl "Waluta" / "waluty". Matching the whole first word is a
    // case that passes in English and German and fails on correct Russian —
    // which is the shape `i18n-agreement` exists to stop this repository
    // writing, and which the first draft of this case did.
    // `localeValuesOf` hands back the value as written in the source, quotes
    // included, so the first "word" of a title is `"Валюта` until they come
    // off — which is the second way the first draft of this case failed.
    const unquote = (raw: string) => raw.replace(/^["'`]|["'`]$/g, "").toLowerCase();
    const display = localeValuesOf(I18N, "displayCurrencyTitle");
    for (const [code, raw] of localeValuesOf(I18N, "entryCurrencyReset")) {
      const value = unquote(raw);
      const firstWord = unquote(display.get(code) ?? "").split(" ")[0] ?? "";
      const stem = firstWord.slice(0, 5);
      assert.ok(stem.length === 5, `${code}'s display-currency title has no word to stem`);
      assert.ok(
        value.includes(stem),
        `${code}'s reset label (${raw}) does not mention the display currency`,
      );
    }
  });
});
