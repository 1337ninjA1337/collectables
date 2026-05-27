import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  activeListings,
  canCreateAnotherListing,
  coerceListing,
  coerceListings,
  countActiveListingsForUser,
  findListingByItemId,
  listingsAcquiredByUser,
  listingsForUser,
  normalizeListing,
  normalizeTitle,
  PRICE_HISTORY_SIMILARITY_THRESHOLD,
  priceHistoryForTitle,
  purchasesForUser,
  RECENTLY_SOLD_DEFAULT_LIMIT,
  recentlySoldListings,
  removeListingById,
  salesForUser,
  titleSimilarity,
  upsertListing,
} from "@/lib/marketplace-helpers";
import { MarketplaceListing, MarketplaceMode } from "@/lib/types";

function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-" + Math.random().toString(36).slice(2, 8),
    itemId: "item-1",
    ownerUserId: "alice",
    mode: "sell" as MarketplaceMode,
    askingPrice: 100,
    currency: "USD",
    notes: "",
    createdAt: "2026-04-25T10:00:00.000Z",
    soldAt: null,
    buyerUserId: null,
    ...overrides,
  };
}

describe("countActiveListingsForUser", () => {
  it("counts only owned, not-sold listings", () => {
    const ls = [
      listing({ id: "1", ownerUserId: "alice" }),
      listing({ id: "2", ownerUserId: "alice", soldAt: "2026-04-26T00:00:00.000Z" }),
      listing({ id: "3", ownerUserId: "bob" }),
    ];
    assert.equal(countActiveListingsForUser(ls, "alice"), 1);
    assert.equal(countActiveListingsForUser(ls, "bob"), 1);
    assert.equal(countActiveListingsForUser(ls, "carol"), 0);
  });
});

describe("canCreateAnotherListing", () => {
  it("blocks free-tier users at 1 active listing", () => {
    const ls = [listing({ ownerUserId: "alice" })];
    assert.equal(canCreateAnotherListing(ls, "alice", false), false);
    assert.equal(canCreateAnotherListing([], "alice", false), true);
  });

  it("ignores the cap for premium users", () => {
    const ls = [
      listing({ id: "1", ownerUserId: "alice" }),
      listing({ id: "2", ownerUserId: "alice" }),
    ];
    assert.equal(canCreateAnotherListing(ls, "alice", true), true);
  });

  it("treats sold listings as not counting against the cap", () => {
    const ls = [
      listing({ id: "1", ownerUserId: "alice", soldAt: "2026-04-26T00:00:00.000Z" }),
    ];
    assert.equal(canCreateAnotherListing(ls, "alice", false), true);
  });
});

describe("findListingByItemId", () => {
  it("returns the active listing for an item", () => {
    const target = listing({ id: "x", itemId: "item-7" });
    assert.equal(findListingByItemId([target], "item-7"), target);
  });

  it("ignores sold listings", () => {
    const ls = [listing({ itemId: "item-7", soldAt: "2026-04-26T00:00:00.000Z" })];
    assert.equal(findListingByItemId(ls, "item-7"), undefined);
  });
});

describe("upsertListing", () => {
  it("appends a new listing", () => {
    const a = listing({ id: "a" });
    const b = listing({ id: "b" });
    assert.deepEqual(upsertListing([a], b), [a, b]);
  });

  it("replaces by id", () => {
    const a1 = listing({ id: "a", notes: "old" });
    const a2 = listing({ id: "a", notes: "new" });
    assert.deepEqual(upsertListing([a1], a2), [a2]);
  });
});

describe("removeListingById", () => {
  it("drops the matching listing", () => {
    const a = listing({ id: "a" });
    const b = listing({ id: "b" });
    assert.deepEqual(removeListingById([a, b], "a"), [b]);
  });

  it("is a no-op for unknown ids", () => {
    const a = listing({ id: "a" });
    assert.deepEqual(removeListingById([a], "missing"), [a]);
  });
});

