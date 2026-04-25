import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { canCreateAnotherListing } from "@/lib/marketplace-helpers";
import { MarketplaceListing } from "@/lib/types";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-" + Math.random().toString(36).slice(2, 8),
    itemId: "item-1",
    ownerUserId: "alice",
    mode: "sell",
    askingPrice: 50,
    currency: "USD",
    notes: "",
    createdAt: "2026-04-25T00:00:00.000Z",
    soldAt: null,
    ...overrides,
  };
}

describe("marketplace cap respects premium", () => {
  it("blocks free user with one active listing", () => {
    const listings = [listing({ ownerUserId: "alice" })];
    assert.equal(canCreateAnotherListing(listings, "alice", false), false);
  });

  it("allows premium user with one active listing to add another", () => {
    const listings = [listing({ ownerUserId: "alice" })];
    assert.equal(canCreateAnotherListing(listings, "alice", true), true);
  });

  it("allows premium user with many active listings to keep adding", () => {
    const listings = [
      listing({ id: "a", ownerUserId: "alice" }),
      listing({ id: "b", ownerUserId: "alice", itemId: "item-2" }),
      listing({ id: "c", ownerUserId: "alice", itemId: "item-3" }),
    ];
    assert.equal(canCreateAnotherListing(listings, "alice", true), true);
  });

  it("free user with sold listings can still create one new", () => {
    const listings = [listing({ ownerUserId: "alice", soldAt: "2026-04-20T00:00:00.000Z" })];
    assert.equal(canCreateAnotherListing(listings, "alice", false), true);
  });
});

describe("item detail wires premium into the cap and addListing", () => {
  const src = read("app/item/[id].tsx");

  it("imports usePremium", () => {
    assert.match(src, /from\s+"@\/lib\/premium-context"/);
    assert.match(src, /usePremium\(\)/);
  });

  it("destructures isPremium from usePremium", () => {
    assert.match(src, /const\s+\{\s*isPremium\s*\}\s*=\s*usePremium\(\)/);
  });

  it("disables the cap-block path when isPremium is true", () => {
    assert.match(src, /overFreeCap\s*=\s*!isPremium\s*&&/);
  });

  it("forwards isPremium into addListing", () => {
    assert.match(src, /addListing\(\{[\s\S]*?isPremium\b/);
  });
});

describe("marketplace context honors isPremium when adding listings", () => {
  const src = read("lib/marketplace-context.tsx");

  it("DraftListingInput accepts an isPremium flag", () => {
    assert.match(src, /isPremium\?:\s*boolean/);
  });

  it("addListing reads isPremium from input", () => {
    assert.match(src, /input\.isPremium\s*===\s*true/);
  });

  it("addListing uses canCreateAnotherListing with the premium flag", () => {
    assert.match(src, /canCreateAnotherListing\(listings,\s*user\.id,\s*isPremium\)/);
  });
});
