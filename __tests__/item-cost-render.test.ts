import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatCostAmount } from "@/lib/item-cost";
import { formatCostAmount as canonicalFormatCostAmount } from "@/lib/format-cost";
import { readI18nSource } from "./helpers/i18n-source-file";
import { assertValueInEveryLocale } from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

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

  // Both branches render the cost through <CostBadge> — only the labelling
  // differs. The compact card keeps `withLabel` ("Cost: 12 USD") because the
  // masonry cell has no other cost affordance; the full trading-card branch
  // drops the label because the value sits in the name bar's HP slot, where a
  // bare "12 USD" reads the way a printed card's HP does.
  it("renders <CostBadge item> in BOTH the compact and full branches", () => {
    const matches = src.match(/<CostBadge\s+item=\{item\}/g) ?? [];
    assert.equal(matches.length, 2, `expected 2 CostBadge adoptions, got ${matches.length}`);
    assert.match(src, /<CostBadge\s+item=\{item\}\s+withLabel\b/, "compact branch keeps the label");
    assert.match(src, /<CostBadge\s+item=\{item\}\s+style=\{styles\.hp\}/, "full branch fills the HP slot");
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
  const src = readI18nSource();

  it("declares itemValueApprox as an ≈ {amount} {currency} formatter in every locale", () => {
    assertValueInEveryLocale(
      src,
      "itemValueApprox",
      /^\(params\?:\s*TranslationParams\)\s*=>\s*`≈ \$\{params\?\.amount \?\? ""\} \$\{params\?\.currency \?\? ""\}`$/,
      "itemValueApprox is the ≈ {amount} {currency} formatter",
    );
  });
});
