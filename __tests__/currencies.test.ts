import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CURRENCIES, findCurrency, isCurrencyCode } from "@/lib/currencies";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("CURRENCIES list", () => {
  it("is a comprehensive ISO 4217 list (at least 150 entries)", () => {
    assert.ok(CURRENCIES.length >= 150, `only ${CURRENCIES.length} currencies`);
  });

  it("has a unique, well-formed 3-letter uppercase code for every entry", () => {
    const seen = new Set<string>();
    for (const c of CURRENCIES) {
      assert.match(c.code, /^[A-Z]{3}$/, `bad code ${c.code}`);
      assert.ok(c.name.trim().length > 0, `empty name for ${c.code}`);
      assert.ok(!seen.has(c.code), `duplicate code ${c.code}`);
      seen.add(c.code);
    }
  });

  it("stays sorted by code so the picker reads predictably", () => {
    const codes = CURRENCIES.map((c) => c.code);
    const sorted = [...codes].sort();
    assert.deepEqual(codes, sorted);
  });

  it("includes the language-default currencies and other majors", () => {
    for (const code of ["USD", "EUR", "GBP", "RUB", "BYN", "PLN", "JPY", "CNY", "UAH", "CHF"]) {
      assert.ok(isCurrencyCode(code), `${code} missing from list`);
    }
  });

  it("findCurrency resolves known codes and rejects unknown ones", () => {
    assert.equal(findCurrency("USD")?.name, "US Dollar");
    assert.equal(findCurrency("EUR")?.name, "Euro");
    assert.equal(findCurrency("ZZZ"), undefined);
    assert.equal(isCurrencyCode("ZZZ"), false);
  });
});

describe("currency selector is wired into the create-item flow", () => {
  it("create.tsx renders a currency selector next to cost and sends costCurrency", () => {
    const src = read("app/create.tsx");
    assert.match(src, /from\s+"@\/lib\/currencies"/);
    assert.match(src, /getDefaultCurrencyForLanguage/);
    assert.match(src, /currencySheetOpen/);
    assert.match(src, /<CurrencySheet/);
    assert.match(src, /costCurrency:/);
  });

  it("CollectableItem type and cloud shapes carry cost_currency", () => {
    assert.match(read("lib/types.ts"), /costCurrency\?:\s*string\s*\|\s*null/);
    assert.match(read("lib/supabase-profiles-shapes.ts"), /cost_currency:\s*item\.costCurrency/);
    const profiles = read("lib/supabase-profiles.ts");
    assert.match(profiles, /cost_currency\?:\s*string\s*\|\s*null/);
    assert.match(profiles, /costCurrency:\s*row\.cost_currency/);
    assert.match(profiles, /"costCurrency"\s+in\s+updates/);
  });

  it("a migration + manual task document the new column", () => {
    assert.match(
      read("supabase/migrations/20260516_items_cost_currency.sql"),
      /ADD COLUMN IF NOT EXISTS cost_currency text/i,
    );
    assert.match(read("MANUAL-TASKS.md"), /20260516_items_cost_currency\.sql/);
  });
});
