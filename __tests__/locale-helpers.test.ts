import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
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
