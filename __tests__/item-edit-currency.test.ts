import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural guard for the item-detail edit form being able to change an
 * item's value currency (bug-1). The screen can't be mounted in node:test
 * (RN peers), so we grep the source to pin the wiring.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("item edit form — value currency", () => {
  const src = read("app/item/[id].tsx");

  it("declares an editCurrency state", () => {
    assert.match(src, /const\s+\[editCurrency,\s*setEditCurrencyState\]\s*=\s*useState/);
  });

  it("initialises editCurrency from the item's costCurrency in enterEditMode", () => {
    const idx = src.indexOf("function enterEditMode");
    assert.ok(idx >= 0, "enterEditMode not found");
    const block = src.slice(idx, idx + 900);
    assert.match(
      block,
      /setEditCurrencyState\(activeItem\.costCurrency\s*\?\?/,
      "enterEditMode must seed editCurrency from activeItem.costCurrency",
    );
  });

  it("renders a currency picker wired to editCurrency in the edit cost row", () => {
    assert.match(src, /<CurrencyInput[\s\S]*?currency=\{editCurrency\}/);
    assert.match(src, /onChangeCurrency=\{setEditCurrency\}/);
  });

  it("threads costCurrency into the updateItem call on save", () => {
    const idx = src.indexOf("function handleSaveEdit");
    assert.ok(idx >= 0, "handleSaveEdit not found");
    const block = src.slice(idx, idx + 1400);
    assert.match(
      block,
      /costCurrency:\s*parsedCost\.value\s*!==\s*null\s*\?\s*editCurrency\s*:\s*null/,
      "save must persist costCurrency (editCurrency when a cost is set, else null)",
    );
  });

  it("persists the picked currency as the user's preferred currency", () => {
    assert.match(
      src,
      /function\s+setEditCurrency\(next:\s*string\)\s*\{[\s\S]*?setUserPreferredCurrency\(next\)/,
    );
  });
});
