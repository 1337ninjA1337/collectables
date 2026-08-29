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

  it("picks the same survivor from two uuid-keyed identity duplicates, either way round", () => {
    // The tie the identity pass had no rule for until 2026-08-29. Both rows are
    // uuid-keyed — which is the COMMON case, because the BE-5 rewrite this pass
    // exists for minted a fresh uuid per copy — so the old
    // `isUuidV4(item) && !isUuidV4(existing)` test was false and it kept
    // whichever arrived first. Arrival order here is the id-keyed cloud-merge
    // order, so two devices holding identical data kept different rows, and the
    // fields outside the identity key are exactly where they differ.
    const first = makeItem({ id: UUID_A, description: "from device A" });
    const second = makeItem({ id: UUID_B, description: "from device B" });
    const forward = dedupeItems([first, second]);
    const reversed = dedupeItems([second, first]);
    assert.equal(forward.length, 1);
    assert.equal(reversed.length, 1);
    assert.equal(forward[0].id, reversed[0].id);
    // And it is the documented survivor — smallest id once both are uuids and
    // the identity key has already pinned createdAt equal.
    assert.equal(forward[0].id, UUID_A);
    assert.equal(forward[0].description, "from device A");
  });

  it("still prefers the uuid-keyed copy over a legacy id, whichever arrives first", () => {
    // The rule the tiebreak must not outrank: uuid beats legacy in both
    // directions, where a plain smallest-id order would sometimes pick the slug.
    const legacy = makeItem({ id: "charizard-1718000000000" });
    const uuid = makeItem({ id: UUID_B });
    assert.equal(dedupeItems([legacy, uuid])[0].id, UUID_B);
    assert.equal(dedupeItems([uuid, legacy])[0].id, UUID_B);
  });

  it("keeps a same-content pair it refuses to collapse in its original position", () => {
    // The content pass used to emit its BUCKETS rather than a flat list, so two
    // rows sharing a contentKey that `canCollapse` rejects — two genuine
    // purchases with distinct timestamps and no shared photo — were grouped
    // together and everything between them was pushed back. The file's own
    // invariant is that surviving rows keep their newest-first order, and
    // `getItemsForCollection` falls through to it for undragged items.
    //
    // The duplicate id in the middle is load-bearing: with nothing to collapse
    // the function returns the input array by reference and the reordering path
    // is never entered, which is why a three-row version of this case passes
    // against the bug.
    const newest = makeItem({ id: UUID_A, title: "Dup", createdAt: "2026-06-23T12:00:00.000Z" });
    const middle = makeItem({ id: UUID_B, title: "Other", createdAt: "2026-06-22T12:00:00.000Z" });
    const oldest = makeItem({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Dup",
      createdAt: "2026-06-21T12:00:00.000Z",
    });
    const out = dedupeItems([newest, { ...newest }, middle, oldest]);
    assert.equal(out.length, 3, "only the exact id duplicate may collapse");
    assert.deepEqual(out.map((i) => i.title), ["Dup", "Other", "Dup"]);
  });

  it("identityKey is stable and field-sensitive", () => {
    const base = makeItem();
    assert.equal(identityKey(base), identityKey(makeItem({ id: UUID_B })));
    assert.notEqual(identityKey(base), identityKey(makeItem({ title: "Other" })));
    assert.notEqual(identityKey(base), identityKey(makeItem({ createdAt: "2026-01-01T00:00:00Z" })));
  });
});
