import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeOwnItemIds } from "@/lib/item-id";
import { isUuidV4 } from "@/lib/uuid";
import type { CollectableItem } from "@/lib/types";

function makeItem(overrides: Partial<CollectableItem>): CollectableItem {
  return {
    id: "x",
    collectionId: "c1",
    title: "Item",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "you@example.com",
    createdByUserId: "owner-1",
    createdAt: "2026-06-17T00:00:00.000Z",
    cost: null,
    ...overrides,
  };
}

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

describe("normalizeOwnItemIds (BE-5)", () => {
  it("rewrites a legacy slug-<ts> id on the user's own item to a uuid", () => {
    const items = [makeItem({ id: "hot-wheels-1718000000000" })];
    const { items: next, rewritten } = normalizeOwnItemIds(items, "owner-1");

    assert.equal(rewritten.length, 1);
    assert.ok(isUuidV4(next[0].id), "id should be a valid v4 uuid");
    assert.equal(rewritten[0].id, next[0].id);
    // Non-id fields are preserved.
    assert.equal(next[0].title, "Item");
    assert.equal(next[0].collectionId, "c1");
  });

  it("rewrites a legacy wish-<slug>-<ts> wishlist id", () => {
    const items = [makeItem({ id: "wish-grail-1718000000000", isWishlist: true })];
    const { rewritten } = normalizeOwnItemIds(items, "owner-1");
    assert.equal(rewritten.length, 1);
    assert.ok(isUuidV4(rewritten[0].id));
  });

  it("leaves items that already carry a valid uuid untouched", () => {
    const items = [makeItem({ id: VALID_UUID })];
    const result = normalizeOwnItemIds(items, "owner-1");
    assert.equal(result.rewritten.length, 0);
    // Same array reference is returned on a no-op (no React churn).
    assert.equal(result.items, items);
    assert.equal(result.items[0].id, VALID_UUID);
  });

  it("does NOT rewrite legacy ids on items the user does not own", () => {
    const items = [
      makeItem({ id: "shared-thing-1718000000000", createdByUserId: "someone-else" }),
    ];
    const result = normalizeOwnItemIds(items, "owner-1");
    assert.equal(result.rewritten.length, 0);
    assert.equal(result.items[0].id, "shared-thing-1718000000000");
  });

  it("only rewrites the owner's legacy ids in a mixed list", () => {
    const items = [
      makeItem({ id: "legacy-mine-1", createdByUserId: "owner-1" }),
      makeItem({ id: VALID_UUID, createdByUserId: "owner-1" }),
      makeItem({ id: "legacy-theirs-1", createdByUserId: "owner-2" }),
    ];
    const { items: next, rewritten } = normalizeOwnItemIds(items, "owner-1");

    assert.equal(rewritten.length, 1);
    assert.ok(isUuidV4(next[0].id));
    assert.equal(next[1].id, VALID_UUID);
    assert.equal(next[2].id, "legacy-theirs-1");
  });

  it("uses the injected id generator (deterministic test seam)", () => {
    let n = 0;
    const items = [
      makeItem({ id: "a-1" }),
      makeItem({ id: "b-1" }),
    ];
    const { items: next } = normalizeOwnItemIds(items, "owner-1", () => `gen-${n++}`);
    assert.equal(next[0].id, "gen-0");
    assert.equal(next[1].id, "gen-1");
  });
});
