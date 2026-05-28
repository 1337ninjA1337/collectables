import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { convertItemCost } from "@/lib/item-cost";

// USD-base rates: 1 USD = 0.9 EUR = 90 RUB. "XYZ" intentionally absent so we
// can exercise the missing-rate branch.
const RATES = { USD: 1, EUR: 0.9, RUB: 90 } as const;

describe("convertItemCost — per-item currency conversion", () => {
  it("converts USD → EUR using the USD-base rate table", () => {
    const result = convertItemCost({ cost: 100, costCurrency: "USD" }, "EUR", RATES);
    assert.deepEqual(result, { amount: 90, currency: "EUR", converted: true });
  });

  it("passes through when stored currency already equals the target", () => {
    const result = convertItemCost({ cost: 50, costCurrency: "USD" }, "USD", RATES);
    assert.deepEqual(result, { amount: 50, currency: "USD", converted: true });
  });

  it("treats a missing costCurrency as already in the target currency", () => {
    const result = convertItemCost({ cost: 25, costCurrency: null }, "EUR", RATES);
    assert.deepEqual(result, { amount: 25, currency: "EUR", converted: true });
  });

  it("falls back to the raw stored value with converted:false when the rate is missing", () => {
    const result = convertItemCost({ cost: 100, costCurrency: "XYZ" }, "EUR", RATES);
    assert.deepEqual(result, { amount: 100, currency: "XYZ", converted: false });
  });

  it("falls back to the raw stored value with converted:false when rates are not loaded", () => {
    const result = convertItemCost({ cost: 100, costCurrency: "USD" }, "EUR", null);
    assert.deepEqual(result, { amount: 100, currency: "USD", converted: false });
  });

  it("returns amount:null / converted:false for an item without a numeric cost", () => {
    assert.deepEqual(convertItemCost({ cost: null, costCurrency: "USD" }, "EUR", RATES), {
      amount: null,
      currency: "USD",
      converted: false,
    });
    assert.deepEqual(convertItemCost({ costCurrency: "USD" }, "EUR", RATES), {
      amount: null,
      currency: "USD",
      converted: false,
    });
  });

  it("converts symmetrically (EUR → RUB) via the shared USD base", () => {
    // 100 EUR -> USD (÷0.9) -> RUB (×90) = 10000.
    const result = convertItemCost({ cost: 100, costCurrency: "EUR" }, "RUB", RATES);
    assert.equal(result.currency, "RUB");
    assert.equal(result.converted, true);
    assert.ok(Math.abs((result.amount ?? 0) - 10000) < 1e-6);
  });
});

describe("collections-context — convertItemCost wiring", () => {
  const src = readFileSync(path.join(process.cwd(), "lib/collections-context.tsx"), "utf8");

  it("imports the pure helper from lib/item-cost", () => {
    assert.match(src, /import\s*\{\s*convertItemCost,\s*type\s+ConvertedItemCost\s*\}\s*from\s*"@\/lib\/item-cost"/);
  });

  it("exposes convertItemCost on the context, defaulting the target to displayCurrency", () => {
    assert.match(
      src,
      /convertItemCost:\s*\(item,\s*targetCurrency\)\s*=>\s*\n?\s*convertItemCost\(item,\s*targetCurrency\s*\?\?\s*displayCurrency,\s*currencyRates\)/,
    );
  });

  it("declares convertItemCost in the context value type", () => {
    assert.match(
      src,
      /convertItemCost:\s*\(item:\s*CollectableItem,\s*targetCurrency\?:\s*string\)\s*=>\s*ConvertedItemCost;/,
    );
  });
});
