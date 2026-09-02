import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { locales } from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural tests for the buyer "Mark as received" affordance on the
 * marketplace purchases grid and the listing-detail screen. We grep the
 * source to avoid pulling React Native peers into node:test.
 */

describe("marketplace purchases — mark as received", () => {
  const src = read("app/marketplace.tsx");

  it("pulls markListingReceived from the marketplace context", () => {
    assert.match(src, /markListingReceived\s*}\s*=\s*useMarketplace\(\)/);
  });

  it("fires the toast success on confirmation", () => {
    const idx = src.indexOf("handleMarkReceived");
    assert.ok(idx >= 0, "handleMarkReceived not found");
    const block = src.slice(idx, idx + 300);
    assert.match(block, /markListingReceived\(id\)/);
    assert.match(block, /toast\.success\(t\("marketplaceMarkReceivedSuccess"\)\)/);
  });

  it("passes onMarkReceived only to the purchases grid", () => {
    // Exactly one ListingGrid call site wires the receipt handler — purchases.
    const handlerUses = src.split("onMarkReceived={handleMarkReceived}").length - 1;
    assert.equal(handlerUses, 1, `expected onMarkReceived on one grid, found ${handlerUses}`);
  });

  it("gates the button on a null arrivedAt and flips to a Received badge otherwise", () => {
    assert.match(src, /listing\.arrivedAt\s*==\s*null/);
    assert.match(src, /t\("marketplaceMarkReceived"\)/);
    assert.match(src, /t\("marketplaceReceivedBadge"\)/);
    // The button must call back with the listing id.
    assert.match(src, /onMarkReceived\(listing\.id\)/);
  });
});

describe("listing detail — buyer mark as received", () => {
  const src = read("app/listing/[id].tsx");

  it("derives buyer + arrival flags from the listing", () => {
    assert.match(src, /const\s+isBuyer\s*=\s*!!user\s*&&\s*listing\.buyerUserId\s*===\s*user\.id/);
    assert.match(src, /const\s+hasArrived\s*=\s*listing\.arrivedAt\s*!==\s*null/);
  });

  it("only shows the affordance for the buyer of a sold listing", () => {
    assert.match(src, /isBuyer\s*&&\s*isSold/);
  });

  it("renders a button while unarrived and a banner once received", () => {
    assert.match(src, /handleMarkReceived/);
    assert.match(src, /markListingReceived\(listing\.id\)/);
    assert.match(src, /toast\.success\(t\("marketplaceMarkReceivedSuccess"\)\)/);
    assert.match(src, /t\("marketplaceMarkReceived"\)/);
    assert.match(src, /t\("marketplaceReceivedBadge"\)/);
  });
});

describe("mark-received translations", () => {
  it("declares the new keys in every language map", () => {
    const src = readI18nSource();
    const requiredKeys = [
      "marketplaceMarkReceived",
      "marketplaceReceivedBadge",
      "marketplaceMarkReceivedSuccess",
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
