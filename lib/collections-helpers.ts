/**
 * Pure helpers for the Collections domain — no React, no AsyncStorage,
 * no Supabase. Anything that operates on plain `Collection` / id values
 * and is testable in isolation lives here.
 */

import { CollectableItem, Collection } from "./types";

/**
 * Naming pattern for system-managed collections (Acquired, Wishlist,
 * Trash, Premium-only, etc.) that are derived per user. Centralising the
 * generator means a single edit to the `${ownerId}-${suffix}` shape
 * propagates to every system-managed collection.
 *
 * Examples:
 *   userScopedCollectionId("u-1", "acquired-marketplace")
 *     -> "u-1-acquired-marketplace"
 *   userScopedCollectionId("u-1", "wishlist")
 *     -> "u-1-wishlist"
 */
export function userScopedCollectionId(
  userId: string,
  suffix: string,
): string {
  return `${userId}-${suffix}`;
}

/**
 * Ids of the collections the user actually owns.
 *
 * `useCollections()` merges owned collections with the ones shared with or
 * followed by the user into one flat array, distinguished only by `role`. Any
 * screen that reports on "my stuff" has to re-derive this set, so it lives
 * here as a `Set` rather than as the `collections.some((c) => c.id === …)`
 * scan each call site used to write — that was O(items × collections) and,
 * because the intermediate array was rebuilt every render, defeated the
 * `useMemo` that wrapped it.
 */
export function ownedCollectionIds(collections: Collection[]): Set<string> {
  const ids = new Set<string>();
  for (const collection of collections) {
    if (collection.role === "owner") ids.add(collection.id);
  }
  return ids;
}

/**
 * The user's own, currently-held items: owned collection, not a wishlist
 * entry, not archived.
 *
 * This is the "what do I have" predicate that the home rail, the stats screen
 * and search all need, and each exclusion is load-bearing:
 *
 *   - **wishlist items** (`isWishlist`) are things the user does NOT own yet,
 *     so counting them inflates totals and reads as a false acquisition.
 *   - **archived items** (`archivedAt`) were sold or manually retired; per the
 *     field's contract in `lib/types.ts` they stay in storage for audit
 *     history but are excluded from listings, totals, recent items and search.
 *   - **items in non-owned collections** belong to somebody else; without the
 *     ownership gate their items are counted as the user's own.
 *
 * Order is preserved from `items` — callers that need a different order sort
 * their own copy.
 */
export function selectOwnedActiveItems(
  items: CollectableItem[],
  collections: Collection[],
): CollectableItem[] {
  const ownedIds = ownedCollectionIds(collections);
  return items.filter(
    (item) =>
      !item.isWishlist && !item.archivedAt && ownedIds.has(item.collectionId),
  );
}
