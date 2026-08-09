import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { RECENT_ITEMS_LIMIT, selectRecentItems } from "@/lib/home-helpers";
import { CollectableItem, Collection } from "@/lib/types";

/**
 * The home dashboard's "Recently added" rail.
 *
 * The selector applies three exclusions at once (wishlist, archived, non-owned
 * collection) and a regression that drops any ONE of them still compiles, still
 * renders, and silently leaks somebody else's item — or an item the user does
 * not own yet — onto their own home screen. Nothing about the rendered rail
 * makes that visible, so the contract is pinned here instead.
 *
 * The pure half is unit-tested; the wiring into `app/index.tsx` is pinned
 * structurally, since the screen pulls react-native + expo-router and cannot be
 * mounted under `tsx --test`.
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
  createdAt: string,
  extra: Partial<CollectableItem> = {},
): CollectableItem {
  return {
    id,
    collectionId,
    title: `Item ${id}`,
    acquiredAt: createdAt,
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "Anton",
    createdByUserId: "user-1",
    createdAt,
    ...extra,
  };
}

const OWNED = collection("owned", "owner");
const SHARED = collection("shared", "viewer");

describe("selectRecentItems — the wishlist exclusion", () => {
  it("drops wishlist items even when they are the newest thing in the collection", () => {
    const result = selectRecentItems(
      [
        item("owned-old", "owned", "2026-01-01T00:00:00.000Z"),
        item("wish-new", "owned", "2026-08-01T00:00:00.000Z", { isWishlist: true }),
      ],
      [OWNED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["owned-old"],
    );
  });

  it("keeps items whose isWishlist is explicitly false or absent", () => {
    // The field is optional, so legacy rows carry `undefined` — treating that
    // as truthy would empty the rail for every pre-wishlist item.
    const result = selectRecentItems(
      [
        item("explicit", "owned", "2026-02-01T00:00:00.000Z", { isWishlist: false }),
        item("legacy", "owned", "2026-01-01T00:00:00.000Z"),
      ],
      [OWNED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["explicit", "legacy"],
    );
  });
});

describe("selectRecentItems — the non-owned-collection exclusion", () => {
  it("drops items belonging to a collection the user only views", () => {
    const result = selectRecentItems(
      [
        item("mine", "owned", "2026-01-01T00:00:00.000Z"),
        item("theirs", "shared", "2026-08-01T00:00:00.000Z"),
      ],
      [OWNED, SHARED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["mine"],
    );
  });

  it("drops items whose collection is missing from the list entirely", () => {
    // An orphaned item (collection deleted, sync mid-flight) must not fall
    // through the ownership gate just because its role is unknowable.
    const result = selectRecentItems(
      [item("orphan", "vanished", "2026-08-01T00:00:00.000Z")],
      [OWNED],
    );
    assert.deepEqual(result, []);
  });

  it("returns nothing when the user owns no collections at all", () => {
    const result = selectRecentItems(
      [item("theirs", "shared", "2026-08-01T00:00:00.000Z")],
      [SHARED],
    );
    assert.deepEqual(result, []);
  });
});

describe("selectRecentItems — the archived exclusion", () => {
  it("drops items with an archivedAt timestamp", () => {
    const result = selectRecentItems(
      [
        item("live", "owned", "2026-01-01T00:00:00.000Z"),
        item("sold", "owned", "2026-08-01T00:00:00.000Z", {
          archivedAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
      [OWNED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["live"],
    );
  });

  it("keeps items whose archivedAt is null (the un-archive shape)", () => {
    const result = selectRecentItems(
      [item("unarchived", "owned", "2026-01-01T00:00:00.000Z", { archivedAt: null })],
      [OWNED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["unarchived"],
    );
  });
});

describe("selectRecentItems — all three exclusions compose", () => {
  it("keeps only the owned, non-wishlist, non-archived items", () => {
    const result = selectRecentItems(
      [
        item("keep-a", "owned", "2026-03-01T00:00:00.000Z"),
        item("wish", "owned", "2026-04-01T00:00:00.000Z", { isWishlist: true }),
        item("archived", "owned", "2026-05-01T00:00:00.000Z", {
          archivedAt: "2026-06-01T00:00:00.000Z",
        }),
        item("shared", "shared", "2026-07-01T00:00:00.000Z"),
        item("keep-b", "owned", "2026-02-01T00:00:00.000Z"),
        // A shared wishlist item — must be dropped by either gate alone.
        item("shared-wish", "shared", "2026-08-01T00:00:00.000Z", { isWishlist: true }),
      ],
      [OWNED, SHARED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["keep-a", "keep-b"],
    );
  });
});

describe("selectRecentItems — ordering and cap", () => {
  it("sorts newest first by createdAt", () => {
    const result = selectRecentItems(
      [
        item("mid", "owned", "2026-04-01T00:00:00.000Z"),
        item("newest", "owned", "2026-08-01T00:00:00.000Z"),
        item("oldest", "owned", "2026-01-01T00:00:00.000Z"),
      ],
      [OWNED],
    );
    assert.deepEqual(
      result.map((i) => i.id),
      ["newest", "mid", "oldest"],
    );
  });

  it("caps at RECENT_ITEMS_LIMIT and keeps the newest ones", () => {
    const items = Array.from({ length: RECENT_ITEMS_LIMIT + 5 }, (_, i) =>
      // Index 0 is the oldest, so the last five indices are what survives.
      item(`i-${i}`, "owned", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`),
    );
    const result = selectRecentItems(items, [OWNED]);
    assert.equal(result.length, RECENT_ITEMS_LIMIT);
    assert.equal(result[0].id, `i-${RECENT_ITEMS_LIMIT + 4}`);
    assert.ok(!result.some((i) => i.id === "i-0"));
  });

  it("honours an explicit limit, and treats a negative limit as empty", () => {
    const items = [
      item("a", "owned", "2026-03-01T00:00:00.000Z"),
      item("b", "owned", "2026-02-01T00:00:00.000Z"),
      item("c", "owned", "2026-01-01T00:00:00.000Z"),
    ];
    assert.deepEqual(
      selectRecentItems(items, [OWNED], 2).map((i) => i.id),
      ["a", "b"],
    );
    assert.deepEqual(selectRecentItems(items, [OWNED], 0), []);
    // Without the clamp, `slice(0, -1)` would drop the LAST item instead of
    // returning none — a silently wrong rail rather than an empty one.
    assert.deepEqual(selectRecentItems(items, [OWNED], -1), []);
  });

  it("does not mutate the caller's array", () => {
    const items = [
      item("a", "owned", "2026-01-01T00:00:00.000Z"),
      item("b", "owned", "2026-08-01T00:00:00.000Z"),
    ];
    const order = items.map((i) => i.id);
    selectRecentItems(items, [OWNED]);
    assert.deepEqual(
      items.map((i) => i.id),
      order,
      "selectRecentItems sorted the context's items array in place",
    );
  });

  it("returns an empty array for empty inputs", () => {
    assert.deepEqual(selectRecentItems([], []), []);
    assert.deepEqual(selectRecentItems([], [OWNED]), []);
  });
});

describe("app/index.tsx wiring", () => {
  const source = read("app/index.tsx");

  it("imports the selector rather than re-implementing the memo body", () => {
    assert.match(source, /import \{ selectRecentItems \} from "@\/lib\/home-helpers";/);
  });

  it("builds recentItems from the selector", () => {
    assert.match(source, /const recentItems = useMemo\(\s*\(\) => selectRecentItems\(items, collections\)/);
  });

  it("no longer filters isWishlist or role inline on the home screen", () => {
    // If someone re-inlines the filter, the unit tests above keep passing while
    // the screen quietly diverges from them.
    assert.ok(
      !source.includes("!item.isWishlist"),
      "app/index.tsx re-inlined the wishlist filter instead of using selectRecentItems",
    );
    assert.ok(
      !/collections\.filter\(\(c\) => c\.role === "owner"\)/.test(source),
      "app/index.tsx re-inlined the owned-collection filter",
    );
  });
});
