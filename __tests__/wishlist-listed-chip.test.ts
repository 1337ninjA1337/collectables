import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";
import { findListingByItemId, LISTING_RULE_BY_ITEM_PATH } from "@/lib/marketplace-helpers";
import type { MarketplaceListing } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The wishlist screen showed no sign that a want was on the marketplace.
 *
 * The round before this one shut the door: `app/item/[id].tsx` refuses the
 * "List on marketplace" CTA for an item carrying `isWishlist`, because both
 * listing modes are an offer to hand the item over and a want is a thing the
 * collector does not have. It deliberately left the take-it-down path open,
 * because rows listed BEFORE the lock still exist and nothing sweeps them —
 * a one-time reconciliation would withdraw offers somebody made on purpose.
 *
 * SO THE STATE IS REACHABLE AND WAS INVISIBLE ON THE ONE SCREEN THAT MANAGES
 * WANTS. The item screen grew three marketplace states and the wishlist card
 * had none, so a collector with a standing offer for a thing they are still
 * looking for could only find it by opening the marketplace, or by promoting
 * the want — which resolves the wrong half of the problem.
 *
 * It is also the only route from the wishlist to the item screen. The card's
 * two buttons are Promote and Delete; the take-it-down button lives on the
 * item screen's `existingListing` branch, which sits ABOVE the wishlist
 * refusal and so is still reachable for a want. Without the chip there was no
 * way to press it from here.
 */

const SRC = readRepoFile("app/wishlist.tsx");
const BODY = stripComments(SRC);

function listing(over: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l1",
    itemId: "i1",
    ownerUserId: "u1",
    title: "Want",
    mode: "sell",
    createdAt: "2026-09-12T00:00:00.000Z",
    ...over,
  } as MarketplaceListing;
}

describe("the screen reads the listing store", () => {
  it("takes findListingByItemId from the marketplace context", () => {
    assert.match(BODY, /import \{ useMarketplace \} from "@\/lib\/marketplace-context";/);
    assert.match(BODY, /const \{ findListingByItemId \} = useMarketplace\(\);/);
  });

  it("asks it per row rather than deriving a second list", () => {
    // `myListings` would be the seller's whole store and would need filtering
    // to the row anyway; the by-id accessor is the same question the item
    // screen asks, so the two cannot disagree about what "listed" means.
    assert.match(BODY, /const listing = findListingByItemId\(item\.id\);/);
    assert.ok(!BODY.includes("myListings"), "the row derives its own list");
  });

  it("lists the accessor in the memoized renderItem's deps", () => {
    // renderWishlistCard is a useCallback. An accessor that reads the store
    // and is not a dep leaves the card rendering a listing that has since
    // been taken down — the failure mode that makes a memo look like it
    // works.
    const deps = BODY.slice(
      BODY.indexOf("ownedCollections.length,"),
      BODY.indexOf("const SWIPE_THRESHOLD"),
    );
    assert.ok(deps.length > 0, "could not parse the renderItem dep list");
    assert.ok(deps.includes("findListingByItemId"), "the store accessor is not a dep");
  });
});