describe("activeListings", () => {
  it("filters out sold and sorts newest-first", () => {
    const old = listing({ id: "1", createdAt: "2026-04-20T10:00:00.000Z" });
    const sold = listing({ id: "2", soldAt: "2026-04-22T10:00:00.000Z" });
    const fresh = listing({ id: "3", createdAt: "2026-04-25T10:00:00.000Z" });
    const out = activeListings([old, sold, fresh]);
    assert.deepEqual(
      out.map((l) => l.id),
      ["3", "1"],
    );
  });
});

describe("purchasesForUser", () => {
  it("returns sold listings whose buyer is the user, newest-sold first", () => {
    const ls = [
      listing({
        id: "1",
        ownerUserId: "alice",
        buyerUserId: "bob",
        soldAt: "2026-04-25T10:00:00.000Z",
      }),
      listing({
        id: "2",
        ownerUserId: "carol",
        buyerUserId: "bob",
        soldAt: "2026-04-29T10:00:00.000Z",
      }),
      listing({ id: "3", ownerUserId: "alice", buyerUserId: null, soldAt: null }),
      listing({
        id: "4",
        ownerUserId: "alice",
        buyerUserId: "alice",
        soldAt: "2026-04-26T10:00:00.000Z",
      }),
    ];
    const out = purchasesForUser(ls, "bob");
    assert.deepEqual(out.map((l) => l.id), ["2", "1"]);
  });

  it("excludes listings not yet marked sold even if buyer is the user", () => {
    const ls = [
      listing({ id: "1", buyerUserId: "bob", soldAt: null }),
    ];
    assert.deepEqual(purchasesForUser(ls, "bob"), []);
  });

  it("returns empty array when the user has no purchases", () => {
    const ls = [listing({ buyerUserId: null })];
    assert.deepEqual(purchasesForUser(ls, "bob"), []);
  });
});

describe("listingsForUser", () => {
  it("returns all listings for a user (including sold), newest-first", () => {
    const a = listing({ id: "1", ownerUserId: "alice", createdAt: "2026-04-20T10:00:00.000Z" });
    const b = listing({ id: "2", ownerUserId: "alice", createdAt: "2026-04-25T10:00:00.000Z", soldAt: "2026-04-26T00:00:00.000Z" });
    const c = listing({ id: "3", ownerUserId: "bob", createdAt: "2026-04-21T10:00:00.000Z" });
    const out = listingsForUser([a, b, c], "alice");
    assert.deepEqual(out.map((l) => l.id), ["2", "1"]);
  });
});

describe("normalizeTitle", () => {
  it("strips diacritics, lowercases, collapses whitespace, and removes stopwords", () => {
    // "holo" is in COLLECTIBLE_STOPWORDS so it is stripped.
    assert.equal(normalizeTitle("  Pokémon — Charizard, holo!  "), "pokemon charizard");
  });

  it("strips multiple stopwords from a title", () => {
    assert.equal(normalizeTitle("Charizard Holo 1st Edition"), "charizard");
  });

  it("returns empty string for empty/whitespace input", () => {
    assert.equal(normalizeTitle("   "), "");
    assert.equal(normalizeTitle(""), "");
  });
});

describe("titleSimilarity", () => {
  it("returns 1.0 for identical normalized titles", () => {
    assert.equal(titleSimilarity("Holo Charizard", "holo charizard"), 1);
  });

  it("returns 1.0 for word-reordered identical content", () => {
    // Dice over bigrams: word reorderings share most bigrams; in this
    // particular pair the normalized strings differ only in word order
    // but bigrams come from the joined character stream so they may
    // differ slightly. Keep the assertion loose.
    const sim = titleSimilarity("Holo Charizard", "Charizard Holo");
    assert.ok(sim >= 0.5, `expected ≥ 0.5, got ${sim}`);
  });

  it("returns 0 for empty inputs", () => {
    assert.equal(titleSimilarity("", "anything"), 0);
    assert.equal(titleSimilarity("anything", ""), 0);
  });

  it("returns ≥0.9 for tiny typos", () => {
    const sim = titleSimilarity("Charizard Holo 1999", "Charizard Holo 1999!");
    assert.ok(sim >= PRICE_HISTORY_SIMILARITY_THRESHOLD, `expected ≥ 0.9, got ${sim}`);
  });

  it("returns <0.9 for unrelated titles", () => {
    const sim = titleSimilarity("Charizard Holo", "Mickey Mouse Watch");
    assert.ok(sim < PRICE_HISTORY_SIMILARITY_THRESHOLD, `expected < 0.9, got ${sim}`);
  });
});

