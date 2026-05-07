import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("listing detail screen", () => {
  it("resolves the listing from useMarketplace via the route param", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /useLocalSearchParams<\{ id: string \}>/);
    assert.match(src, /useMarketplace\(\)/);
    assert.match(src, /getListingById\(listingId\)/);
  });

  it("renders item title, mode badge and price", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceModeTrade/);
    assert.match(src, /marketplaceModeSell/);
    assert.match(src, /askingPrice/);
  });

  it("includes an owner profile chip linking to /profile/{ownerUserId}", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceOwnerLabel/);
    assert.match(src, /\/profile\/\$\{listing\.ownerUserId\}/);
  });

  it("Message owner CTA calls ensureChatWith and routes to /chat/{ownerUserId}", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /ensureChatWith\(listing\.ownerUserId\)/);
    assert.match(src, /\/chat\/\$\{listing\.ownerUserId\}/);
  });

  it("falls back to the friends-only EmptyState when the viewer cannot message the owner", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /canMessage\(listing\.ownerUserId\)/);
    assert.match(src, /chatOnlyFriendsTitle/);
    assert.match(src, /chatOnlyFriendsHint/);
  });

  it("hides the message CTA on the owner's own listing", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /isSelf/);
    assert.match(src, /marketplaceSelfHint/);
  });

  it("renders a not-found state when the listing id is unknown", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceListingNotFound/);
  });

  it("renders a Buy now / Trade request button for non-self viewers on active listings", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceBuyNow/);
    assert.match(src, /marketplaceTradeRequest/);
    // The button mounts only when the listing is not yet sold.
    assert.match(src, /!isSold\s*\?/);
  });

  it("threads the viewer's user.id into markListingSold when claiming", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /markListingSold\(listing\.id,\s*user\.id\)/);
  });

  it("confirms purchase via Alert.alert on native and window.confirm on web", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /Alert\.alert\(/);
    assert.match(src, /window\.confirm/);
    assert.match(src, /marketplaceConfirmBuyTitle/);
  });

  it("renders a 'Sold' banner with buyer name on sold listings", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /isSold\s*=\s*listing\.soldAt\s*!==\s*null/);
    assert.match(src, /marketplaceSoldBanner/);
    assert.match(src, /marketplaceSoldTo/);
  });

  it("ensures buyer profile is loaded so the banner can display the buyer's name", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /listing\.buyerUserId/);
    assert.match(src, /ensureProfilesLoaded/);
  });

  it("calls transferItemToBuyer with a snapshot of the source item before marking sold", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /transferItemToBuyer/);
    assert.match(src, /getItemById\(listing\.itemId\)/);
    // The transfer must run before markListingSold so a network/claim race
    // can't leave a sold listing without a corresponding buyer-side item.
    const transferIdx = src.indexOf("transferItemToBuyer(");
    const markSoldIdx = src.indexOf("markListingSold(listing.id");
    assert.ok(transferIdx > 0, "transferItemToBuyer not invoked");
    assert.ok(markSoldIdx > 0, "markListingSold not invoked");
    assert.ok(transferIdx < markSoldIdx, "transferItemToBuyer must run before markListingSold");
  });
});

describe("collections context: transferItemToBuyer", () => {
  it("exposes transferItemToBuyer on the context value", () => {
    const src = read("lib/collections-context.tsx");
    assert.match(src, /transferItemToBuyer:\s*\(/);
    assert.match(src, /AcquiredItemSnapshot/);
  });

  it("creates an Acquired collection if missing and adds the item to it", () => {
    const src = read("lib/collections-context.tsx");
    assert.match(src, /ACQUIRED_COLLECTION_ID_SUFFIX/);
    assert.match(src, /upsertCollection\(newCollection\)/);
    assert.match(src, /upsertItem\(nextItem\)/);
  });
});

describe("listing detail translations", () => {
  it("declares listing-detail keys in every language map", () => {
    const src = read("lib/i18n-context.tsx");
    const requiredKeys = [
      "marketplaceMessageOwner",
      "marketplaceOwnerLabel",
      "marketplaceListingNotFound",
      "marketplaceListingNotFoundHint",
      "marketplaceSelfHint",
      "marketplaceBuyNow",
      "marketplaceTradeRequest",
      "marketplaceConfirmBuyTitle",
      "marketplaceConfirmBuyText",
      "marketplaceConfirmTradeText",
      "marketplaceSoldBanner",
      "marketplaceSoldTo",
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
