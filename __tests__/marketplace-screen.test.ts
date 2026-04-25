import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural tests for the marketplace screen and its bottom-nav entry. We
 * grep the source to avoid pulling in React Native peers in node:test.
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("marketplace screen", () => {
  it("renders the marketplace title from the i18n key", () => {
    const src = read("app/marketplace.tsx");
    assert.match(src, /t\("marketplaceTitle"\)/);
    assert.match(src, /t\("marketplaceEmpty"\)/);
  });

  it("uses the marketplace context's activeListings and Link to listing detail", () => {
    const src = read("app/marketplace.tsx");
    assert.match(src, /useMarketplace\(\)/);
    assert.match(src, /activeListings/);
    assert.match(src, /\/listing\/\$\{listing\.id\}/);
  });

  it("shows mode badge and price for sell mode", () => {
    const src = read("app/marketplace.tsx");
    assert.match(src, /marketplaceModeTrade/);
    assert.match(src, /marketplaceModeSell/);
    // Sell mode should render askingPrice + currency
    assert.match(src, /askingPrice/);
  });
});

describe("bottom-nav marketplace tab", () => {
  it("includes a marketplace nav item with storefront icons", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(src, /key:\s*"marketplace"/);
    assert.match(src, /storefront-outline/);
    assert.match(src, /"storefront"/);
  });

  it("routes to /marketplace on press and tracks active state", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(src, /navTo\("\/marketplace"/);
    assert.match(src, /onMarketplace/);
  });

  it("places marketplace adjacent to friends in the items array", () => {
    const src = read("components/bottom-nav.tsx");
    // Order check: marketplace appears before friends in the items declaration.
    const mpIndex = src.indexOf('key: "marketplace"');
    const frIndex = src.indexOf('key: "friends"');
    assert.ok(mpIndex > 0 && frIndex > 0, "expected both keys present");
    assert.ok(mpIndex < frIndex, "marketplace should be declared before friends");
  });

  it("keeps the plus button centered by adding a spacer cell", () => {
    const src = read("components/bottom-nav.tsx");
    // The implementation pads the row with an aria-hidden spacer cell so the
    // 7-cell layout (2 left + spacer + plus + 3 right) re-centers the plus.
    assert.match(src, /aria-hidden/);
  });
});

describe("marketplace translations", () => {
  it("declares marketplace keys in every language map", () => {
    const src = read("lib/i18n-context.tsx");
    const requiredKeys = [
      "marketplaceTitle",
      "marketplaceEmpty",
      "marketplaceEmptyTitle",
      "marketplaceSubtitle",
      "marketplaceEyebrow",
      "marketplaceModeTrade",
      "marketplaceModeSell",
      "marketplaceUnknownItem",
    ];
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      // Match `const <lang>: TranslationMap = {` (or the en literal) until the
      // matching closing `};` so we can scan only that language's block.
      const blockMatch =
        lang === "en"
          ? src.match(/const\s+en\s*=\s*{([\s\S]*?)\n}\s*as\s+const;/)
          : src.match(new RegExp(`const\\s+${lang}\\s*:\\s*TranslationMap\\s*=\\s*{([\\s\\S]*?)\\n};`));
      assert.ok(blockMatch, `could not locate language block for '${lang}'`);
      for (const key of requiredKeys) {
        assert.match(
          blockMatch![1],
          new RegExp(`\\b${key}\\s*:`),
          `language '${lang}' missing key '${key}'`,
        );
      }
    }
  });
});