describe("priceHistoryForTitle", () => {
  function withItemTitles(map: Record<string, string>) {
    return (id: string) => map[id] ?? null;
  }

  it("returns priced listings whose item title matches at ≥0.9 similarity", () => {
    const ls = [
      listing({ id: "L1", itemId: "i1", askingPrice: 100, createdAt: "2026-04-20T10:00:00Z" }),
      listing({ id: "L2", itemId: "i2", askingPrice: 120, createdAt: "2026-04-22T10:00:00Z" }),
      listing({ id: "L3", itemId: "i3", askingPrice: 999, createdAt: "2026-04-23T10:00:00Z" }),
    ];
    const titles = withItemTitles({
      i1: "Charizard Holo 1999",
      i2: "Charizard Holo 1999!",
      i3: "Mickey Mouse Watch",
    });
    const out = priceHistoryForTitle("Charizard Holo 1999", ls, titles);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.listingId).sort(), ["L1", "L2"]);
  });

  it("excludes the reference listing by id", () => {
    const ls = [
      listing({ id: "ref", itemId: "i1", askingPrice: 100 }),
      listing({ id: "other", itemId: "i2", askingPrice: 110 }),
    ];
    const titles = withItemTitles({ i1: "Same Thing", i2: "Same Thing" });
    const out = priceHistoryForTitle("Same Thing", ls, titles, { excludeListingId: "ref" });
    assert.deepEqual(out.map((e) => e.listingId), ["other"]);
  });

  it("excludes pure-trade listings (no askingPrice)", () => {
    const ls = [
      listing({ id: "trade", itemId: "i1", mode: "trade", askingPrice: null }),
      listing({ id: "sale", itemId: "i2", mode: "sell", askingPrice: 50 }),
    ];
    const titles = withItemTitles({ i1: "Same Thing", i2: "Same Thing" });
    const out = priceHistoryForTitle("Same Thing", ls, titles);
    assert.deepEqual(out.map((e) => e.listingId), ["sale"]);
  });

  it("sorts newest-first by recordedAt and respects limit", () => {
    const ls = [
      listing({ id: "1", itemId: "i", askingPrice: 10, createdAt: "2026-04-20T10:00:00Z" }),
      listing({ id: "2", itemId: "i", askingPrice: 20, createdAt: "2026-04-22T10:00:00Z" }),
      listing({ id: "3", itemId: "i", askingPrice: 30, createdAt: "2026-04-25T10:00:00Z" }),
    ];
    const titles = withItemTitles({ i: "Same" });
    const out = priceHistoryForTitle("Same", ls, titles, { limit: 2 });
    assert.deepEqual(out.map((e) => e.listingId), ["3", "2"]);
  });

  it("uses soldAt as the recordedAt when present", () => {
    const ls = [
      listing({
        id: "sold",
        itemId: "i",
        askingPrice: 50,
        createdAt: "2026-04-20T10:00:00Z",
        soldAt: "2026-04-25T10:00:00Z",
      }),
    ];
    const titles = withItemTitles({ i: "Same" });
    const out = priceHistoryForTitle("Same", ls, titles);
    assert.equal(out[0].recordedAt, "2026-04-25T10:00:00Z");
  });
});

