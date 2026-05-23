import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  convertAmount,
  isStale,
  parseRatesResponse,
  RATES_ENDPOINT_URL,
  RATES_TTL_MS,
  sumConverted,
} from "@/lib/currency-rates";
import { CURRENCY_RATES_KEY } from "@/lib/storage-keys";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("parseRatesResponse", () => {
  it("returns a frozen payload with USD anchor when given a valid response", () => {
    const result = parseRatesResponse(
      { result: "success", rates: { USD: 1, EUR: 0.92, RUB: 90.5 } },
      1700_000_000_000,
    );
    assert.ok(result);
    assert.equal(result!.fetchedAt, 1700_000_000_000);
    assert.equal(result!.rates.USD, 1);
    assert.equal(result!.rates.EUR, 0.92);
    assert.equal(result!.rates.RUB, 90.5);
    assert.ok(Object.isFrozen(result!.rates));
  });

  it("injects USD=1 when upstream omits the self-rate", () => {
    const result = parseRatesResponse({ rates: { EUR: 0.92 } });
    assert.ok(result);
    assert.equal(result!.rates.USD, 1);
  });

  it("rejects responses with result !== success", () => {
    assert.equal(parseRatesResponse({ result: "error", rates: { EUR: 0.9 } }), null);
  });

  it("rejects null / non-object payloads", () => {
    assert.equal(parseRatesResponse(null), null);
    assert.equal(parseRatesResponse(undefined), null);
    assert.equal(parseRatesResponse("hello"), null);
    assert.equal(parseRatesResponse(42), null);
  });

  it("rejects payloads without a rates object", () => {
    assert.equal(parseRatesResponse({}), null);
    assert.equal(parseRatesResponse({ rates: null }), null);
    assert.equal(parseRatesResponse({ rates: "garbage" }), null);
  });

  it("filters out non-numeric, NaN, infinite, zero, and negative rates", () => {
    const result = parseRatesResponse({
      rates: {
        EUR: 0.92,
        BAD: "string",
        NAN: Number.NaN,
        INF: Number.POSITIVE_INFINITY,
        ZERO: 0,
        NEG: -1.5,
      },
    });
    assert.ok(result);
    assert.equal(result!.rates.EUR, 0.92);
    assert.equal(result!.rates.BAD, undefined);
    assert.equal(result!.rates.NAN, undefined);
    assert.equal(result!.rates.INF, undefined);
    assert.equal(result!.rates.ZERO, undefined);
    assert.equal(result!.rates.NEG, undefined);
  });

  it("filters out non-ISO-4217 keys (the upstream sometimes returns numeric or longer codes)", () => {
    const result = parseRatesResponse({ rates: { EUR: 0.92, "123": 4, EURX: 1, eur: 0.5 } });
    assert.ok(result);
    assert.equal(result!.rates.EUR, 0.92);
    assert.equal((result!.rates as Record<string, unknown>)["123"], undefined);
    assert.equal((result!.rates as Record<string, unknown>).EURX, undefined);
    assert.equal((result!.rates as Record<string, unknown>).eur, undefined);
  });

  it("returns null when only USD survives validation (no real data)", () => {
    assert.equal(parseRatesResponse({ rates: { EUR: -1 } }), null);
  });
});

describe("convertAmount", () => {
  const rates = { USD: 1, EUR: 0.92, RUB: 90, GBP: 0.8 };

  it("returns the amount unchanged when from === to", () => {
    assert.equal(convertAmount(100, "USD", "USD", rates), 100);
    assert.equal(convertAmount(0, "EUR", "EUR", rates), 0);
  });

  it("converts via USD anchor: 100 USD -> EUR", () => {
    assert.equal(convertAmount(100, "USD", "EUR", rates), 92);
  });

  it("converts via USD anchor: 1000 RUB -> USD", () => {
    const result = convertAmount(1000, "RUB", "USD", rates);
    assert.ok(result !== null);
    assert.ok(Math.abs(result! - 11.111111) < 0.0001);
  });

  it("converts between two non-USD currencies", () => {
    // 100 EUR -> GBP: 100 * (0.8 / 0.92) ≈ 86.96
    const result = convertAmount(100, "EUR", "GBP", rates);
    assert.ok(result !== null);
    assert.ok(Math.abs(result! - 86.9565) < 0.001);
  });

  it("returns null when the from currency is unknown", () => {
    assert.equal(convertAmount(100, "XYZ", "USD", rates), null);
  });

  it("returns null when the to currency is unknown", () => {
    assert.equal(convertAmount(100, "USD", "XYZ", rates), null);
  });

  it("returns null for non-finite amounts", () => {
    assert.equal(convertAmount(Number.NaN, "USD", "EUR", rates), null);
    assert.equal(convertAmount(Number.POSITIVE_INFINITY, "USD", "EUR", rates), null);
  });

  it("returns null when a rate is zero or negative (defensive against parser regressions)", () => {
    assert.equal(convertAmount(100, "USD", "EUR", { USD: 1, EUR: 0 }), null);
    assert.equal(convertAmount(100, "USD", "EUR", { USD: -1, EUR: 0.9 }), null);
  });
});

describe("isStale", () => {
  it("returns true for a null payload", () => {
    assert.equal(isStale(null), true);
  });

  it("returns false within the TTL window", () => {
    const payload = { rates: { USD: 1 }, fetchedAt: 1_000 };
    assert.equal(isStale(payload, 1_500, 1_000), false);
  });

  it("returns true at the TTL boundary (>=, not >)", () => {
    const payload = { rates: { USD: 1 }, fetchedAt: 1_000 };
    assert.equal(isStale(payload, 2_000, 1_000), true);
  });

  it("uses RATES_TTL_MS as the default", () => {
    const payload = { rates: { USD: 1 }, fetchedAt: 0 };
    assert.equal(isStale(payload, RATES_TTL_MS - 1), false);
    assert.equal(isStale(payload, RATES_TTL_MS), true);
  });
});

