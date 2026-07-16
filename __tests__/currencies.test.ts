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

  it("includes the Hungarian Forint (HUF) so it is selectable", () => {
    assert.equal(isCurrencyCode("HUF"), true);
    assert.equal(findCurrency("HUF")?.name, "Forint");
  });
});

describe("CurrencyInput exposes the full picker (so any currency, e.g. HUF, is selectable)", () => {
  const src = read("components/currency-input.tsx");

  it("mounts the shared CurrencySheet and persists the pick via onChangeCurrency", () => {
    assert.match(src, /import\s*\{\s*CurrencySheet\s*\}\s*from\s*"@\/components\/currency-sheet"/);
    assert.match(src, /<CurrencySheet/);
    // sheet picks route through selectCurrency, which forwards to onChangeCurrency
    assert.match(src, /onSelect=\{\(code\)\s*=>\s*\{\s*selectCurrency\(code\);/);
    assert.match(src, /function selectCurrency\(code: string\) \{\s*onChangeCurrency\(code\);/);
  });

  it("renders a 'more currencies' affordance that opens the sheet", () => {
    assert.match(src, /accessibilityLabel="More currencies"/);
    assert.match(src, /setSheetOpen\(true\)/);
  });

  it("keeps a non-shortlist selection (e.g. HUF) visible as an active chip", () => {
    assert.match(src, /baseCodes\.includes\(currency\)\s*\?\s*baseCodes\s*:\s*\[currency,\s*\.\.\.baseCodes\]/);
  });

  it("types currency props as CurrencyChipCode | (string & {}) for IntelliSense without narrowing", () => {
    assert.match(src, /export type CurrencyCode = CurrencyChipCode \| \(string & \{\}\)/);
    assert.match(src, /currency: CurrencyCode;/);
    assert.match(src, /onChangeCurrency: \(c: CurrencyCode\) => void;/);
  });
});

describe("currency pickers hide the vertical scrollbar", () => {
  it("CurrencySheet list sets showsVerticalScrollIndicator={false}", () => {
    assert.match(read("components/currency-sheet.tsx"), /showsVerticalScrollIndicator=\{false\}/);
  });
});

describe("currency selector is wired into the create-item flow", () => {
  it("create.tsx renders a currency selector next to cost and sends costCurrency", () => {
    const src = read("app/create.tsx");
    // The CURRENCIES list was hoisted into `components/currency-sheet.tsx`
    // when the picker was extracted for reuse on the collection-edit page;
    // create.tsx now imports the shared <CurrencySheet/> instead.
    assert.match(src, /from\s+"@\/components\/currency-sheet"/);
    assert.match(src, /getDefaultCurrencyForLanguage/);
    assert.match(src, /currencySheetOpen/);
    assert.match(src, /<CurrencySheet/);
    assert.match(src, /costCurrency:/);
  });

  it("CurrencySheet (extracted) still consumes the canonical CURRENCIES list", () => {
    assert.match(read("components/currency-sheet.tsx"), /from\s+"@\/lib\/currencies"/);
  });

  it("CollectableItem type and cloud shapes carry cost_currency", () => {
    assert.match(read("lib/types.ts"), /costCurrency\?:\s*string\s*\|\s*null/);
    assert.match(read("lib/supabase-profiles-shapes.ts"), /cost_currency:\s*item\.costCurrency/);
    const profiles = read("lib/supabase-profiles.ts");
    assert.match(profiles, /cost_currency\?:\s*string\s*\|\s*null/);
    // BE-10 moved the read-path mapping into the pure `coerceItemRow` validator.
    assert.match(read("lib/supabase-row-coerce.ts"), /costCurrency:\s*typeof\s+r\.cost_currency\s*===\s*"string"\s*\?\s*r\.cost_currency\s*:\s*undefined,/);
    assert.match(profiles, /"costCurrency"\s+in\s+updates/);
  });

  it("a migration + manual task document the new column", () => {
    assert.match(
      read("supabase/migrations/20260517_items_cost_currency.sql"),
      /ADD COLUMN IF NOT EXISTS cost_currency text/i,
    );
    assert.match(read("MANUAL-TASKS.md"), /20260517_items_cost_currency\.sql/);
  });
});
