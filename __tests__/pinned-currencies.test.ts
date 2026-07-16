import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MAX_PINNED_CURRENCIES,
  mergePinnedCurrencies,
  parsePinnedCurrencies,
} from "@/lib/locale-helpers";
import { PINNED_CURRENCIES_KEY } from "@/lib/storage-keys";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("PINNED_CURRENCIES_KEY", () => {
  it("uses the collectables-pinned-currencies-v1 slot", () => {
    assert.equal(PINNED_CURRENCIES_KEY, "collectables-pinned-currencies-v1");
  });

  it("is removed by clearAllUserData so signing out wipes the MRU list", () => {
    const src = read("lib/storage-keys.ts");
    const clearBlock = src.match(/clearAllUserData[\s\S]*?\n\}/);
    assert.ok(clearBlock, "expected clearAllUserData function block");
    assert.match(clearBlock![0], /PINNED_CURRENCIES_KEY/);
  });
});

describe("parsePinnedCurrencies", () => {
  it("parses a well-formed JSON array, normalising case", () => {
    assert.deepEqual(parsePinnedCurrencies('["USD","eur"," jpy "]'), ["USD", "EUR", "JPY"]);
  });

  it("returns [] for null, undefined, empty, malformed JSON, and non-arrays", () => {
    assert.deepEqual(parsePinnedCurrencies(null), []);
    assert.deepEqual(parsePinnedCurrencies(undefined), []);
    assert.deepEqual(parsePinnedCurrencies(""), []);
    assert.deepEqual(parsePinnedCurrencies("not json"), []);
    assert.deepEqual(parsePinnedCurrencies('{"USD":true}'), []);
    assert.deepEqual(parsePinnedCurrencies('"USD"'), []);
  });

  it("drops junk entries per-element instead of wiping the payload", () => {
    assert.deepEqual(
      parsePinnedCurrencies('["USD", 42, null, "$$$", "TOOLONG", "PLN"]'),
      ["USD", "PLN"],
    );
  });

  it("collapses duplicates to their first position and caps at the limit", () => {
    assert.deepEqual(parsePinnedCurrencies('["USD","usd","EUR"]'), ["USD", "EUR"]);
    assert.deepEqual(
      parsePinnedCurrencies('["USD","EUR","GBP","PLN","JPY","CNY"]'),
      ["USD", "EUR", "GBP", "PLN"],
    );
    assert.equal(MAX_PINNED_CURRENCIES, 4);
  });
});

describe("mergePinnedCurrencies", () => {
  it("inserts a new code at the front (MRU order)", () => {
    assert.deepEqual(mergePinnedCurrencies(["USD", "EUR"], "JPY"), ["JPY", "USD", "EUR"]);
  });

  it("moves an existing code to the front instead of duplicating it", () => {
    assert.deepEqual(mergePinnedCurrencies(["USD", "EUR", "JPY"], "JPY"), ["JPY", "USD", "EUR"]);
  });

  it("normalises case before merging", () => {
    assert.deepEqual(mergePinnedCurrencies(["USD"], "eur"), ["EUR", "USD"]);
  });

  it("caps the result at MAX_PINNED_CURRENCIES, dropping the oldest", () => {
    assert.deepEqual(
      mergePinnedCurrencies(["USD", "EUR", "GBP", "PLN"], "JPY"),
      ["JPY", "USD", "EUR", "GBP"],
    );
  });

  it("returns an unchanged copy for invalid codes", () => {
    const current = ["USD", "EUR"];
    const merged = mergePinnedCurrencies(current, "$$$");
    assert.deepEqual(merged, current);
    assert.notEqual(merged, current);
  });
});

// <CurrencyInput> pulls react-native at module scope, so the adoption is
// pinned structurally (same approach as currency-error-inline.test.ts).
describe("CurrencyInput — pinned chips wiring", () => {
  const src = read("components/currency-input.tsx");

  it("loads the pinned list once per mount with a cancellation guard", () => {
    assert.match(src, /getPinnedCurrencies\(\)\.then/);
    assert.match(src, /if \(!cancelled && stored\.length > 0\) setPinned\(stored\)/);
  });

  it("orders chips pinned-first, then the static shortlist, active always visible", () => {
    assert.match(src, /const baseCodes = \[\.\.\.new Set\(\[\.\.\.pinned, \.\.\.CURRENCY_CHIPS\]\)\]/);
    assert.match(
      src,
      /baseCodes\.includes\(currency\) \? baseCodes : \[currency, \.\.\.baseCodes\]/,
    );
  });

  it("records the MRU pin on both chip presses and sheet picks", () => {
    assert.match(src, /function selectCurrency\(code: string\) \{\s*onChangeCurrency\(code\);\s*void pinCurrency\(code\);/);
    assert.match(src, /onPress=\{\(\) => selectCurrency\(c\)\}/);
    assert.match(src, /selectCurrency\(code\);\s*setSheetOpen\(false\);/);
  });
});

describe("create form — raw currency selector pins too", () => {
  it("setCurrency writes the MRU pin alongside the preferred currency", () => {
    const src = read("app/create.tsx");
    const idx = src.indexOf("function setCurrency");
    assert.ok(idx >= 0, "setCurrency not found");
    const block = src.slice(idx, idx + 400);
    assert.match(block, /void setUserPreferredCurrency\(next\)/);
    assert.match(block, /void pinCurrency\(next\)/);
  });
});
