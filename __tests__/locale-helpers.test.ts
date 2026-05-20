import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CURRENCY_CHIPS,
  getDefaultCurrencyForLanguage,
  getDefaultLocaleForLanguage,
  languageCurrencyMap,
  languageLocaleMap,
} from "@/lib/locale-helpers";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("getDefaultCurrencyForLanguage", () => {
  it("maps each supported language to its expected currency", () => {
    assert.equal(getDefaultCurrencyForLanguage("ru"), "RUB");
    assert.equal(getDefaultCurrencyForLanguage("be"), "BYN");
    assert.equal(getDefaultCurrencyForLanguage("de"), "EUR");
    assert.equal(getDefaultCurrencyForLanguage("pl"), "PLN");
    assert.equal(getDefaultCurrencyForLanguage("es"), "EUR");
    assert.equal(getDefaultCurrencyForLanguage("en"), "USD");
  });

  it("falls back to USD for unknown / empty language codes", () => {
    assert.equal(getDefaultCurrencyForLanguage("ja"), "USD");
    assert.equal(getDefaultCurrencyForLanguage(""), "USD");
  });

  it("languageCurrencyMap exposes the same data for direct iteration", () => {
    assert.equal(languageCurrencyMap.ru, "RUB");
    assert.equal(languageCurrencyMap.de, "EUR");
  });
});

describe("currency-input keeps re-exporting the helper for legacy callers", () => {
  it("still imports + re-exports getDefaultCurrencyForLanguage", () => {
    const src = read("components/currency-input.tsx");
    assert.match(src, /from\s+"@\/lib\/locale-helpers"/);
    assert.match(src, /export\s*\{\s*getDefaultCurrencyForLanguage\s*\}/);
  });
});

describe("getDefaultLocaleForLanguage", () => {
  it("maps each supported language to a BCP-47 region-tagged locale", () => {
    assert.equal(getDefaultLocaleForLanguage("ru"), "ru-RU");
    assert.equal(getDefaultLocaleForLanguage("be"), "be-BY");
    assert.equal(getDefaultLocaleForLanguage("de"), "de-DE");
    assert.equal(getDefaultLocaleForLanguage("pl"), "pl-PL");
    assert.equal(getDefaultLocaleForLanguage("es"), "es-ES");
    assert.equal(getDefaultLocaleForLanguage("en"), "en-US");
  });

  it("returns the input unchanged for unknown codes (Intl degrades gracefully)", () => {
    assert.equal(getDefaultLocaleForLanguage("ja"), "ja");
    assert.equal(getDefaultLocaleForLanguage(""), "");
  });

  it("languageLocaleMap exposes the same data for direct iteration", () => {
    assert.equal(languageLocaleMap.ru, "ru-RU");
    assert.equal(languageLocaleMap.en, "en-US");
  });

  it("every BCP-47 tag in languageLocaleMap matches the ll-CC shape", () => {
    for (const tag of Object.values(languageLocaleMap)) {
      assert.match(tag, /^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("languageCurrencyMap and languageLocaleMap cover the same key set", () => {
    // If a language gains a currency default it should also gain a locale
    // default, otherwise number/currency formatting silently degrades.
    const currencyKeys = Object.keys(languageCurrencyMap).sort();
    const localeKeys = Object.keys(languageLocaleMap).sort();
    assert.deepEqual(localeKeys, currencyKeys);
  });

  it("i18n-context.tsx delegates to getDefaultLocaleForLanguage (no local LOCALE_MAP)", () => {
    const src = read("lib/i18n-context.tsx");
    assert.match(
      src,
      /import\s*\{\s*getDefaultLocaleForLanguage\s*\}\s*from\s*"@\/lib\/locale-helpers"/,
    );
    // The bespoke `LOCALE_MAP` literal should be gone — the migration's whole
    // point is to centralise it next to the currency map.
    assert.doesNotMatch(src, /const\s+LOCALE_MAP\s*:/);
    // And `formatRelativeDate` must use the new helper instead of the local map.
    assert.match(src, /getDefaultLocaleForLanguage\(\s*locale\s*\)/);
  });
});

describe("CURRENCY_CHIPS picker whitelist", () => {
  it("is a non-empty readonly tuple of ISO 4217 alphabetic codes", () => {
    assert.ok(CURRENCY_CHIPS.length > 0);
    for (const code of CURRENCY_CHIPS) {
      // Three uppercase letters per ISO 4217.
      assert.match(code, /^[A-Z]{3}$/);
    }
  });

  it("includes the codes the language→currency map points at", () => {
    // Every value in `languageCurrencyMap` should be renderable as a chip,
    // otherwise the picker can't surface the language's default currency.
    for (const code of Object.values(languageCurrencyMap)) {
      assert.ok(
        (CURRENCY_CHIPS as readonly string[]).includes(code),
        `expected ${code} to appear in CURRENCY_CHIPS so the picker can surface it`,
      );
    }
  });

  it("has unique entries (no duplicate chips)", () => {
    const unique = new Set<string>(CURRENCY_CHIPS);
    assert.equal(unique.size, CURRENCY_CHIPS.length);
  });

  it("currency-input.tsx imports CURRENCY_CHIPS from @/lib/locale-helpers", () => {
    const src = read("components/currency-input.tsx");
    assert.match(
      src,
      /import\s*\{[^}]*\bCURRENCY_CHIPS\b[^}]*\}\s*from\s*"@\/lib\/locale-helpers"/,
    );
    // The local CURRENCIES literal must be gone — otherwise the migration
    // didn't actually move it.
    assert.doesNotMatch(src, /const\s+CURRENCIES\s*=/);
  });
});
