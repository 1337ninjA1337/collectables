import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { contentKey, dedupeItems } from "@/lib/dedupe-items";
import { normalizeOwnItemIds } from "@/lib/item-id";
import type { CollectableItem } from "@/lib/types";
import { deterministicUuidV4, isUuidV4 } from "@/lib/uuid";

const ROOT = path.join(process.cwd());

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
    createdAt: "",
    cost: null,
    ...overrides,
  };
}

describe("deterministicUuidV4", () => {
  it("produces a valid v4-shaped uuid", () => {
    assert.ok(isUuidV4(deterministicUuidV4("owner-1:hot-wheels-1718000000000")));
  });

  it("is stable: same seed → same uuid on every call", () => {
    const a = deterministicUuidV4("owner-1:legacy-9");
    const b = deterministicUuidV4("owner-1:legacy-9");
    assert.equal(a, b);
  });

  it("distinct seeds → distinct uuids (incl. near-identical seeds)", () => {
    const seeds = [
      "owner-1:legacy-1",
      "owner-1:legacy-2",
      "owner-2:legacy-1",
      "owner-1:legacy-1 ",
      "wishlist:owner-1",
      "wishlist:owner-2",
    ];
    const ids = new Set(seeds.map(deterministicUuidV4));
    assert.equal(ids.size, seeds.length);
  });
});

describe("normalizeOwnItemIds — deterministic remap (duplication root cause)", () => {
  it("re-running the rewrite yields the SAME uuid (no fresh row per run)", () => {
    const legacy = () => [makeItem({ id: "hot-wheels-1718000000000" })];
    const run1 = normalizeOwnItemIds(legacy(), "owner-1");
    const run2 = normalizeOwnItemIds(legacy(), "owner-1");
    assert.ok(isUuidV4(run1.items[0].id));
    assert.equal(
      run1.items[0].id,
      run2.items[0].id,
      "two hydrate runs (or two devices) must converge on one server row id",
    );
  });

  it("the same legacy id under different owners maps to different uuids", () => {
    const a = normalizeOwnItemIds([makeItem({ id: "legacy-1" })], "owner-1");
    const b = normalizeOwnItemIds(
      [makeItem({ id: "legacy-1", createdByUserId: "owner-2" })],
      "owner-2",
    );
    assert.notEqual(a.items[0].id, b.items[0].id);
  });
});

describe("dedupeItems — content pass (duplicates with divergent createdAt)", () => {
  const UUID_A = "11111111-2222-4333-8444-555555555555";
  const UUID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("collapses divergent-createdAt rows that share the same uploaded photos", () => {
    // Identical photo URLs = the same cloud asset = the same source item; a
    // genuine second purchase is photographed separately.
    const original = makeItem({
      id: UUID_A,
      photos: ["https://cdn.example/p1.jpg"],
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    const duplicate = makeItem({
      id: UUID_B,
      photos: ["https://cdn.example/p1.jpg"],
      createdAt: "2026-07-05T12:00:00.000Z",
    });
    const out = dedupeItems([duplicate, original]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, UUID_A, "the earliest-created copy must survive");
  });

  it("collapses when one copy has no createdAt (the pre-stamp local original)", () => {
    const local = makeItem({ id: "legacy-1", createdAt: "" });
    const cloud = makeItem({ id: UUID_B, createdAt: "2026-07-05T12:00:00.000Z" });
    const out = dedupeItems([local, cloud]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, UUID_B, "the uuid-keyed cloud copy must survive");
  });

  it("does NOT collapse photo-less same-content rows with two real, distinct createdAt (twin purchases)", () => {
    const a = makeItem({ id: UUID_A, createdAt: "2026-06-23T10:00:00.123Z" });
    const b = makeItem({ id: UUID_B, createdAt: "2026-06-23T10:05:42.987Z" });
    assert.equal(dedupeItems([a, b]).length, 2);
  });

  it("does NOT collapse rows that differ in any content field", () => {
    const a = makeItem({ id: UUID_A, title: "Card #1" });
    const b = makeItem({ id: UUID_B, title: "Card #2" });
    assert.equal(dedupeItems([a, b]).length, 2);
    // Distinct createdAt so the (pre-existing) identityKey pass doesn't merge
    // them first — the content pass must still keep them apart on photos.
    const c = makeItem({
      id: UUID_A,
      photos: ["p1"],
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    const d = makeItem({
      id: UUID_B,
      photos: ["p2"],
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    assert.equal(dedupeItems([c, d]).length, 2);
  });

  it("contentKey ignores createdAt/sortOrder but tracks every content field", () => {
    const base = makeItem({ id: UUID_A, createdAt: "2026-01-01T00:00:00.000Z" });
    const sameLater = makeItem({ id: UUID_B, createdAt: "2026-02-02T00:00:00.000Z", sortOrder: 5 });
    assert.equal(contentKey(base), contentKey(sameLater));
    assert.notEqual(contentKey(base), contentKey(makeItem({ description: "d" })));
    assert.notEqual(contentKey(base), contentKey(makeItem({ isWishlist: true })));
  });
});

describe("wishlist collection id (uuid column compliance)", () => {
  it("lib/supabase-profiles.ts no longer builds the non-uuid `wishlist-<userId>` id", () => {
    const src = readFileSync(path.join(ROOT, "lib/supabase-profiles.ts"), "utf8");
    assert.doesNotMatch(
      src,
      /`wishlist-\$\{userId\}`/,
      "collections.id is a uuid column — the string id was rejected by Postgres and wishlist items never synced",
    );
    assert.match(src, /deterministicUuidV4\(`wishlist:\$\{userId\}`\)/);
  });
});
