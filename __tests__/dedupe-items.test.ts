import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dedupeItems, identityKey } from "@/lib/dedupe-items";
import type { CollectableItem } from "@/lib/types";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function makeItem(over: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: UUID_A,
    collectionId: "col-1",
    title: "Charizard",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "you@example.com",
    createdByUserId: "owner-1",
    createdAt: "2026-06-23T10:00:00.123Z",
    cost: null,
    isWishlist: false,
    ...over,
  };
}

describe("dedupeItems", () => {
  it("returns the same array reference when there are no duplicates", () => {
    const items = [makeItem({ id: UUID_A }), makeItem({ id: UUID_B, title: "Blastoise" })];
    assert.equal(dedupeItems(items), items);
  });

  it("collapses exact id duplicates, merging later over earlier (cloud wins)", () => {
    const items = [
      makeItem({ id: UUID_A, description: "stale" }),
      makeItem({ id: UUID_A, description: "fresh" }),
    ];
    const out = dedupeItems(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].description, "fresh");
  });

  it("collapses same-identity rows that carry different ids (the doubling bug)", () => {
    // Two cloud rows for the same item, minted by separate legacy-id rewrites.
    const items = [
      makeItem({ id: UUID_A }),
      makeItem({ id: UUID_B }),
    ];
    const out = dedupeItems(items);
    assert.equal(out.length, 1);
  });

  it("keeps the uuid-keyed copy when a legacy-id duplicate exists", () => {
    const items = [
      makeItem({ id: "charizard-1718000000000" }), // legacy slug-ts id, seen first
      makeItem({ id: UUID_A }),
    ];
    const out = dedupeItems(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, UUID_A);
  });

  it("does NOT collapse genuinely distinct items that share a title", () => {
    // Same title + collection but different createdAt — two real purchases.
    const items = [
      makeItem({ id: UUID_A, createdAt: "2026-06-23T10:00:00.123Z" }),
      makeItem({ id: UUID_B, createdAt: "2026-06-23T10:05:42.987Z" }),
    ];
    assert.equal(dedupeItems(items).length, 2);
  });

  it("does NOT collapse same-content items owned by different users", () => {
    const items = [
      makeItem({ id: UUID_A, createdByUserId: "owner-1" }),
      makeItem({ id: UUID_B, createdByUserId: "owner-2" }),
    ];
    assert.equal(dedupeItems(items).length, 2);
  });

  it("preserves newest-first order of the surviving rows", () => {
    const items = [
      makeItem({ id: UUID_A, title: "Newest", createdAt: "2026-06-23T12:00:00.000Z" }),
      makeItem({ id: UUID_B, title: "Older", createdAt: "2026-06-20T09:00:00.000Z" }),
    ];
    const out = dedupeItems(items);
    assert.deepEqual(out.map((i) => i.title), ["Newest", "Older"]);
  });

  it("handles wishlist items (empty collectionId) without merging distinct wishes", () => {
    const a = makeItem({ id: UUID_A, collectionId: "", isWishlist: true, title: "Wish A" });
    const b = makeItem({ id: UUID_B, collectionId: "", isWishlist: true, title: "Wish B" });
    assert.equal(dedupeItems([a, b]).length, 2);
    // identical wish, two ids → collapses
    const dupWish = makeItem({ id: UUID_B, collectionId: "", isWishlist: true, title: "Wish A" });
    assert.equal(dedupeItems([a, dupWish]).length, 1);
  });

  it("identityKey is stable and field-sensitive", () => {
    const base = makeItem();
    assert.equal(identityKey(base), identityKey(makeItem({ id: UUID_B })));
    assert.notEqual(identityKey(base), identityKey(makeItem({ title: "Other" })));
    assert.notEqual(identityKey(base), identityKey(makeItem({ createdAt: "2026-01-01T00:00:00Z" })));
  });
});
