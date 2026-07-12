import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  initAnalytics,
  trackEvent,
  __resetAnalyticsForTests,
} from "../lib/analytics";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import {
  canCreateAnotherListing,
  findListingByItemId,
  normalizeListing,
  upsertListing,
} from "../lib/marketplace-helpers";
import { relationshipForAnalytics } from "../lib/social-helpers";
import type {
  MarketplaceListing,
  MarketplaceMode,
  ProfileRelationship,
} from "../lib/types";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type Capture = { event: string; props: Record<string, unknown> };

/**
 * Boot the real `lib/analytics.ts` pipeline against a capture-recording fake
 * SDK (same pattern as analytics-simulate-signup.test.ts) so both funnel
 * events flow through every production gate — prop validation, opt-out,
 * enabled config, rate limit — instead of being asserted off a hand-rolled
 * mock of trackEvent.
 */
async function initWithFakeSdk(): Promise<Capture[]> {
  const captures: Capture[] = [];
  const sdk = {
    capture: (event: string, props: Record<string, unknown>) =>
      void captures.push({ event, props }),
    identify: () => undefined,
    reset: () => undefined,
  };
  const Ctor = function () {
    return sdk;
  } as unknown as new (key: string, opts?: unknown) => typeof sdk;
  await initAnalytics({
    env: {
      EXPO_PUBLIC_POSTHOG_KEY: "phc_test",
      EXPO_PUBLIC_ANALYTICS_ENV: "production",
    },
    loader: async () => Ctor as never,
  });
  return captures;
}

/**
 * Node-side stand-in for `MarketplaceProvider`: holds the listings array and
 * re-implements `addListing` / `markListingSold` on top of the SAME pure
 * helpers the provider delegates to (cap check, upsert, normalize, the
 * trade-mode price clamp, the already-sold guard) — so the state transitions
 * the funnel walks are the real ones, minus React and the cloud sync.
 */
function createStubMarketplace(sellerId: string) {
  let listings: MarketplaceListing[] = [];
  let nextId = 0;

  return {
    get listings() {
      return listings;
    },
    addListing(input: {
      itemId: string;
      mode: MarketplaceMode;
      askingPrice: number | null;
      isPremium?: boolean;
    }): MarketplaceListing | null {
      if (!canCreateAnotherListing(listings, sellerId, input.isPremium === true)) {
        return null;
      }
      const next = normalizeListing({
        id: `listing-${nextId++}`,
        itemId: input.itemId,
        ownerUserId: sellerId,
        mode: input.mode,
        askingPrice:
          input.mode === "sell" && typeof input.askingPrice === "number"
            ? input.askingPrice
            : null,
        currency: "USD",
        notes: "",
        createdAt: new Date().toISOString(),
        soldAt: null,
        buyerUserId: null,
        arrivedAt: null,
      });
      listings = upsertListing(listings, next);
      return next;
    },
    markListingSold(id: string, buyerUserId: string | null): void {
      const target = listings.find((l) => l.id === id);
      if (!target || target.soldAt) return;
      listings = upsertListing(listings, {
        ...target,
        soldAt: new Date().toISOString(),
        buyerUserId,
      });
    },
    getListingById(id: string): MarketplaceListing | undefined {
      return listings.find((l) => l.id === id);
    },
    findListingByItemId(itemId: string): MarketplaceListing | undefined {
      return findListingByItemId(listings, itemId);
    },
  };
}

type StubMarketplace = ReturnType<typeof createStubMarketplace>;

/**
 * Mirrors the success tail of `handleSubmitListing` in app/item/[id].tsx:
 * addListing → early-return unless it succeeded → trackEvent. `finalPrice`
 * is the post-parse value (trade mode never parses, so it stays null).
 */
function publishListing(
  ctx: StubMarketplace,
  input: { itemId: string; mode: MarketplaceMode; finalPrice: number | null },
): MarketplaceListing | null {
  const result = ctx.addListing({
    itemId: input.itemId,
    mode: input.mode,
    askingPrice: input.finalPrice,
  });
  if (!result) return null;
  trackEvent("listing_created", {
    mode: input.mode,
    hasPrice: input.finalPrice !== null,
  });
  return result;
}

