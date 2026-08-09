import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ownedCollectionIds,
  selectOwnedActiveItems,
} from "@/lib/collections-helpers";
import { CollectableItem, Collection } from "@/lib/types";

/**
 * The shared "what do I actually have" predicate.
 *
 * `useCollections()` hands every screen ONE flat `items` array that mixes the
 * user's own items with items from collections merely shared with or followed
 * by them, plus wishlist entries (not owned yet) and archived entries (sold or
 * retired). Three screens re-derived that filter by hand and they disagreed:
 * the stats screen counted archived items toward `totalValue`, the growth chart
 * and the condition breakdown, because it checked `isWishlist` alone.
 *
 * The predicate now lives in one place and is pinned here; each consumer's
 * adoption is pinned structurally, since the screens pull react-native and
 * cannot be mounted under `tsx --test`.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function collection(id: string, role: Collection["role"]): Collection {
  return {
    id,
    name: `Collection ${id}`,
    coverPhoto: "",
    description: "",
    ownerName: "Anton",
    ownerUserId: "user-1",
    sharedWith: [],
    sharedWithUserIds: [],
    role,
    visibility: "public",
  };
}

function item(
  id: string,
  collectionId: string,
  extra: Partial<CollectableItem> = {},
): CollectableItem {
  return {
    id,
    collectionId,
    title: `Item ${id}`,
    acquiredAt: "2026-01-01T00:00:00.000Z",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "Anton",
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const OWNED = collection("owned", "owner");
const SHARED = collection("shared", "viewer");

describe("ownedCollectionIds", () => {
  it("keeps only role === owner", () => {
    assert.deepEqual(
      [...ownedCollectionIds([OWNED, SHARED, collection("owned-2", "owner")])],
      ["owned", "owned-2"],
    );
  });

  it("returns an empty set for no collections and for viewer-only lists", () => {
    assert.equal(ownedCollectionIds([]).size, 0);
    assert.equal(ownedCollectionIds([SHARED]).size, 0);
  });
});

describe("selectOwnedActiveItems", () => {
  it("drops wishlist items", () => {
    const result = selectOwnedActiveItems(
      [item("keep", "owned"), item("wish", "owned", { isWishlist: true })],
      [OWNED],
    );
    assert.deepEqual(result.map((i) => i.id), ["keep"]);
  });

  it("drops archived items", () => {
    const result = selectOwnedActiveItems(
      [
        item("keep", "owned"),
        item("sold", "owned", { archivedAt: "2026-08-01T00:00:00.000Z" }),
      ],
      [OWNED],
    );
    assert.deepEqual(result.map((i) => i.id), ["keep"]);
  });

  it("drops items from collections the user does not own, including orphans", () => {
    const result = selectOwnedActiveItems(
      [item("keep", "owned"), item("theirs", "shared"), item("orphan", "gone")],
      [OWNED, SHARED],
    );
    assert.deepEqual(result.map((i) => i.id), ["keep"]);
  });

  it("keeps the optional-field absent and null shapes (legacy rows)", () => {
    const result = selectOwnedActiveItems(
      [
        item("legacy", "owned"),
        item("explicit", "owned", { isWishlist: false, archivedAt: null }),
      ],
      [OWNED],
    );
    assert.deepEqual(result.map((i) => i.id), ["legacy", "explicit"]);
  });

  it("preserves input order and does not mutate the caller's array", () => {
    const items = [item("b", "owned"), item("a", "owned"), item("c", "owned")];
    const before = items.map((i) => i.id);
    const result = selectOwnedActiveItems(items, [OWNED]);
    assert.deepEqual(result.map((i) => i.id), ["b", "a", "c"]);
    assert.deepEqual(items.map((i) => i.id), before);
  });

  it("returns a fresh array, so callers may sort it in place", () => {
    const items = [item("a", "owned")];
    assert.notEqual(selectOwnedActiveItems(items, [OWNED]), items);
  });

  it("returns nothing when the user owns no collections", () => {
    assert.deepEqual(selectOwnedActiveItems([item("theirs", "shared")], [SHARED]), []);
  });
});

describe("app/stats.tsx adoption — the archived-items regression", () => {
  const source = read("app/stats.tsx");

  it("derives ownedItems from the shared selector", () => {
    assert.match(
      source,
      /import \{ selectOwnedActiveItems \} from "@\/lib\/collections-helpers";/,
    );
    assert.match(source, /selectOwnedActiveItems\(items, collections\)/);
  });

  it("no longer hand-rolls the isWishlist-only filter that leaked archived items", () => {
    assert.ok(
      !source.includes("!i.isWishlist"),
      "app/stats.tsx re-inlined the item filter; archived items would count toward totals again",
    );
  });

  it("memoises ownedCollections so the ownedItems memo is not rebuilt every render", () => {
    // The old code recreated `ownedCollections` on every render and listed it
    // as a memo dependency, which made the `useMemo` around ownedItems a no-op.
    assert.match(
      source,
      /const ownedCollections = useMemo\(\s*\(\) => collections\.filter\(\(c\) => c\.role === "owner"\)/,
    );
  });
});

describe("lib/home-helpers.ts reuses the shared predicate", () => {
  const source = read("lib/home-helpers.ts");

  it("builds the recent rail on top of selectOwnedActiveItems", () => {
    assert.match(
      source,
      /import \{ selectOwnedActiveItems \} from "\.\/collections-helpers";/,
    );
    assert.match(source, /return selectOwnedActiveItems\(items, collections\)/);
  });
});