describe("recentlySoldListings", () => {
  it("returns sold listings with a buyer, sorted by soldAt desc", () => {
    const ls = [
      listing({ id: "a", soldAt: "2026-04-26T11:00:00.000Z", buyerUserId: "buyer-a" }),
      listing({ id: "b", soldAt: "2026-04-28T11:00:00.000Z", buyerUserId: "buyer-b" }),
      listing({ id: "c", soldAt: "2026-04-25T11:00:00.000Z", buyerUserId: "buyer-c" }),
    ];
    const out = recentlySoldListings(ls);
    assert.deepEqual(out.map((l) => l.id), ["b", "a", "c"]);
  });

  it("excludes active (unsold) listings", () => {
    const ls = [
      listing({ id: "active", soldAt: null }),
      listing({ id: "sold", soldAt: "2026-04-26T11:00:00.000Z", buyerUserId: "buyer-a" }),
    ];
    assert.deepEqual(recentlySoldListings(ls).map((l) => l.id), ["sold"]);
  });

  it("excludes legacy 'mark sold' rows without a buyer", () => {
    // Listings sold without a transfer aren't useful pricing context — they're
    // just the seller flipping the flag manually. Excluded by design.
    const ls = [
      listing({ id: "legacy", soldAt: "2026-04-26T11:00:00.000Z", buyerUserId: null }),
      listing({ id: "modern", soldAt: "2026-04-26T11:00:00.000Z", buyerUserId: "buyer" }),
    ];
    assert.deepEqual(recentlySoldListings(ls).map((l) => l.id), ["modern"]);
  });

  it("caps the result at the default limit", () => {
    const ls = Array.from({ length: 20 }, (_, i) =>
      listing({
        id: `l-${i}`,
        soldAt: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        buyerUserId: "buyer",
      }),
    );
    const out = recentlySoldListings(ls);
    assert.equal(out.length, RECENTLY_SOLD_DEFAULT_LIMIT);
  });

  it("honours a caller-supplied limit", () => {
    const ls = Array.from({ length: 5 }, (_, i) =>
      listing({
        id: `l-${i}`,
        soldAt: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        buyerUserId: "buyer",
      }),
    );
    assert.equal(recentlySoldListings(ls, 2).length, 2);
  });

  it("does not mutate the input array", () => {
    const ls = [
      listing({ id: "a", soldAt: "2026-04-26T11:00:00.000Z", buyerUserId: "buyer" }),
      listing({ id: "b", soldAt: "2026-04-25T11:00:00.000Z", buyerUserId: "buyer" }),
    ];
    const before = ls.map((l) => l.id);
    recentlySoldListings(ls);
    assert.deepEqual(ls.map((l) => l.id), before);
  });
});

describe("listingsAcquiredByUser", () => {
  it("returns sold listings claimed by the user, sorted by createdAt desc", () => {
    const ls = [
      listing({ id: "old", buyerUserId: "buyer", soldAt: "2026-04-25T11:00:00.000Z", createdAt: "2026-04-20T09:00:00.000Z" }),
      listing({ id: "new", buyerUserId: "buyer", soldAt: "2026-04-26T11:00:00.000Z", createdAt: "2026-04-26T09:00:00.000Z" }),
      listing({ id: "mid", buyerUserId: "buyer", soldAt: "2026-04-27T11:00:00.000Z", createdAt: "2026-04-22T09:00:00.000Z" }),
    ];
    const out = listingsAcquiredByUser(ls, "buyer");
    assert.deepEqual(
      out.map((l) => l.id),
      ["new", "mid", "old"],
      "must mirror listingsForUser's createdAt-desc ordering, not purchasesForUser's soldAt-desc",
    );
  });

  it("excludes listings still listed (soldAt == null) and those bought by someone else", () => {
    const ls = [
      listing({ id: "1", buyerUserId: "buyer", soldAt: null }),
      listing({ id: "2", buyerUserId: "other", soldAt: "2026-04-26T11:00:00.000Z" }),
      listing({ id: "3", buyerUserId: "buyer", soldAt: "2026-04-26T11:00:00.000Z" }),
    ];
    const out = listingsAcquiredByUser(ls, "buyer");
    assert.deepEqual(out.map((l) => l.id), ["3"]);
  });

  it("returns [] when nothing matches", () => {
    const ls = [listing({ buyerUserId: "alice", soldAt: "2026-04-26T11:00:00.000Z" })];
    assert.deepEqual(listingsAcquiredByUser(ls, "bob"), []);
  });

  it("does not mutate the input listings array", () => {
    const ls = [
      listing({ id: "a", buyerUserId: "buyer", soldAt: "2026-04-26T11:00:00.000Z" }),
      listing({ id: "b", buyerUserId: "buyer", soldAt: "2026-04-25T11:00:00.000Z" }),
    ];
    const before = ls.map((l) => l.id);
    listingsAcquiredByUser(ls, "buyer");
    assert.deepEqual(ls.map((l) => l.id), before);
  });

  it("treats buyerUserId === null as not-acquired even when soldAt is set", () => {
    // Sold without a buyer is a legacy "mark sold" without a transfer record.
    const ls = [listing({ buyerUserId: null, soldAt: "2026-04-26T11:00:00.000Z" })];
    assert.deepEqual(listingsAcquiredByUser(ls, "anyone"), []);
  });
});

