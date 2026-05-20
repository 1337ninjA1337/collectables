import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CURRENCY_CHIPS,
  getDefaultCurrencyForLanguage,
  languageCurrencyMap,
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