describe("sumConverted", () => {
  const rates = { USD: 1, EUR: 0.92, RUB: 90 };

  it("returns zero totals on empty input", () => {
    assert.deepEqual(sumConverted([], "USD", rates), { total: 0, converted: 0, skipped: 0 });
  });

  it("converts and sums a mix of currencies into the display currency", () => {
    const result = sumConverted(
      [
        { amount: 100, currency: "USD" },
        { amount: 100, currency: "EUR" },
      ],
      "USD",
      rates,
    );
    // 100 USD + (100 EUR -> USD = 100 / 0.92 ≈ 108.6957)
    assert.equal(result.converted, 2);
    assert.equal(result.skipped, 0);
    assert.ok(Math.abs(result.total - 208.6957) < 0.001);
  });

  it("skips entries with unknown currencies and counts them in `skipped`", () => {
    const result = sumConverted(
      [
        { amount: 100, currency: "USD" },
        { amount: 50, currency: "XYZ" },
        { amount: 200, currency: "RUB" },
      ],
      "USD",
      rates,
    );
    assert.equal(result.converted, 2);
    assert.equal(result.skipped, 1);
    // 100 + 200/90 ≈ 102.2222
    assert.ok(Math.abs(result.total - 102.2222) < 0.001);
  });

  it("treats from===to as a no-op conversion (no skipping)", () => {
    const result = sumConverted(
      [
        { amount: 100, currency: "USD" },
        { amount: 50, currency: "USD" },
      ],
      "USD",
      rates,
    );
    assert.equal(result.total, 150);
    assert.equal(result.converted, 2);
    assert.equal(result.skipped, 0);
  });
});

describe("currency-rates module — endpoint + storage", () => {
  it("uses the documented free open.er-api.com endpoint", () => {
    assert.equal(RATES_ENDPOINT_URL, "https://open.er-api.com/v6/latest/USD");
  });

  it("default TTL is 24 hours", () => {
    assert.equal(RATES_TTL_MS, 24 * 60 * 60 * 1000);
  });

  it("CURRENCY_RATES_KEY is the documented AsyncStorage slot", () => {
    assert.equal(CURRENCY_RATES_KEY, "collectables-currency-rates-v1");
  });

  it("clearAllUserData wipes CURRENCY_RATES_KEY so signing out drops stale cache", () => {
    const src = read("lib/storage-keys.ts");
    const clearBlock = src.match(/clearAllUserData[\s\S]*?\n\}/);
    assert.ok(clearBlock, "expected clearAllUserData function block");
    assert.match(clearBlock![0], /CURRENCY_RATES_KEY/);
  });
});

describe("currency-rates module — structural", () => {
  const src = read("lib/currency-rates.ts");

  it("loadCurrencyRates routes via getCachedRates and falls back to cache on fetch failure", () => {
    assert.match(src, /getCachedRates\(\)/);
    assert.match(src, /fetchUsdRates\(/);
    // The fallback-to-cache branch returns the cached payload on null fetch.
    assert.match(src, /return\s+cached;/);
  });

  it("fetchUsdRates wraps the network call in try/catch and parses the JSON via parseRatesResponse", () => {
    assert.match(src, /try\s*\{[\s\S]*fetchImpl\(RATES_ENDPOINT_URL\)[\s\S]*parseRatesResponse/);
  });

  it("setCachedRates serialises through JSON.stringify of the payload", () => {
    assert.match(src, /JSON\.stringify\(\s*\{\s*rates:\s*payload\.rates,\s*fetchedAt:\s*payload\.fetchedAt\s*\}/);
  });

  it("getCachedRates is defensive: skips non-numeric / non-positive entries", () => {
    assert.match(src, /Number\.isFinite\(value\)\s*&&\s*value\s*>\s*0/);
  });
});

describe("CollectionsContext currency wiring", () => {
  const src = read("lib/collections-context.tsx");

  it("imports the currency-rates helpers", () => {
    assert.match(src, /from\s+"@\/lib\/currency-rates"/);
    assert.match(src, /loadCurrencyRates/);
    assert.match(src, /sumConverted/);
  });

  it("loads rates on mount and stores them in state", () => {
    assert.match(src, /useState<UsdRates\s*\|\s*null>/);
    assert.match(src, /loadCurrencyRates\(/);
  });

  it("getCollectionTotalCost returns a { amount, currency, converted, skipped } shape", () => {
    assert.match(
      src,
      /getCollectionTotalCost:\s*\(collectionId\)\s*=>\s*\{[\s\S]*sumConverted\(/,
    );
    // `target` resolves to `collection.currency ?? displayCurrency` — the
    // per-collection override added on 2026-05-23 lets the user pick a
    // display currency just for one collection without changing the
    // app-wide default. Pre-override, this assertion checked for
    // `displayCurrency` directly.
    assert.match(src, /amount:\s*total,\s*currency:\s*target/);
    assert.match(src, /const\s+target\s*=\s*collection\?\.currency\s*\?\?\s*displayCurrency/);
  });

  it("falls back to a raw sum when rates are not yet loaded (no crash on first paint)", () => {
    assert.match(src, /if\s*\(currencyRates\)/);
    // Fallback summation block.
    assert.match(src, /reduce\(\(sum,\s*e\)\s*=>\s*sum\s*\+\s*e\.amount/);
  });

  it("exposes displayCurrency + refreshCurrencyRates on the context value", () => {
    assert.match(src, /displayCurrency:\s*string/);
    assert.match(src, /refreshCurrencyRates:\s*\(\)\s*=>\s*Promise<void>/);
  });
});
