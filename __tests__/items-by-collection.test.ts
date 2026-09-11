import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { groupItemsByCollection } from "@/lib/collections-helpers";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * One pass over the item list, instead of two per card.
 *
 * Three context accessors asked the same question — "which live items belong
 * to this collection?" — and all three answered it by filtering the whole
 * merged array with the same predicate written out three times.
 * `getItemsForCollection` then SORTED its result, which was thrown away by the
 * `.length` every card call site took off it.
 *
 * The home screen renders a `<CollectionCard>` per collection and each card
 * wants a count and a total cost, so twenty cards walked every item the viewer
 * can see — their own, their friends', their subscriptions', their shares' —
 * forty times per render, and sorted twenty lists nobody read in order. The
 * owner's row asked for the total TWICE, once per field it wanted off the
 * result, which is a whole second currency conversion of every priced item.
 *
 * The predicate is what makes this more than an optimisation: a wishlist entry
 * is a want and an archived item is in the trash, and three copies of that rule
 * is three chances for a count to include what the total beside it excludes —
 * two numbers on one card disagreeing about one collection.
 */

const item = (over: Partial<CollectableItem> & { id: string; collectionId: string }): CollectableItem => ({
  title: "An item",
  acquiredAt: "",
  acquiredFrom: "",
  description: "",
  variants: "",
  photos: [],
  createdBy: "u-1",
  createdByUserId: "u-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("groupItemsByCollection", () => {
  it("indexes each collection's items by id", () => {
    const index = groupItemsByCollection([
      item({ id: "i-1", collectionId: "c-a" }),
      item({ id: "i-2", collectionId: "c-b" }),
      item({ id: "i-3", collectionId: "c-a" }),
    ]);

    assert.deepEqual(index.get("c-a")?.map((i) => i.id), ["i-1", "i-3"]);
    assert.deepEqual(index.get("c-b")?.map((i) => i.id), ["i-2"]);
  });

  it("leaves out wishlist entries", () => {
    // A wishlist entry is something the collector wants, not something they
    // hold. Counting one would inflate a collection by the things it lacks.
    const index = groupItemsByCollection([
      item({ id: "i-1", collectionId: "c-a" }),
      item({ id: "i-2", collectionId: "c-a", isWishlist: true }),
    ]);

    assert.deepEqual(index.get("c-a")?.map((i) => i.id), ["i-1"]);
  });

  it("leaves out archived items", () => {
    // Archived is the trash: excluded from listings, totals and counts, kept
    // in storage for stats and audit history. See `archivedAt` in lib/types.
    const index = groupItemsByCollection([
      item({ id: "i-1", collectionId: "c-a" }),
      item({ id: "i-2", collectionId: "c-a", archivedAt: "2026-02-02T00:00:00.000Z" }),
    ]);

    assert.deepEqual(index.get("c-a")?.map((i) => i.id), ["i-1"]);
  });

  it("treats a null archivedAt as not archived", () => {
    // The column is nullable and legacy rows carry `null` rather than being
    // absent. A truthiness test is the right one here and this is what pins it.
    const index = groupItemsByCollection([
      item({ id: "i-1", collectionId: "c-a", archivedAt: null }),
    ]);

    assert.deepEqual(index.get("c-a")?.map((i) => i.id), ["i-1"]);
  });

  it("has no entry for a collection whose items are all excluded", () => {
    // Not an empty array: `get` answering `undefined` and the call site's
    // `?? []` are the same answer, and an entry per collection would need the
    // collection list passed in to say nothing.
    const index = groupItemsByCollection([
      item({ id: "i-1", collectionId: "c-a", isWishlist: true }),
    ]);

    assert.equal(index.get("c-a"), undefined);
    assert.equal(index.size, 0);
  });

  it("preserves the order it was given", () => {
    // The accessors that need the drag order sort their own copy through
    // `byCollectionOrder`; the ones that count do not care. Re-ordering here
    // would be a second ordering rule nobody asked for.
    const index = groupItemsByCollection([
      item({ id: "i-3", collectionId: "c-a", sortOrder: 2 }),
      item({ id: "i-1", collectionId: "c-a", sortOrder: 0 }),
      item({ id: "i-2", collectionId: "c-a", sortOrder: 1 }),
    ]);

    assert.deepEqual(index.get("c-a")?.map((i) => i.id), ["i-3", "i-1", "i-2"]);
  });

  it("does not mutate the array it is given", () => {
    const input = [
      item({ id: "i-1", collectionId: "c-a" }),
      item({ id: "i-2", collectionId: "c-b" }),
    ];
    const before = [...input];

    groupItemsByCollection(input);

    assert.deepEqual(input, before);
  });

  it("answers an empty list with an empty index", () => {
    assert.equal(groupItemsByCollection([]).size, 0);
  });
});

describe("the provider asks the index rather than the array", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("builds the index once per change of `items`", () => {
    assert.match(
      SRC,
      /const itemsByCollection = useMemo\(\(\) => groupItemsByCollection\(items\), \[items\]\);/,
    );
  });

  it("no accessor writes the live-item predicate out any more", () => {
    // The three-clause shape all three accessors shared. A fourth written the
    // old way would re-open the drift this closes, and the predicate — not a
    // bare `collectionId` match — is what says "live items of this
    // collection": `deleteCollection` legitimately still filters `localItems`
    // by collection id, and must include the wishlist and archived rows this
    // one excludes, because every child needs a tombstone.
    assert.doesNotMatch(SRC, /item\.collectionId === collectionId &&\s*!item\.isWishlist/);
  });

  it("copies before sorting, because the array is the index's", () => {
    // `sort` is in place. Sorting the entry would reorder what every other
    // reader of that collection sees, from a getter that only reads.
    assert.match(
      SRC,
      /\[\.\.\.\(itemsByCollection\.get\(collectionId\) \?\? \[\]\)\]\s*\.sort\(byCollectionOrder\)/,
    );
  });

  it("counts without building the array or sorting it", () => {
    assert.match(
      SRC,
      /countItemsForCollection: \(collectionId\) =>\s*itemsByCollection\.get\(collectionId\)\?\.length \?\? 0/,
    );
  });

  it("sums the cost from the index too", () => {
    assert.match(SRC, /const entries = \(itemsByCollection\.get\(collectionId\) \?\? \[\]\)/);
  });

  it("declares the count accessor on the context shape", () => {
    assert.match(SRC, /countItemsForCollection: \(collectionId: string\) => number;/);
  });
});

describe("no screen takes `.length` of the sorted list", () => {
  const SCREENS = ["app/index.tsx", "app/profile/[id].tsx", "app/collection/[id].tsx"] as const;

  for (const screen of SCREENS) {
    it(`${screen} asks for a count rather than a discarded sort`, () => {
      const CODE = stripComments(readRepoFile(screen));
      assert.doesNotMatch(
        CODE,
        /getItemsForCollection\([^)]*\)\.length/,
        `${screen} still sorts a list to measure it`,
      );
    });
  }

  it("the home screen's owned row asks for its total once", () => {
    // It asked twice — `getCollectionTotalCost(id).amount` and then
    // `getCollectionTotalCost(id).currency` — which converted every priced
    // item in the collection a second time to read one string off the result.
    const CODE = stripComments(readRepoFile("app/index.tsx"));
    const calls = CODE.match(/getCollectionTotalCost\(collection\.id\)/g) ?? [];
    assert.equal(
      calls.length,
      3,
      "one call per card renderer (the owned row and the two borrowed-list tabs), each hoisted into a const",
    );
    assert.doesNotMatch(CODE, /getCollectionTotalCost\(collection\.id\)\.(amount|currency)/);
  });
});