/**
 * Mirrors `performClaim` in app/listing/[id].tsx: the claim payload derives
 * `mode` from the PERSISTED listing object (not from any buyer-side UI
 * state), and the relationship props from the canonical
 * `relationshipForAnalytics` bucket.
 */
function claimListing(
  ctx: StubMarketplace,
  listingId: string,
  buyerId: string,
  sellerRel: ProfileRelationship,
): boolean {
  const listing = ctx.getListingById(listingId);
  if (!listing || listing.soldAt) return false;
  ctx.markListingSold(listing.id, buyerId);
  const sellerRelationship = relationshipForAnalytics(sellerRel);
  trackEvent("listing_claimed", {
    mode: listing.mode,
    sellerWasFriend: sellerRelationship === "friend",
    sellerRelationship,
  });
  return true;
}

describe("marketplace purchase funnel — listing_created → listing_claimed integration", () => {
  beforeEach(() => {
    __resetAnalyticsForTests();
  });

  it("sell flow: both events fire with mode 'sell' and hasPrice true", async () => {
    const captures = await initWithFakeSdk();
    const ctx = createStubMarketplace("seller-1");

    const listing = publishListing(ctx, {
      itemId: "item-1",
      mode: "sell",
      finalPrice: 25,
    });
    assert.ok(listing, "publish must succeed under the free cap");
    assert.ok(claimListing(ctx, listing.id, "buyer-1", "friend"));

    assert.deepEqual(
      captures.map((c) => c.event),
      ["listing_created", "listing_claimed"],
    );
    const [created, claimed] = captures;
    assert.equal(created.props.mode, "sell");
    assert.equal(created.props.hasPrice, true);
    assert.equal(claimed.props.mode, "sell");
    assert.equal(claimed.props.sellerWasFriend, true);
    assert.equal(claimed.props.sellerRelationship, "friend");
  });

  it("trade flow: both events fire with mode 'trade' and hasPrice false", async () => {
    const captures = await initWithFakeSdk();
    const ctx = createStubMarketplace("seller-1");

    const listing = publishListing(ctx, {
      itemId: "item-1",
      mode: "trade",
      finalPrice: null,
    });
    assert.ok(listing);
    assert.ok(claimListing(ctx, listing.id, "buyer-1", "none"));

    const [created, claimed] = captures;
    assert.equal(created.props.mode, "trade");
    assert.equal(created.props.hasPrice, false);
    assert.equal(claimed.props.mode, "trade");
    assert.equal(claimed.props.sellerWasFriend, false);
    assert.equal(claimed.props.sellerRelationship, "stranger");
  });

  it("funnel arms agree on mode for every MarketplaceMode", async () => {
    const modes: MarketplaceMode[] = ["trade", "sell"];
    for (const mode of modes) {
      __resetAnalyticsForTests();
      const captures = await initWithFakeSdk();
      const ctx = createStubMarketplace("seller-1");
      const listing = publishListing(ctx, {
        itemId: "item-1",
        mode,
        finalPrice: mode === "sell" ? 10 : null,
      });
      assert.ok(listing);
      assert.ok(claimListing(ctx, listing.id, "buyer-1", "following"));
      const [created, claimed] = captures;
      assert.equal(
        created.props.mode,
        claimed.props.mode,
        `funnel arms drifted for mode '${mode}'`,
      );
      assert.equal(created.props.mode, mode);
    }
  });

  it("claim reads mode from the persisted listing — the sale round-trip preserves it", async () => {
    const captures = await initWithFakeSdk();
    const ctx = createStubMarketplace("seller-1");
    const listing = publishListing(ctx, {
      itemId: "item-1",
      mode: "trade",
      finalPrice: null,
    });
    assert.ok(listing);
    assert.ok(claimListing(ctx, listing.id, "buyer-1", "friend"));
    // The stored (now sold) row still carries the creation mode, and the
    // claimed payload matches it — the property the funnel depends on.
    const sold = ctx.getListingById(listing.id);
    assert.ok(sold?.soldAt, "listing must be sold after the claim");
    assert.equal(sold.mode, "trade");
    assert.equal(captures[1].props.mode, sold.mode);
  });

  it("a failed publish (free cap) emits neither funnel arm", async () => {
    const captures = await initWithFakeSdk();
    const ctx = createStubMarketplace("seller-1");
    const first = publishListing(ctx, {
      itemId: "item-1",
      mode: "sell",
      finalPrice: 5,
    });
    assert.ok(first);
    // Second active listing exceeds FREE_LISTING_CAP → addListing null →
    // the app's `if (!result) return` guard suppresses listing_created.
    const second = publishListing(ctx, {
      itemId: "item-2",
      mode: "trade",
      finalPrice: null,
    });
    assert.equal(second, null);
    assert.equal(
      captures.filter((c) => c.event === "listing_created").length,
      1,
      "the capped publish attempt must not emit a false-positive listing_created",
    );
  });

  it("an already-sold listing cannot emit a second listing_claimed", async () => {
    const captures = await initWithFakeSdk();
    const ctx = createStubMarketplace("seller-1");
    const listing = publishListing(ctx, {
      itemId: "item-1",
      mode: "sell",
      finalPrice: 12,
    });
    assert.ok(listing);
    assert.ok(claimListing(ctx, listing.id, "buyer-1", "none"));
    assert.equal(claimListing(ctx, listing.id, "buyer-2", "none"), false);
    assert.equal(
      captures.filter((c) => c.event === "listing_claimed").length,
      1,
      "double-claiming must not double-count the funnel denominator",
    );
  });

  it("both payloads survive assertValidProps intact — no key stripped by the registry", async () => {
    const captures = await initWithFakeSdk();
    const ctx = createStubMarketplace("seller-1");
    const listing = publishListing(ctx, {
      itemId: "item-1",
      mode: "sell",
      finalPrice: 7,
    });
    assert.ok(listing);
    assert.ok(claimListing(ctx, listing.id, "buyer-1", "friend"));
    assert.deepEqual(Object.keys(captures[0].props).sort(), [
      "hasPrice",
      "mode",
    ]);
    assert.deepEqual(Object.keys(captures[1].props).sort(), [
      "mode",
      "sellerRelationship",
      "sellerWasFriend",
    ]);
  });

  it("'mode' is a registry prop on BOTH funnel arms so reports can join them", () => {
    assert.ok(ANALYTICS_EVENTS.listing_created.props.includes("mode"));
    assert.ok(ANALYTICS_EVENTS.listing_claimed.props.includes("mode"));
  });
});

