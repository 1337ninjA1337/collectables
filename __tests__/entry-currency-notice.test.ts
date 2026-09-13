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
 *
 * AND THEN THE NOTICE COULD NOT CREATE WHAT IT DESCRIBED (2026-09-13). The
 * round above shipped a card that explains the entry currency and can only
 * clear it: the preference came into existence by opening an add form and
 * picking a currency there, which is discoverable by accident only. So the
 * line became a way in — tapping the notice opens the picker for the entry
 * slot — and a quiet one-line affordance took its place when the two agree,
 * where the notice itself would be a sentence about nothing.
 *
 * IT IS STILL NOT A SECOND PICKER, which is the argument above surviving
 * intact. The card shows ONE value, the display currency, above ONE row; the
 * entry preference is a line of text underneath that happens to open the same
 * sheet. Two currency values side by side would read as two equal settings,
 * and one of them is a convenience the other is not.
 *
 * ONE SHEET WITH A TARGET, not two mounted pickers: the list, the search box
 * and the modal are identical either way, and a second `<CurrencySheet>` in
 * this file would be the duplication `currency-input-consistency` exists to
 * stop. The target decides `selectedCode` and what `onSelect` writes, and the
 * entry side opens on the EFFECTIVE currency — `entryCurrency ?? displayCurrency`
 * — because a null slot means "follow the display one" and not "none".
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

  it("offers a way in when the two agree, with no second value on screen", () => {
    // The half the previous round left out: the preference could only be
    // CREATED from an add form, so the one screen that explains it could not
    // change it in the direction that brings it into existence.
    //
    // The `else` branch of the same conditional, so it is not possible for
    // both to render or for neither to: the card always carries exactly one
    // line about the entry currency.
    assert.match(
      SETTINGS,
      /entryCurrency !== displayCurrency \? \([\s\S]*?\) : \([\s\S]*?t\("entryCurrencySet"\)/,
    );
    // And it is a sentence, not a value: printing the effective entry currency
    // here would put two currency codes in a card whose subject is one of them.
    const quiet = SETTINGS.slice(SETTINGS.indexOf('t("entryCurrencySet")'));
    const line = quiet.slice(0, quiet.indexOf("</Pressable>"));
    assert.ok(
      !line.includes("{entryCurrency}") && !line.includes("{displayCurrency}"),
      "the quiet line shows a currency code beside the display one",
    );
  });
});

describe("what the button does", () => {
  it("clears the slot instead of writing the display currency into it", () => {
    // Writing today's value would pin the forms to it and stop following a
    // later change to the display currency — the opposite of what it says.
    assert.match(SETTINGS, /void clearEntryCurrency\(\)\.then\(loadEntryCurrency\)/);
    // This case used to read "settings never calls setEntryCurrency — that is
    // what a cost form does", and the pin was right about the RESET and wrong
    // about the screen: a card that explains a preference and can only clear
    // it leaves the user to create it by opening a form they did not want to
    // fill in. What has to stay true is that the CLEAR is a clear, so the
    // write is pinned to its own handler rather than banned from the file.
    const reset = SETTINGS.slice(SETTINGS.indexOf("const handleUseDisplayCurrency"));
    const body = reset.slice(0, reset.indexOf("\n  }"));
    assert.ok(
      !body.includes("setEntryCurrency("),
      "the reset writes a currency into the slot instead of removing it",
    );
  });

  it("writes the entry slot and nothing else when the sheet was opened for it", () => {
    // The whole point of the split: the display currency is what every total
    // renders in, and picking an entry currency must not move it.
    const handler = SETTINGS.slice(SETTINGS.indexOf("const handleSelectCurrency"));
    const body = handler.slice(0, handler.indexOf("\n  );"));
    assert.match(body, /currencySheetTarget === "entry"/);
    assert.match(body, /void setEntryCurrency\(code\)\.then\(loadEntryCurrency\)/);
    // The display branch is the `else`, so one pick cannot write both slots.
    assert.match(body, /\} else \{\s*setDisplayCurrency\(code\);/);
  });

  it("opens the entry sheet on the effective currency, not on an empty slot", () => {
    // `getEntryCurrency` reads through to the display currency, so a null slot
    // means "follow the display one". A sheet opened with nothing selected
    // would tell a user who has never chosen one that they have no entry
    // currency, which is not what their forms do.
    assert.match(
      SETTINGS,
      /currencySheetTarget === "entry" \? \(entryCurrency \?\? displayCurrency\) : displayCurrency/,
    );
  });

  it("mounts one picker for both preferences", () => {
    // Two <CurrencySheet> mounts here would be the same list, the same search
    // box and the same modal twice, differing in one prop.
    assert.equal(SETTINGS.split("<CurrencySheet").length - 1, 1);
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

describe("the four keys", () => {
  const I18N = readI18nSource();

  for (const key of [
    "entryCurrencyNotice",
    "entryCurrencyReset",
    "entryCurrencyChange",
    "entryCurrencySet",
  ] as const) {
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

  it("the two actions on the notice line are different words", () => {
    // "Change" opens the picker and "Use display currency" empties the slot;
    // a locale that translated both to the same phrase would put two
    // identically-labelled buttons one under the other, and a screen-reader
    // user would hear the same sentence twice with different outcomes.
    const reset = localeValuesOf(I18N, "entryCurrencyReset");
    for (const [code, value] of localeValuesOf(I18N, "entryCurrencyChange")) {
      assert.notEqual(value, reset.get(code), `${code} labels both actions the same`);
    }
  });

  it("the quiet line is a sentence and the action is a word", () => {
    // They sit in the same slot in the card, under opposite branches, and the
    // difference is the point: the notice line already says what is happening
    // and needs a verb, the line that replaces it when nothing is happening
    // has to say what the tap would DO.
    const change = localeValuesOf(I18N, "entryCurrencyChange");
    for (const [code, value] of localeValuesOf(I18N, "entryCurrencySet")) {
      const words = value.replace(/^["'`]|["'`]$/g, "").split(" ").length;
      assert.ok(words >= 4, `${code}'s quiet line (${value}) is too short to explain itself`);
      const action = (change.get(code) ?? "").replace(/^["'`]|["'`]$/g, "");
      assert.ok(
        action.split(" ").length <= 2,
        `${code}'s change label (${action}) is a sentence where a word belongs`,
      );
    }
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
