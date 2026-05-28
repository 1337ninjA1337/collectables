import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { formatCostAmount } from "@/lib/item-cost";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("formatCostAmount", () => {
  it("keeps whole numbers whole (no trailing zeros)", () => {
    assert.equal(formatCostAmount(100), "100");
    assert.equal(formatCostAmount(0), "0");
  });

  it("renders fractional (converted) amounts at 2 decimals", () => {
    assert.equal(formatCostAmount(92.3456), "92.35");
    assert.equal(formatCostAmount(90.000001), "90.00");
  });
});

describe("item-card — renders converted cost via the bug-2a selector", () => {
  const src = read("components/item-card.tsx");

  it("pulls convertItemCost + getCollectionById from the collections context", () => {
    assert.match(src, /import\s*\{\s*useCollections\s*\}\s*from\s*"@\/lib\/collections-context"/);
    assert.match(src, /const\s*\{\s*convertItemCost,\s*getCollectionById\s*\}\s*=\s*useCollections\(\)/);
  });

  it("targets the parent collection's currency override (coerced from null)", () => {
    assert.match(
      src,
      /convertItemCost\(item,\s*getCollectionById\(item\.collectionId\)\?\.currency\s*\?\?\s*undefined\)/,
    );
  });

  it("prefixes the approx i18n key only when a real conversion changed the currency", () => {
    assert.match(
      src,
      /cost\.converted\s*&&\s*item\.costCurrency\s*!=\s*null\s*&&\s*item\.costCurrency\s*!==\s*cost\.currency/,
    );
    assert.match(src, /t\("itemValueApprox",\s*\{\s*amount:\s*formatCostAmount\(costAmount\),\s*currency:\s*cost\.currency\s*\}\)/);
  });

  it("surfaces the original stored amount via accessibilityLabel + web title", () => {
    assert.match(src, /accessibilityLabel:\s*`\$\{t\("costLabel"\)\}:\s*\$\{costOriginal\}`/);
    assert.match(src, /Platform\.OS === "web"\s*\?\s*\(\{\s*title:\s*costOriginal\s*\}/);
  });

  it("drops the old raw `{item.cost}{item.costCurrency}` inline render", () => {
    assert.doesNotMatch(src, /\{item\.cost\}\{item\.costCurrency\s*\?/);
  });
});

describe("item detail — converted cost + long-press original", () => {
  const src = read("app/item/[id].tsx");

  it("imports formatCostAmount and destructures convertItemCost", () => {
    assert.match(src, /import\s*\{\s*formatCostAmount\s*\}\s*from\s*"@\/lib\/item-cost"/);
    assert.match(src, /convertItemCost\s*\}\s*=\s*useCollections\(\)/);
  });

  it("converts against the collection currency override", () => {
    assert.match(src, /convertItemCost\(activeItem,\s*collection\?\.currency\s*\?\?\s*undefined\)/);
  });

  it("reveals the original amount on long-press (toast) mirroring the listing-detail pattern", () => {
    assert.match(src, /onLongPress=\{\(\)\s*=>\s*toast\.info\(original\)\}/);
    assert.match(src, /accessibilityLabel=\{`\$\{t\("costLabel"\)\}:\s*\$\{original\}`\}/);
  });
});

describe("i18n — itemValueApprox key in all 6 languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares itemValueApprox as an ≈ {amount} {currency} formatter 6 times (one per table)", () => {
    const matches = src.match(
      /itemValueApprox:\s*\(params\?:\s*TranslationParams\)\s*=>\s*`≈ \$\{params\?\.amount \?\? ""\} \$\{params\?\.currency \?\? ""\}`/g,
    ) ?? [];
    assert.equal(matches.length, 6, `expected 6 itemValueApprox formatters, got ${matches.length}`);
  });
});