describe("real call sites share the anti-drift property the integration walks", () => {
  it("item screen: addListing and listing_created read mode from the same state variable", () => {
    const src = read("app/item/[id].tsx");
    assert.match(
      src,
      /addListing\(\{[\s\S]*?mode:\s*listingMode\s*,/,
      "addListing must receive the listingMode state",
    );
    const trackIdx = src.indexOf('trackEvent("listing_created"');
    assert.ok(trackIdx >= 0);
    assert.match(
      src.slice(trackIdx, trackIdx + 200),
      /mode:\s*listingMode\s*,/,
      "listing_created must derive mode from the SAME listingMode fed to addListing — one source, no drift",
    );
  });

  it("listing screen: performClaim re-checks soldAt so a just-sold listing can't emit a second listing_claimed", () => {
    const src = read("app/listing/[id].tsx");
    const declIdx = src.indexOf("const performClaim = useCallback");
    const trackIdx = src.indexOf('trackEvent("listing_claimed"');
    assert.ok(declIdx >= 0 && trackIdx >= 0);
    const head = src.slice(declIdx, trackIdx);
    assert.match(
      head,
      /if\s*\(\s*listing\.soldAt\s*\)\s*return;/,
      "performClaim must early-return on an already-sold listing before the transfer/analytics tail",
    );
  });

  it("listing screen: listing_claimed reads mode from the persisted listing object", () => {
    const src = read("app/listing/[id].tsx");
    const trackIdx = src.indexOf('trackEvent("listing_claimed"');
    assert.ok(trackIdx >= 0);
    assert.match(
      src.slice(trackIdx, trackIdx + 200),
      /mode:\s*listing\.mode\s*,/,
      "listing_claimed must derive mode from listing.mode (the stored row created by the seller) so the claim arm can never drift from the creation arm",
    );
  });
});
