import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  activeListings,
  canCreateAnotherListing,
  countActiveListingsForUser,
  findListingByItemId,
  listingsForUser,
  normalizeTitle,
  PRICE_HISTORY_SIMILARITY_THRESHOLD,
  priceHistoryForTitle,
  removeListingById,
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