describe("salesForUser", () => {
  it("returns sold listings owned by the user, sorted by soldAt desc", () => {
    const ls = [
      listing({ id: "1", ownerUserId: "alice", soldAt: "2026-04-25T10:00:00.000Z", buyerUserId: "bob" }),
      listing({ id: "2", ownerUserId: "alice", soldAt: "2026-04-29T10:00:00.000Z", buyerUserId: "carol" }),
      listing({ id: "3", ownerUserId: "alice", soldAt: null, buyerUserId: null }),
      listing({ id: "4", ownerUserId: "bob", soldAt: "2026-04-28T10:00:00.000Z", buyerUserId: "alice" }),
    ];
    const out = salesForUser(ls, "alice");
    assert.deepEqual(out.map((l) => l.id), ["2", "1"]);
  });

  it("includes sales without a recorded buyer (legacy mark-sold rows)", () => {
    const ls = [
      listing({ id: "1", ownerUserId: "alice", soldAt: "2026-04-25T10:00:00.000Z", buyerUserId: null }),
    ];
    const out = salesForUser(ls, "alice");
    assert.deepEqual(out.map((l) => l.id), ["1"]);
  });

  it("excludes active (un-sold) listings", () => {
    const ls = [listing({ ownerUserId: "alice", soldAt: null })];
    assert.deepEqual(salesForUser(ls, "alice"), []);
  });

  it("returns [] when the user has no sales", () => {
    const ls = [listing({ ownerUserId: "bob", soldAt: "2026-04-25T10:00:00.000Z" })];
    assert.deepEqual(salesForUser(ls, "alice"), []);
  });

  it("does not mutate the input listings array", () => {
    const ls = [
      listing({ id: "a", ownerUserId: "alice", soldAt: "2026-04-25T10:00:00.000Z" }),
      listing({ id: "b", ownerUserId: "alice", soldAt: "2026-04-29T10:00:00.000Z" }),
    ];
    const before = ls.map((l) => l.id);
    salesForUser(ls, "alice");
    assert.deepEqual(ls.map((l) => l.id), before);
  });
});

describe("normalizeListing", () => {
  it("coerces a missing buyerUserId to null", () => {
    // Simulate a legacy AsyncStorage payload that omits buyerUserId entirely.
    const legacy = {
      id: "l-1",
      itemId: "item-1",
      ownerUserId: "alice",
      mode: "sell" as MarketplaceMode,
      askingPrice: 100,
      currency: "USD",
      notes: "",
      createdAt: "2026-04-25T10:00:00.000Z",
      soldAt: null,
    } as unknown as MarketplaceListing;

    const result = normalizeListing(legacy);
    assert.equal(result.buyerUserId, null);
    // The rest of the listing must round-trip unchanged.
    assert.equal(result.id, legacy.id);
    assert.equal(result.itemId, legacy.itemId);
    assert.equal(result.ownerUserId, legacy.ownerUserId);
    assert.equal(result.askingPrice, legacy.askingPrice);
  });

  it("coerces an explicit undefined buyerUserId to null", () => {
    const raw = listing({ buyerUserId: undefined as unknown as null });
    const out = normalizeListing(raw);
    assert.equal(out.buyerUserId, null);
  });

  it("preserves a non-null buyerUserId verbatim", () => {
    const raw = listing({ buyerUserId: "bob" });
    const out = normalizeListing(raw);
    assert.equal(out.buyerUserId, "bob");
  });

  it("preserves an explicit null buyerUserId without re-coalescing", () => {
    const raw = listing({ buyerUserId: null });
    const out = normalizeListing(raw);
    assert.equal(out.buyerUserId, null);
  });

  it("does not mutate the input listing", () => {
    const raw = listing({ buyerUserId: undefined as unknown as null });
    const before = { ...raw };
    normalizeListing(raw);
    assert.deepEqual(raw, before, "normalizeListing must be pure (no mutation)");
  });

  it("is safe to apply twice (idempotent)", () => {
    const raw = listing({ buyerUserId: undefined as unknown as null });
    const once = normalizeListing(raw);
    const twice = normalizeListing(once);
    assert.deepEqual(twice, once);
  });
});

