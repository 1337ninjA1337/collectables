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

  it("gates the Buy / Trade button behind the friendsOnly EmptyState", () => {
    const src = read("app/listing/[id].tsx");
    // The claim button must live AFTER the friendsOnly EmptyState fork, so a
    // non-friend viewer never sees the claim CTA. If a future refactor pulls
    // the claim button out of the `: friendsOnly ? <EmptyState/> : (...)`
    // branch and renders it unconditionally, this assertion catches it.
    const friendsOnlyIdx = src.indexOf("friendsOnly ?");
    const claimIdx = src.indexOf("marketplaceBuyNow");
    assert.ok(friendsOnlyIdx > 0, "friendsOnly ternary not found");
    assert.ok(claimIdx > 0, "claim button label not found");
    assert.ok(
      friendsOnlyIdx < claimIdx,
      "marketplaceBuyNow must render after the friendsOnly EmptyState fork",
    );
    // friendsOnly is derived from canMessage — pinning the predicate so a
    // future refactor can't silently swap it for a weaker check (e.g. just
    // !isSelf) that would re-open the claim button to non-friends.
    assert.match(
      src,
      /friendsOnly\s*=\s*!isSelf\s*&&\s*!canMessage\(listing\.ownerUserId\)/,
    );
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

  it("fires a success toast after a successful claim", () => {
    const src = read("app/listing/[id].tsx");
    // Pin the toast call so a future refactor that drops the user feedback is
    // caught. The toast must fire AFTER markListingSold so an early failure
    // (e.g. cloud rejection) doesn't mislead the buyer with a green pill.
    assert.match(src, /toast\.success\(t\("marketplaceClaimSuccess"\)\)/);
    const markIdx = src.indexOf("markListingSold(listing.id");
    const toastIdx = src.indexOf('toast.success(t("marketplaceClaimSuccess"))');
    assert.ok(markIdx > 0 && toastIdx > 0, "markListingSold/toast.success not found");
    assert.ok(markIdx < toastIdx, "toast.success must follow markListingSold");
  });

  it("sends an auto-message to the seller after a successful claim", () => {
    const src = read("app/listing/[id].tsx");
    // Pulls sendMessage off the chat context...
    assert.match(src, /\{\s*ensureChatWith\s*,\s*canMessage\s*,\s*sendMessage\s*\}\s*=\s*useChat/);
    // ...and invokes it inside performClaim with the seller's id + a
    // templated body keyed on the listing mode.
    assert.match(src, /sendMessage\(listing\.ownerUserId,\s*messageBody\)/);
    assert.match(src, /marketplaceClaimAutoMessageBuy/);
    assert.match(src, /marketplaceClaimAutoMessageTrade/);
    // The chat send must run after markListingSold so a chat failure can't
    // leave the listing un-flipped — fire-and-forget on chat is intentional.
    const markIdx = src.indexOf("markListingSold(listing.id");
    const sendIdx = src.indexOf("sendMessage(listing.ownerUserId");
    assert.ok(markIdx > 0 && sendIdx > 0, "markListingSold/sendMessage not found");
    assert.ok(markIdx < sendIdx, "sendMessage must follow markListingSold");
    // void-call so a rejected promise doesn't bubble up and trigger the
    // outer finally before the trackEvent fires.
    assert.match(src, /void sendMessage\(listing\.ownerUserId/);
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
      "marketplaceClaimAutoMessageBuy",
      "marketplaceClaimAutoMessageTrade",
      "marketplaceClaimSuccess",
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
