import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the in-collection search row added to the
 * `<ItemFilterBar>` sheet UI. The pure matcher already exists in
 * `lib/item-filters.ts` (see `item-filters-query.test.ts`); these tests
 * guard the UI plumbing so a future refactor can't silently disconnect
 * the TextInput from `draft.query` or drop the i18n placeholder key.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("components/item-filters.tsx — search row UI", () => {
  const src = read("components/item-filters.tsx");

  it("renders a TextInput bound to draft.query inside the sheet", () => {
    // value={draft.query} — without this, the input would render blank
    // even after a previous search-and-apply round, breaking the
    // "open sheet again to refine my search" flow.
    assert.match(src, /value=\{\s*draft\.query\s*\}/);
  });

  it("writes back to draft.query via setDraft on every keystroke", () => {
    // The onChangeText must mirror the same setDraft pattern as the
    // other fields so Apply/Reset CTAs stay coherent.
    assert.match(
      src,
      /onChangeText=\{\s*\(v\)\s*=>\s*setDraft\(\{\s*\.\.\.draft\s*,\s*query:\s*v\s*\}\)\s*\}/,
    );
  });

  it("uses the new searchInCollectionPlaceholder i18n key on the TextInput", () => {
    assert.match(src, /placeholder=\{\s*t\(\s*"searchInCollectionPlaceholder"\s*\)\s*\}/);
  });

  it("renders a clear chip (Ionicons close-circle) only when draft.query has content", () => {
    // The chip must be gated on draft.query.length > 0 — a permanently
    // visible clear button on an empty input is the usability anti-pattern
    // we're avoiding (matches the create.tsx search row shape).
    assert.match(
      src,
      /\{\s*draft\.query\.length\s*>\s*0\s*\?\s*\(\s*<Pressable[\s\S]*?name="close-circle"/,
    );
  });

  it("clear chip resets draft.query to the empty string (not undefined)", () => {
    // setDraft({ ...draft, query: "" }) preserves all other in-flight
    // draft state — a `setDraft({ query: "" })` (no spread) would wipe
    // the user's price/date inputs as a side effect.
    assert.match(
      src,
      /onPress=\{\s*\(\)\s*=>\s*setDraft\(\{\s*\.\.\.draft\s*,\s*query:\s*""\s*\}\)\s*\}/,
    );
  });

  it("places the search row above the price-range field row in the sheet", () => {
    // Ordering matters for affordance: search is the primary CTA,
    // price/date are advanced filters.
    const searchIdx = src.indexOf("sheetSearchRow");
    const priceIdx = src.indexOf("filterPriceFrom");
    assert.ok(searchIdx > 0, "sheetSearchRow style is missing");
    assert.ok(priceIdx > 0, "filterPriceFrom field is missing");
    assert.ok(
      searchIdx < priceIdx,
      `expected the search row to be declared before the price-range field row (searchIdx=${searchIdx} priceIdx=${priceIdx})`,
    );
  });

  it("declares sheetSearchRow + sheetSearchInput styles for the new row", () => {
    assert.match(src, /sheetSearchRow:\s*\{[\s\S]*?flexDirection:\s*"row"/);
    assert.match(src, /sheetSearchInput:\s*\{[\s\S]*?flex:\s*1/);
  });
});

describe("i18n — searchInCollectionPlaceholder key across all 6 supported languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares searchInCollectionPlaceholder in the en base table", () => {
    // The en table defines the TranslationKey union (keyof typeof en),
    // so the key MUST land here — otherwise the other languages can't
    // override it and t("searchInCollectionPlaceholder") wouldn't type-check.
    assert.match(src, /searchInCollectionPlaceholder:\s*"[^"]+"/);
  });

  it("overrides searchInCollectionPlaceholder in ru / be / pl / de / es so each language has a native string", () => {
    for (const lang of ["ru", "be", "pl", "de", "es"]) {
      const re = new RegExp(
        `const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?searchInCollectionPlaceholder:\\s*"[^"]+"[\\s\\S]*?\\};`,
      );
      assert.match(
        src,
        re,
        `${lang} table is missing a localized searchInCollectionPlaceholder override`,
      );
    }
  });

  it("exactly 6 searchInCollectionPlaceholder declarations across the file (en + 5 overrides)", () => {
    const matches = src.match(/searchInCollectionPlaceholder:\s*"[^"]+"/g) ?? [];
    assert.equal(
      matches.length,
      6,
      `expected 6 searchInCollectionPlaceholder declarations, got ${matches.length}`,
    );
  });
});
