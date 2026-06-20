import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for bug-2d — the Settings "Display currency" picker, the
 * "rates updated {when} · refresh" affordance, and the "conversion
 * unavailable" hint. All wired to the synced preference + rate freshness
 * exposed by collections-context (bug-2c / bug-2a infra).
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("collections-context — rate freshness exposure", () => {
  const src = read("lib/collections-context.tsx");

  it("tracks ratesUpdatedAt and stamps it on both load and forced refresh", () => {
    assert.match(src, /const\s+\[ratesUpdatedAt,\s*setRatesUpdatedAt\]\s*=\s*useState<number\s*\|\s*null>\(null\)/);
    const stamps = src.match(/setRatesUpdatedAt\(payload\.fetchedAt\)/g) ?? [];
    assert.equal(stamps.length, 2, `expected setRatesUpdatedAt in load + refresh, got ${stamps.length}`);
  });

  it("exposes currencyRatesUpdatedAt on the context value + type", () => {
    assert.match(src, /currencyRatesUpdatedAt:\s*number\s*\|\s*null;/);
    assert.match(src, /currencyRatesUpdatedAt:\s*ratesUpdatedAt,/);
  });

  it("includes ratesUpdatedAt in the value useMemo deps", () => {
    assert.match(src, /currencyRates,\s*displayCurrency,\s*ratesUpdatedAt[,\]]/);
  });
});

describe("settings screen — display currency picker", () => {
  const src = read("app/settings.tsx");

  it("imports CurrencySheet + useCollections", () => {
    assert.match(src, /import\s*\{\s*CurrencySheet\s*\}\s*from\s*"@\/components\/currency-sheet"/);
    assert.match(src, /import\s*\{\s*useCollections\s*\}\s*from\s*"@\/lib\/collections-context"/);
  });

  it("pulls displayCurrency, setDisplayCurrency, refreshCurrencyRates, currencyRatesUpdatedAt", () => {
    assert.match(
      src,
      /const\s*\{\s*displayCurrency,\s*setDisplayCurrency,\s*refreshCurrencyRates,\s*currencyRatesUpdatedAt\s*\}\s*=\s*\n?\s*useCollections\(\)/,
    );
  });

  it("mounts a CurrencySheet whose onSelect persists via setDisplayCurrency", () => {
    assert.match(src, /<CurrencySheet\s*\n?\s*visible=\{currencySheetOpen\}/);
    assert.match(src, /onSelect=\{\(code\)\s*=>\s*\{\s*setDisplayCurrency\(code\);/);
  });

  it("shows the rates-updated + refresh affordance when rates exist, else the unavailable hint", () => {
    assert.match(src, /currencyRatesUpdatedAt\s*!=\s*null\s*\?/);
    assert.match(src, /onPress=\{handleRefreshRates\}/);
    assert.match(src, /t\("currencyRatesUpdated",\s*\{[\s\S]*?formatRelativeDate\(new Date\(currencyRatesUpdatedAt\)\.toISOString\(\)\)/);
    assert.match(src, /t\("currencyRatesUnavailable"\)/);
  });

  it("guards refresh against re-entrancy while a fetch is in flight", () => {
    assert.match(src, /if\s*\(refreshingRates\)\s*return;/);
    assert.match(src, /setRefreshingRates\(true\)[\s\S]*?finally\s*\{\s*setRefreshingRates\(false\)/);
  });
});

describe("i18n — bug-2d display-currency keys in all 6 languages", () => {
  const src = read("lib/i18n-context.tsx");

  for (const key of [
    "displayCurrencyTitle",
    "displayCurrencySubtitle",
    "currencyRatesRefresh",
    "currencyRatesUnavailable",
  ]) {
    it(`declares ${key} in all 6 tables`, () => {
      const matches = src.match(new RegExp(`${key}:`, "g")) ?? [];
      assert.equal(matches.length, 6, `expected 6 ${key} entries, got ${matches.length}`);
    });
  }

  it("declares currencyRatesUpdated as a {when} formatter in all 6 tables", () => {
    const matches = src.match(/currencyRatesUpdated:\s*\(params\?:\s*TranslationParams\)\s*=>/g) ?? [];
    assert.equal(matches.length, 6, `expected 6 currencyRatesUpdated formatters, got ${matches.length}`);
  });
});
