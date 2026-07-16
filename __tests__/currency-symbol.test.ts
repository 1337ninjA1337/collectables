import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getCurrencySymbol, CURRENCY_CHIPS } from "@/lib/locale-helpers";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("getCurrencySymbol", () => {
  it("derives the narrow Unicode glyph for symbol-bearing currencies", () => {
    assert.equal(getCurrencySymbol("USD"), "$");
    assert.equal(getCurrencySymbol("EUR"), "€");
    assert.equal(getCurrencySymbol("GBP"), "£");
    assert.equal(getCurrencySymbol("RUB"), "₽");
    assert.equal(getCurrencySymbol("PLN"), "zł");
    assert.equal(getCurrencySymbol("UAH"), "₴");
    assert.equal(getCurrencySymbol("JPY"), "¥");
  });

  it("falls back to the all-caps code for currencies without a symbol", () => {
    assert.equal(getCurrencySymbol("CHF"), "CHF");
    assert.equal(getCurrencySymbol("BYN"), "BYN");
    // Valid ISO shape but unknown to CLDR — Intl echoes the code, we pass it through.
    assert.equal(getCurrencySymbol("ZZZ"), "ZZZ");
  });

  it("normalises case/whitespace via parseStoredCurrency before lookup", () => {
    assert.equal(getCurrencySymbol("usd"), "$");
    assert.equal(getCurrencySymbol(" eur "), "€");
  });

  it("returns malformed input verbatim (never throws)", () => {
    assert.equal(getCurrencySymbol(""), "");
    assert.equal(getCurrencySymbol("US"), "US");
    assert.equal(getCurrencySymbol("DOLLARS"), "DOLLARS");
  });

  it("resolves a symbol-or-code for every picker chip", () => {
    for (const code of CURRENCY_CHIPS) {
      const symbol = getCurrencySymbol(code);
      assert.ok(symbol.length > 0, `expected a non-empty symbol for ${code}`);
    }
  });

  it("caches per code so per-keystroke re-renders don't rebuild formatters", () => {
    const src = read("lib/locale-helpers.ts");
    assert.match(src, /const CURRENCY_SYMBOL_CACHE = new Map<string, string>\(\)/);
    assert.match(src, /CURRENCY_SYMBOL_CACHE\.set\(normalized, symbol\)/);
  });
});

describe("currency-input renders the glyph, announces the code", () => {
  const src = read("components/currency-input.tsx");

  it("imports getCurrencySymbol from @/lib/locale-helpers", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bgetCurrencySymbol\b[^}]*\}\s*from\s*"@\/lib\/locale-helpers"/,
    );
  });

  it("renders getCurrencySymbol(currency) with the raw code as accessibilityLabel", () => {
    assert.match(src, /accessibilityLabel=\{currency\}/);
    assert.match(src, /\{getCurrencySymbol\(currency\)\}/);
    // The leading symbol slot must not render the raw code anymore.
    assert.doesNotMatch(src, /<Text style=\{styles\.currencySymbol\}>\{currency\}<\/Text>/);
  });

  it("keeps the chips as 3-letter codes (only the input symbol uses the glyph)", () => {
    assert.match(src, /\{chipCodes\.map\(/);
    assert.doesNotMatch(src, /getCurrencySymbol\(c\)/);
  });
});
