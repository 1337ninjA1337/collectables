import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { locales } from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural tests for the "List on marketplace" UI inside app/item/[id].tsx
 * and the corresponding new translation keys. We grep the source files so the
 * test runs under node --test without RN peers.
 */

describe("item detail: marketplace listing UI", () => {
  it("imports the marketplace context", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /from\s+"@\/lib\/marketplace-context"/);
    assert.match(src, /useMarketplace\(\)/);
  });

  it("renders the List on marketplace button only for owners with no existing listing", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /marketplaceListOnMarketplace/);
    assert.match(src, /existingListing/);
    // The owner-gated branch must check isOwner before the listing UI.
    assert.match(src, /isOwner\s*\?\s*\(\s*existingListing/);
  });

  it("disables the button when the free cap is hit", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /overFreeCap/);
    assert.match(src, /myActiveListingCount\s*>=\s*1/);
    assert.match(src, /marketplaceUpgradeHint/);
  });

  it("renders a remove-listing button when the item is already listed", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /marketplaceRemoveListing/);
    assert.match(src, /removeListing\(existingListing\.id\)/);
  });

  it("opens a sheet with mode toggle, price (sell-only) and notes", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /listingSheetOpen/);
    assert.match(src, /marketplaceModeLabel/);
    assert.match(src, /marketplacePriceLabel/);
    assert.match(src, /marketplaceNotesLabel/);
    // Price field should only render when listingMode === "sell"
    assert.match(src, /listingMode\s*===\s*"sell"\s*\?/);
  });

  it("calls addListing on submit with the chosen mode and price", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /addListing\(\{[\s\S]*?itemId: activeItem\.id/);
    assert.match(src, /mode:\s*listingMode/);
    assert.match(src, /askingPrice:\s*finalPrice/);
  });
});

describe("marketplace listing translations", () => {
  it("declares listing-form keys in every language map", () => {
    const src = readI18nSource();
    const requiredKeys = [
      "marketplaceListOnMarketplace",
      "marketplaceRemoveListing",
      "marketplaceListedForSale",
      "marketplaceListedForTrade",
      "marketplaceListingTitle",
      "marketplaceListingHint",
      "marketplaceModeLabel",
      "marketplacePriceLabel",
      "marketplacePricePlaceholder",
      "marketplaceNotesLabel",
      "marketplaceNotesPlaceholder",
      "marketplaceSubmitListing",
      "marketplaceListingCreated",
      "marketplaceListingRemoved",
      "marketplaceListingFailed",
      "marketplaceUpgradeHint",
    ];
    for (const lang of locales(src)) {
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
