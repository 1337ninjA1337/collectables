import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { formatCostAmount } from "@/lib/item-cost";
import { formatCostAmount as canonicalFormatCostAmount } from "@/lib/format-cost";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("formatCostAmount (re-exported via lib/item-cost)", () => {
  it("is the exact same function as lib/format-cost's (no drift possible)", () => {
    assert.equal(formatCostAmount, canonicalFormatCostAmount);
  });

  it("keeps whole numbers whole (no trailing zeros)", () => {
    assert.equal(formatCostAmount(100), "100");
    assert.equal(formatCostAmount(0), "0");
  });

  it("renders fractional (converted) amounts at 2 decimals, dropping zero-noise", () => {
    assert.equal(formatCostAmount(92.3456), "92.35");
    // The old lib/item-cost copy padded this to "90.00"; the canonical
    // formatter rounds then drops the empty fraction.
    assert.equal(formatCostAmount(90.000001), "90");
  });

  it("uses thousands separators like the collection totals always did", () => {
    assert.equal(formatCostAmount(1500), "1,500");
  });
});

describe("item-card — renders cost via the shared <CostBadge>", () => {
  const src = read("components/item-card.tsx");

  it("imports CostBadge and no longer duplicates the conversion pipeline", () => {
    assert.match(src, /import\s*\{\s*CostBadge\s*\}\s*from\s*"@\/components\/cost-badge"/);
    assert.doesNotMatch(src, /convertItemCost/);
    assert.doesNotMatch(src, /itemValueApprox/);
    assert.doesNotMatch(src, /formatCostAmount/);
  });

  it("renders <CostBadge item withLabel> in BOTH the compact and full branches", () => {
    const matches = src.match(/<CostBadge\s+item=\{item\}\s+withLabel\b/g) ?? [];
    assert.equal(matches.length, 2, `expected 2 CostBadge adoptions, got ${matches.length}`);
  });

  it("drops the old raw `{item.cost}{item.costCurrency}` inline render", () => {
    assert.doesNotMatch(src, /\{item\.cost\}\{item\.costCurrency\s*\?/);
  });
});

describe("item detail — cost meta row via <CostBadge> + long-press original", () => {
  const src = read("app/item/[id].tsx");

  it("gates the meta row on the shared hasFiniteCost helper", () => {
    assert.match(src, /import\s*\{\s*hasFiniteCost\s*\}\s*from\s*"@\/lib\/item-cost"/);
    assert.match(src, /\{hasFiniteCost\(activeItem\)\s*\?\s*\(/);
  });

  it("reveals the original amount on long-press (toast) via onLongPressOriginal", () => {
    assert.match(src, /onLongPressOriginal=\{\(original\)\s*=>\s*toast\.info\(original\)\}/);
  });

  it("no longer re-rolls the conversion pipeline inline", () => {
    assert.doesNotMatch(src, /convertItemCost/);
    assert.doesNotMatch(src, /itemValueApprox/);
    assert.doesNotMatch(src, /formatCostAmount/);
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
