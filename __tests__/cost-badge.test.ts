import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { hasFiniteCost } from "@/lib/item-cost";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("hasFiniteCost", () => {
  it("accepts finite numeric costs, including 0", () => {
    assert.equal(hasFiniteCost({ cost: 12.5 }), true);
    assert.equal(hasFiniteCost({ cost: 0 }), true);
  });

  it("rejects missing / null / non-finite costs", () => {
    assert.equal(hasFiniteCost({}), false);
    assert.equal(hasFiniteCost({ cost: null }), false);
    assert.equal(hasFiniteCost({ cost: Number.NaN }), false);
    assert.equal(hasFiniteCost({ cost: Number.POSITIVE_INFINITY }), false);
  });
});

describe("<CostBadge> — the single cost renderer", () => {
  const src = read("components/cost-badge.tsx");

  it("is memoized with the named-function form (React DevTools name)", () => {
    assert.match(src, /export const CostBadge = memo\(function CostBadge\(/);
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
      /conv\.converted\s*&&\s*item\.costCurrency\s*!=\s*null\s*&&\s*item\.costCurrency\s*!==\s*conv\.currency/,
    );
    assert.match(
      src,
      /t\("itemValueApprox",\s*\{\s*amount:\s*formatCostAmount\(convAmount\),\s*currency:\s*conv\.currency\s*\}\)/,
    );
  });

  it("surfaces the original stored amount via accessibilityLabel + web title", () => {
    assert.match(src, /accessibilityLabel:\s*`\$\{t\("costLabel"\)\}:\s*\$\{original\}`/);
    assert.match(src, /Platform\.OS === "web"\s*\?\s*\(\{\s*title:\s*original\s*\}/);
  });

  it("renders nothing when the item has no finite cost (shared gate)", () => {
    assert.match(src, /import\s*\{\s*formatCostAmount,\s*hasFiniteCost\s*\}\s*from\s*"@\/lib\/item-cost"/);
    assert.match(src, /if \(!hasFiniteCost\(item\)\) return null;/);
  });

  it("guards raw mode against non-finite amounts", () => {
    assert.match(src, /typeof amount !== "number" \|\| !Number\.isFinite\(amount\)/);
  });

  it("wraps in a Pressable only when a long-press reveal is requested", () => {
    assert.match(src, /if \(onLongPressOriginal\) \{/);
    assert.match(src, /onLongPress=\{\(\) => onLongPressOriginal\(original\)\}/);
  });
});

describe("CostBadge adoption — no cost-rendering re-rolls left", () => {
  it("collection summary renders totals through <CostBadge amount currency>", () => {
    const src = read("app/collection/[id].tsx");
    const matches = src.match(
      /<CostBadge amount=\{total\.amount\} currency=\{total\.currency\} style=\{styles\.summaryNumber\} \/>/g,
    ) ?? [];
    assert.equal(matches.length, 2, `expected owner + viewer summary adoptions, got ${matches.length}`);
    assert.doesNotMatch(src, /formatCostAmount/);
  });

  it("only cost-badge and collection-card still format costs directly", () => {
    // collection-card renders a label-less lifetime total (no per-item
    // conversion), so it keeps the pure formatter; every item-cost surface
    // must go through <CostBadge>.
    assert.match(read("components/collection-card.tsx"), /formatCostAmount/);
    assert.doesNotMatch(read("app/item/[id].tsx"), /formatCostAmount/);
    assert.doesNotMatch(read("components/item-card.tsx"), /formatCostAmount/);
  });
});
