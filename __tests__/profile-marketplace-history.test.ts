import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural tests for the "Marketplace history" section on
 * `app/profile/[id].tsx`. We grep the source to avoid pulling in
 * React Native peers in node:test.
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("profile marketplace history section", () => {
  const src = read("app/profile/[id].tsx");

  it("imports the marketplace context + the purchases/sales helpers", () => {
    assert.match(src, /from\s+"@\/lib\/marketplace-context"/);
    assert.match(src, /purchasesForUser/);
    assert.match(src, /salesForUser/);
  });

  it("derives myPurchases and mySales from useMarketplace().listings", () => {
    assert.match(src, /useMarketplace\(\)/);
    assert.match(src, /purchasesForUser\(listings,\s*activeProfile\.id\)/);
    assert.match(src, /salesForUser\(listings,\s*activeProfile\.id\)/);
  });

  it("gates the marketplace history section on isSelf", () => {
    // The section must only render for the signed-in user, never for other profiles.
    assert.match(src, /isSelf\s*\?\s*\(\s*<View[\s\S]*?marketplaceHistoryTitle/);
  });

  it("renders the section heading and both sub-section labels", () => {
    assert.match(src, /t\("marketplaceHistoryTitle"\)/);
    assert.match(src, /t\("marketplaceHistoryPurchasesLabel"\)/);
    assert.match(src, /t\("marketplaceHistorySalesLabel"\)/);
  });

  it("falls back to a single empty state when the user has no marketplace activity", () => {
    assert.match(src, /myPurchases\.length\s*===\s*0\s*&&\s*mySales\.length\s*===\s*0/);
    assert.match(src, /t\("marketplaceHistoryEmpty"\)/);
  });

  it("links each history row to /listing/{id} so users can open the full detail", () => {
    assert.match(src, /href=\{`\/listing\/\$\{listing\.id\}`/);
  });
});

describe("marketplace history translations", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares the new history keys in every language map", () => {
    const requiredKeys = [
      "marketplaceHistoryTitle",
      "marketplaceHistoryPurchasesLabel",
      "marketplaceHistorySalesLabel",
      "marketplaceHistoryEmpty",
      "marketplaceMySalesEmpty",
    ];
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
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