describe("the chip", () => {
  it("renders only when there is an open listing", () => {
    assert.match(BODY, /\{listing \? \(/);
  });

  it("sits ahead of the cost and source chips", () => {
    // The one chip in the row that is about somebody ELSE — a standing offer
    // on every buyer's device. The other two are notes to self.
    const row = BODY.indexOf("<View style={styles.metaRow}>");
    const chip = BODY.indexOf("{listing ? (", row);
    const cost = BODY.indexOf("hasFiniteCost(item)", row);
    const source = BODY.indexOf("item.acquiredFrom ?", row);
    assert.ok(row > 0 && chip > row, "the chip is not in the meta row");
    assert.ok(chip < cost && chip < source, "the listing state is not the first chip");
  });

  it("says which mode, and costs no translation to do it", () => {
    // `marketplaceListedForSale` / `marketplaceListedForTrade` are the item
    // screen's own pill, already translated into all six locales. A pair of
    // wishlist-prefixed keys would have been those sentences translated twice.
    assert.match(BODY, /listing\.mode === "sell"/);
    assert.match(BODY, /t\("marketplaceListedForSale"\)/);
    assert.match(BODY, /t\("marketplaceListedForTrade"\)/);
  });

  it("is a button to the item screen and not to the public listing", () => {
    // `/listing/[id]` is the buyer-facing view; the take-it-down button is on
    // the item screen's `existingListing` branch.
    assert.match(BODY, /router\.push\(`\/item\/\$\{item\.id\}`\)/);
    assert.ok(!BODY.includes("`/listing/"), "the chip points at the buyer-facing screen");
  });

  it("carries a translated hint saying where the press goes", () => {
    // The visible text states the STATE; a press needs to say what it does.
    // `t(...)` and not a literal, which is the second rule check-a11y-jsx
    // exists for.
    assert.match(BODY, /accessibilityHint=\{t\("wishlistListedHint"\)\}/);
    assert.match(BODY, /accessibilityRole="button"/);
  });

  it("hides its chevron on all three platforms", () => {
    const chip = BODY.slice(
      BODY.indexOf("{listing ? ("),
      BODY.indexOf("{hasFiniteCost(item) ? ("),
    );
    assert.ok(chip.includes('name="chevron-forward"'), "wrong slice — no chevron in it");
    assert.ok(chip.includes("accessibilityElementsHidden"), "iOS");
    assert.ok(chip.includes('importantForAccessibility="no"'), "Android");
    assert.ok(chip.includes("aria-hidden"), "web");
  });

  it("is amber and not the item screen's success pill", () => {
    // Green says the listing is working as intended, which is true of a
    // holding and is the one claim this row cannot make: the app now refuses
    // to create this state.
    // On BODY, because the comment above the chip names the token it is
    // arguing against — a rule read off the source text would fail on its own
    // rationale.
    const style = BODY.slice(BODY.indexOf("listedChip: {"), BODY.indexOf("listedChipText: {"));
    assert.ok(style.includes("backgroundColor: AMBER_ACCENT"), "the chip is not amber");
    assert.ok(!BODY.includes("SUCCESS_GREEN"), "the wishlist reuses the holding's success pill");
  });

  it("adds no way to CREATE a listing from the wishlist", () => {
    // The whole premise of the previous round. The chip reports a state and
    // opens the screen that can end it; it is not the CTA coming back in.
    assert.ok(!BODY.includes("addListing"), "the wishlist screen can create a listing");
    assert.ok(!BODY.includes("marketplaceListOnMarketplace"), "the CTA is back");
  });
});

describe("what counts as listed", () => {
  it("a sold listing leaves no chip", () => {
    // `findListingByItemId` already filters `soldAt`, so this is
    // `isOpenListing` asked by id — and a want that was somehow sold is
    // history rather than a standing offer.
    const open = listing();
    const sold = listing({ soldAt: "2026-09-12T01:00:00.000Z" });
    assert.equal(findListingByItemId([open], "i1"), open);
    assert.equal(findListingByItemId([sold], "i1"), undefined);
  });

  it("a listing for another item leaves no chip", () => {
    assert.equal(findListingByItemId([listing({ itemId: "other" })], "i1"), undefined);
  });

  it("either mode produces a chip, and they differ", () => {
    const sell = findListingByItemId([listing({ mode: "sell" })], "i1");
    const trade = findListingByItemId([listing({ mode: "trade" })], "i1");
    assert.equal(sell?.mode, "sell");
    assert.equal(trade?.mode, "trade");
  });
});

describe("the promote path's exemption", () => {
  it("stays exempt", () => {
    assert.match(LISTING_RULE_BY_ITEM_PATH.promoteWishlistItem, /^EXEMPT/);
  });

  it("no longer argues from a premise this round disproves", () => {
    // The original reason was "it could not have had a listing", which was
    // never true: the lock shipped after the marketplace. The verdict is
    // unchanged and the argument had to be — promoting is the transition that
    // makes such a listing honest, since the seller now owns the thing.
    const reason = LISTING_RULE_BY_ITEM_PATH.promoteWishlistItem;
    assert.ok(
      !reason.includes("could not have had a listing"),
      "the exemption still rests on a premise the wishlist chip contradicts",
    );
    assert.ok(reason.includes("app/wishlist.tsx"), "the reason does not name what renders the state");
  });
});

describe("wishlistListedHint", () => {
  const I18N = readI18nSource();

  it("is declared by every locale", () => {
    assertDeclaredInEveryLocale(I18N, "wishlistListedHint");
  });

  it("each locale writes its own words", () => {
    const values = [...localeValuesOf(I18N, "wishlistListedHint").values()];
    assert.equal(new Set(values).size, values.length, "two locales share a value");
  });

  it("is not the promote hint reused", () => {
    // The two sentences sit on the same card and answer different questions:
    // one is where the item should live, the other is how to stop selling it.
    const promote = localeValuesOf(I18N, "wishlistPromoteHint");
    for (const [code, hint] of localeValuesOf(I18N, "wishlistListedHint")) {
      assert.notEqual(hint, promote.get(code), `${code} answers both with one sentence`);
    }
  });

  it("says what the press leads to in every locale", () => {
    // A hint that only restated the chip would be worse than none: the chip's
    // own text already says the state.
    const listed = localeValuesOf(I18N, "marketplaceListedForSale");
    for (const [code, hint] of localeValuesOf(I18N, "wishlistListedHint")) {
      assert.ok(hint.length > (listed.get(code) ?? "").length, `${code}'s hint restates the chip`);
      assert.notEqual(hint, listed.get(code), `${code}'s hint IS the chip`);
    }
  });
});
