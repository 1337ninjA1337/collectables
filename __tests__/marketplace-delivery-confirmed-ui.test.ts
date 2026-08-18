import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * Structural tests for the seller-side "Delivery confirmed {when}" indicator
 * on the My-sales card. We grep the source to avoid pulling React Native peers
 * into node:test.
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("marketplace My-sales — delivery confirmed indicator", () => {
  const src = read("app/marketplace.tsx");

  it("passes sellerView only to the My-sales grid", () => {
    // Exactly one ListingGrid call site opts into the seller-only treatment via
    // the bare `sellerView` JSX flag.
    const gridFlag = src.split("            sellerView\n").length - 1;
    assert.equal(gridFlag, 1, `expected sellerView on one grid, found ${gridFlag}`);
    // And it is threaded down into the card.
    assert.match(src, /sellerView=\{sellerView\}/);
  });

  it("pulls the relative-date helpers from useI18n in the card", () => {
    assert.match(src, /formatRelativeDate,\s*relativeDateLabel\s*}\s*=\s*useI18n\(\)/);
  });

  it("builds the label via relativeDateLabel + the new prefix key, gated on arrivedAt", () => {
    assert.match(src, /sellerView\s*&&\s*listing\.arrivedAt/);
    assert.match(
      src,
      /relativeDateLabel\(t\("marketplaceDeliveryConfirmed"\),\s*formatRelativeDate\(listing\.arrivedAt\)\)/,
    );
  });

  it("renders the label only when present", () => {
    assert.match(src, /deliveryConfirmedLabel\s*\?/);
    assert.match(src, /styles\.deliveryConfirmedPill\b/);
  });
});

describe("delivery-confirmed translations", () => {
  it("declares marketplaceDeliveryConfirmed in every language map", () => {
    const src = readI18nSource();
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      const declared = localeKeys(src, lang);
      assert.ok(
        declared.has("marketplaceDeliveryConfirmed"),
        `language '${lang}' missing key 'marketplaceDeliveryConfirmed'`,
      );
    }
  });
});
