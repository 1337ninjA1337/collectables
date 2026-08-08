import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RECENT_ITEMS_LIMIT,
  ownedCollectionIds,
  selectRecentItems,
} from "@/lib/recent-items";
import type { CollectableItem, Collection } from "@/lib/types";

const ROOT = path.join(__dirname, "..");

function makeCollection(over: Partial<Collection> = {}): Collection {
  return {
    id: "col-mine",
    name: "Mine",
    coverPhoto: "",
    description: "",
    ownerName: "You",
    ownerUserId: "u-1",
    sharedWith: [],
    sharedWithUserIds: [],
    role: "owner",
    visibility: "private",
    ...over,
  };
}

function makeItem(over: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: "i-1",
    collectionId: "col-mine",
    title: "Charizard",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "you@example.com",
    createdByUserId: "u-1",
    createdAt: "2026-06-01T10:00:00.000Z",
    cost: null,
    isWishlist: false,
    ...over,
  };
}

const MINE = makeCollection({ id: "col-mine", role: "owner" });
const THEIRS = makeCollection({ id: "col-theirs", role: "viewer", ownerUserId: "u-2" });

describe("ownedCollectionIds", () => {
  it("keeps only role: owner collections", () => {
    const ids = ownedCollectionIds([MINE, THEIRS]);
    assert.equal(ids.has("col-mine"), true);
    assert.equal(ids.has("col-theirs"), false);
    assert.equal(ids.size, 1);
  });

  it("returns an empty set for an empty collection list", () => {
    assert.equal(ownedCollectionIds([]).size, 0);
  });
});

describe("selectRecentItems — the three exclusions", () => {
  it("filters OUT wishlist items", () => {
    const owned = makeItem({ id: "owned" });
    const wish = makeItem({ id: "wish", isWishlist: true });
    const out = selectRecentItems([owned, wish], [MINE]);
    assert.deepEqual(out.map((i) => i.id), ["owned"]);
  });

  it("filters OUT items in collections the user does not own", () => {
    const mine = makeItem({ id: "mine", collectionId: "col-mine" });
    const theirs = makeItem({ id: "theirs", collectionId: "col-theirs" });
    const out = selectRecentItems([mine, theirs], [MINE, THEIRS]);
    assert.deepEqual(out.map((i) => i.id), ["mine"]);
  });

  it("filters OUT items whose collection is missing entirely", () => {
    // A shared collection that was un-followed leaves orphan items behind in
    // the merged list; they must not fall through to the rail.
    const orphan = makeItem({ id: "orphan", collectionId: "col-gone" });
    assert.deepEqual(selectRecentItems([orphan], [MINE]), []);
  });

  it("filters OUT archived items", () => {
    const live = makeItem({ id: "live" });
    const sold = makeItem({ id: "sold", archivedAt: "2026-07-01T00:00:00.000Z" });
    const out = selectRecentItems([live, sold], [MINE]);
    assert.deepEqual(out.map((i) => i.id), ["live"]);
  });

  it("applies all three exclusions together, not just the first that matches", () => {
    const keep = makeItem({ id: "keep" });
    const items = [
      keep,
      makeItem({ id: "wish", isWishlist: true }),
      makeItem({ id: "archived", archivedAt: "2026-07-01T00:00:00.000Z" }),
      makeItem({ id: "shared", collectionId: "col-theirs" }),
      // Belt and braces: a row that trips two clauses at once.
      makeItem({ id: "shared-wish", collectionId: "col-theirs", isWishlist: true }),
    ];
    assert.deepEqual(selectRecentItems(items, [MINE, THEIRS]).map((i) => i.id), ["keep"]);
  });

  it("treats a null archivedAt as not archived (legacy rows)", () => {
    const legacy = makeItem({ id: "legacy", archivedAt: null });
    assert.deepEqual(selectRecentItems([legacy], [MINE]).map((i) => i.id), ["legacy"]);
  });
});

describe("selectRecentItems — ordering and cap", () => {
  it("sorts newest first by createdAt", () => {
    const items = [
      makeItem({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeItem({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" }),
      makeItem({ id: "mid", createdAt: "2026-03-01T00:00:00.000Z" }),
    ];
    assert.deepEqual(selectRecentItems(items, [MINE]).map((i) => i.id), ["new", "mid", "old"]);
  });

  it("caps the result at RECENT_ITEMS_LIMIT", () => {
    const items = Array.from({ length: RECENT_ITEMS_LIMIT + 5 }, (_, n) =>
      makeItem({ id: `i-${n}`, createdAt: `2026-06-${String(n + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const out = selectRecentItems(items, [MINE]);
    assert.equal(out.length, RECENT_ITEMS_LIMIT);
    // Newest first means the highest-numbered ids survive the slice.
    assert.equal(out[0].id, `i-${RECENT_ITEMS_LIMIT + 4}`);
  });

  it("honours an explicit limit and returns nothing for a non-positive one", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b", createdAt: "2026-05-01T00:00:00.000Z" })];
    assert.equal(selectRecentItems(items, [MINE], 1).length, 1);
    assert.deepEqual(selectRecentItems(items, [MINE], 0), []);
    assert.deepEqual(selectRecentItems(items, [MINE], -3), []);
  });

  it("does not mutate the input array", () => {
    const items = [
      makeItem({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeItem({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    selectRecentItems(items, [MINE]);
    assert.deepEqual(items.map((i) => i.id), ["old", "new"]);
  });

  it("keeps equal createdAt rows in their original relative order", () => {
    // A constant-1 comparator (the pre-extraction shape) claims a > b AND
    // b > a, which lets V8 order same-millisecond rows arbitrarily.
    const stamp = "2026-06-01T10:00:00.000Z";
    const items = ["a", "b", "c", "d"].map((id) => makeItem({ id, createdAt: stamp }));
    assert.deepEqual(selectRecentItems(items, [MINE]).map((i) => i.id), ["a", "b", "c", "d"]);
  });
});

describe("home screen wiring", () => {
  const source = readFileSync(path.join(ROOT, "app", "index.tsx"), "utf8");

  it("app/index.tsx builds its rail from the shared selector", () => {
    assert.match(source, /import \{ selectRecentItems \} from "@\/lib\/recent-items"/);
    assert.match(source, /selectRecentItems\(items, collections\)/);
  });

  it("app/index.tsx no longer re-implements the exclusions inline", () => {
    assert.equal(
      /!item\.isWishlist/.test(source),
      false,
      "the wishlist exclusion belongs to lib/recent-items.ts — re-inlining it forks the contract",
    );
    assert.equal(/\.slice\(0, 10\)/.test(source), false, "use RECENT_ITEMS_LIMIT, not a literal cap");
  });

  it("app/stats.tsx shares ownedCollectionIds rather than scanning per item", () => {
    const stats = readFileSync(path.join(ROOT, "app", "stats.tsx"), "utf8");
    assert.match(stats, /import \{ ownedCollectionIds \} from "@\/lib\/recent-items"/);
    assert.equal(
      /ownedCollections\.some\(/.test(stats),
      false,
      "the O(items x collections) scan was replaced by a Set lookup",
    );
  });
});
