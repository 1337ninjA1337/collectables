import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural tests for the "Marketplace history" section on
 * `app/profile/[id].tsx`. We grep the source to avoid pulling in
 * React Native peers in node:test.
 */

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
  const src = readI18nSource();

  it("declares the new history keys in every language map", () => {
    const requiredKeys = [
      "marketplaceHistoryTitle",
      "marketplaceHistoryPurchasesLabel",
      "marketplaceHistorySalesLabel",
      "marketplaceHistoryEmpty",
      "marketplaceMySalesEmpty",
    ];
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      const declared = localeKeys(src, lang);
      for (const key of requiredKeys) {
        assert.ok(
          declared.has(key),
          `language '${lang}' missing key '${key}'`,
        );
      }
    }
  });
});
