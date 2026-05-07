import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PRICE_HISTORY_SIMILARITY_THRESHOLD,
  priceHistoryForTitle,
  titleSimilarity,
} from "@/lib/marketplace-helpers";
import { MarketplaceListing } from "@/lib/types";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-" + Math.random().toString(36).slice(2, 8),
    itemId: "item-1",
    ownerUserId: "alice",
    mode: "sell",
    askingPrice: 100,
    currency: "USD",
    notes: "",
    createdAt: "2026-04-25T10:00:00.000Z",
    soldAt: null,
    buyerUserId: null,
    ...overrides,
  };
}

describe("titleSimilarity threshold edge cases", () => {
  it("treats casing differences as identical", () => {
    assert.equal(titleSimilarity("CHARIZARD", "charizard"), 1);
  });

  it("treats trailing punctuation as identical normalized titles", () => {
    assert.equal(titleSimilarity("Charizard!", "Charizard"), 1);
  });

  it("just-below-threshold pairs are filtered out", () => {
    // Different but partially overlapping should not pass the 0.9 cutoff.
    const sim = titleSimilarity("Charizard Holo", "Blastoise Holo");
    assert.ok(
      sim < PRICE_HISTORY_SIMILARITY_THRESHOLD,
      `expected < ${PRICE_HISTORY_SIMILARITY_THRESHOLD}, got ${sim}`,
    );
  });

  it("returns 0 when both inputs normalize to empty strings", () => {
    assert.equal(titleSimilarity("...", "!!!"), 0);
  });
});

describe("priceHistoryForTitle additional edge cases", () => {
  function withItemTitles(map: Record<string, string>) {
    return (id: string) => map[id] ?? null;
  }

  it("returns an empty array when no item titles match", () => {
    const ls = [listing({ itemId: "x", askingPrice: 50 })];
    const out = priceHistoryForTitle(
      "Totally different",
      ls,
      withItemTitles({ x: "Random Other Title XYZ" }),
    );
    assert.deepEqual(out, []);
  });

  it("skips listings whose item title can't be resolved", () => {
    const ls = [listing({ id: "L", itemId: "missing", askingPrice: 50 })];
    const out = priceHistoryForTitle("Anything", ls, () => null);
    assert.deepEqual(out, []);
  });

  it("returns the similarity score on each entry", () => {
    const ls = [listing({ id: "L", itemId: "i", askingPrice: 50 })];
    const out = priceHistoryForTitle(
      "Charizard Holo",
      ls,
      withItemTitles({ i: "Charizard Holo" }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].similarity, 1);
  });

  it("default limit of 10 caps the result set", () => {
    const ls: MarketplaceListing[] = [];
    for (let i = 0; i < 15; i++) {
      ls.push(
        listing({
          id: `L${i}`,
          itemId: `i${i}`,
          askingPrice: 10 + i,
          createdAt: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        }),
      );
    }
    const titles: Record<string, string> = {};
    ls.forEach((_, i) => (titles[`i${i}`] = "Same Title"));
    const out = priceHistoryForTitle("Same Title", ls, (id) => titles[id] ?? null);
    assert.equal(out.length, 10);
  });
});

describe("listing detail: price history wiring", () => {
  it("renders the price-history section using the helper", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /priceHistoryForTitle/);
    assert.match(src, /marketplacePriceHistoryLabel/);
    assert.match(src, /excludeListingId:\s*listing\.id/);
    // Limit must default to (or pass) 10 per spec.
    assert.match(src, /limit:\s*10/);
  });

  it("declares price-history translations in every language map", () => {
    const src = read("lib/i18n-context.tsx");
    const requiredKeys = [
      "marketplacePriceHistoryLabel",
      "marketplacePriceHistoryHint",
    ];
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      const block =
        lang === "en"
          ? src.match(/const\s+en\s*=\s*{([\s\S]*?)\n}\s*as\s+const;/)
          : src.match(new RegExp(`const\\s+${lang}\\s*:\\s*TranslationMap\\s*=\\s*{([\\s\\S]*?)\\n};`));
      assert.ok(block, `could not locate language block for '${lang}'`);
      for (const key of requiredKeys) {
        assert.match(
          block![1],
          new RegExp(`\\b${key}\\s*:`),
          `language '${lang}' missing key '${key}'`,
        );
      }
    }
  });
});
