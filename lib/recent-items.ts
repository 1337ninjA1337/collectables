/**
 * Pure selector behind the home screen's "Recently added" rail — kept out of
 * `app/index.tsx` so the contract is node-importable under `tsx --test`,
 * exactly like `debounce-helpers.ts` and `minimum-visible-helpers.ts`.
 *
 * The rail is a dashboard of *your own shelf*, so three exclusions have to
 * hold at once, and each one leaks something different if it regresses:
 *
 *   - `isWishlist` — wishlist rows are things you do NOT own yet. Leaking
 *     them makes the "recently added" rail advertise purchases that never
 *     happened.
 *   - `archivedAt` — sold/archived rows stay in storage for stats and audit
 *     history (see the field doc on `CollectableItem`), but they are gone from
 *     every listing surface, this one included.
 *   - non-owned collections — `collections-context` merges in collections
 *     shared with you (`role: "viewer"`). Leaking those puts a friend's items
 *     on your home screen under a "NEW" badge.
 *
 * Because all three live in one `.filter()` callback, dropping any single
 * clause still compiles and still renders a plausible-looking rail — which is
 * why `__tests__/index-recent-items.test.ts` pins each one separately.
 */

import type { CollectableItem, Collection } from "./types";

/**
 * How many rows the horizontal rail shows. The list is a peek, not a feed —
 * the collection screens are where you browse — so the cap stays small enough
 * that the `ScrollView` never has to virtualize.
 */
export const RECENT_ITEMS_LIMIT = 10;

/**
 * Ids of the collections the signed-in user actually owns.
 *
 * A `Set` rather than an array scan: every caller asks "is this item's
 * collection mine?" once per item, so an array `.some()` is O(items ×
 * collections) where this is O(items + collections).
 */
export function ownedCollectionIds(collections: Collection[]): Set<string> {
  const ids = new Set<string>();
  for (const collection of collections) {
    if (collection.role === "owner") ids.add(collection.id);
  }
  return ids;
}

/**
 * Newest-first, own-shelf-only slice of `items`.
 *
 * `createdAt` is an ISO-8601 string, so a lexicographic compare is already a
 * chronological compare — no `Date` parsing needed. The comparator returns 0
 * on equal timestamps rather than a constant 1: a comparator that claims
 * `a > b` AND `b > a` is inconsistent, and V8 is free to order such elements
 * arbitrarily. Items minted in the same millisecond (a bulk import, a seed
 * fixture) would then shuffle between renders.
 */
export function selectRecentItems(
  items: CollectableItem[],
  collections: Collection[],
  limit: number = RECENT_ITEMS_LIMIT,
): CollectableItem[] {
  if (limit <= 0) return [];
  const ownedIds = ownedCollectionIds(collections);
  return items
    .filter(
      (item) =>
        !item.isWishlist && !item.archivedAt && ownedIds.has(item.collectionId),
    )
    .sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, limit);
}