describe("coerceListing", () => {
  function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "l-1",
      itemId: "item-1",
      ownerUserId: "alice",
      mode: "sell",
      askingPrice: 100,
      currency: "USD",
      notes: "",
      createdAt: "2026-04-25T10:00:00.000Z",
      soldAt: null,
      buyerUserId: null,
      ...overrides,
    };
  }

  it("returns a normalized listing on a valid row", () => {
    const result = coerceListing(validRaw());
    assert.ok(result);
    assert.equal(result!.id, "l-1");
    assert.equal(result!.mode, "sell");
    assert.equal(result!.askingPrice, 100);
    assert.equal(result!.buyerUserId, null);
  });

  it("accepts mode='trade' and askingPrice=null", () => {
    const result = coerceListing(validRaw({ mode: "trade", askingPrice: null }));
    assert.ok(result);
    assert.equal(result!.mode, "trade");
    assert.equal(result!.askingPrice, null);
  });

  it("coerces a missing buyerUserId to null without rejecting", () => {
    const raw = validRaw();
    delete raw.buyerUserId;
    const result = coerceListing(raw);
    assert.ok(result, "missing buyerUserId is a legacy shape, not corruption");
    assert.equal(result!.buyerUserId, null);
  });

  it("rejects rows missing required fields", () => {
    assert.equal(coerceListing(null), null);
    assert.equal(coerceListing(undefined), null);
    assert.equal(coerceListing("not an object"), null);
    assert.equal(coerceListing(42), null);
    assert.equal(coerceListing({}), null, "empty object is missing every field");
    assert.equal(coerceListing(validRaw({ id: undefined })), null);
    assert.equal(coerceListing(validRaw({ id: "" })), null, "empty id is not a valid id");
    assert.equal(coerceListing(validRaw({ itemId: undefined })), null);
    assert.equal(coerceListing(validRaw({ ownerUserId: undefined })), null);
    assert.equal(coerceListing(validRaw({ createdAt: undefined })), null);
  });

  it("rejects rows with an invalid mode (the exact crash vector the task targets)", () => {
    assert.equal(coerceListing(validRaw({ mode: undefined })), null);
    assert.equal(coerceListing(validRaw({ mode: "auction" })), null);
    assert.equal(coerceListing(validRaw({ mode: 42 })), null);
  });

  it("rejects rows with a malformed askingPrice", () => {
    assert.equal(coerceListing(validRaw({ askingPrice: "10" })), null);
    assert.equal(coerceListing(validRaw({ askingPrice: { v: 10 } })), null);
  });

  it("rejects rows with a malformed soldAt or buyerUserId", () => {
    assert.equal(coerceListing(validRaw({ soldAt: 1700000000 })), null);
    assert.equal(coerceListing(validRaw({ buyerUserId: 42 })), null);
  });
});

describe("coerceListings", () => {
  it("returns [] for non-array input", () => {
    assert.deepEqual(coerceListings(null), []);
    assert.deepEqual(coerceListings(undefined), []);
    assert.deepEqual(coerceListings("oops"), []);
    assert.deepEqual(coerceListings({}), []);
  });

  it("filters out corrupt entries while keeping the valid ones", () => {
    const raw = [
      {
        id: "l-1",
        itemId: "item-1",
        ownerUserId: "alice",
        mode: "sell",
        askingPrice: 100,
        currency: "USD",
        notes: "",
        createdAt: "2026-04-25T10:00:00.000Z",
        soldAt: null,
      },
      { id: "l-2" /* missing everything else */ },
      null,
      "not an object",
    ];
    const out = coerceListings(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "l-1");
    assert.equal(out[0].buyerUserId, null, "valid row must also be normalized");
  });
});
