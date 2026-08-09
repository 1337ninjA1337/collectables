/**
 * Pure selectors behind the home dashboard, kept out of `app/index.tsx` so they
 * stay node-importable under `tsx --test` (same reasoning as
 * `minimum-visible-helpers.ts` and `debounce-helpers.ts` — the screen itself
 * pulls react-native and expo-router and cannot be mounted).
 */

import { selectOwnedActiveItems } from "./collections-helpers";
import { CollectableItem, Collection } from "./types";

/**
 * How many cards the "Recently added" rail shows. The rail is a horizontal
 * `ScrollView`, so every entry mounts its remote image up-front — the cap is
 * what keeps the home screen off the iOS memory hot-path that the collection
 * screen needed chunked pagination for.
 */
export const RECENT_ITEMS_LIMIT = 10;

/**
 * Items eligible for the home "Recently added" rail, newest first.
 *
 * The three exclusions (wishlist, archived, non-owned collection) are shared
 * with the stats screen and live in `selectOwnedActiveItems` — see there for
 * why each one is load-bearing.
 *
 * Sorting is on the ISO `createdAt` string, which orders lexicographically for
 * a fixed-offset format — no `Date` parsing needed, and stable for items that
 * share a timestamp because `Array.prototype.sort` is stable in ES2019+.
 * `selectOwnedActiveItems` returns a fresh array, so the sort never touches the
 * caller's (context-owned) `items`.
 */
export function selectRecentItems(
  items: CollectableItem[],
  collections: Collection[],
  limit: number = RECENT_ITEMS_LIMIT,
): CollectableItem[] {
  return selectOwnedActiveItems(items, collections)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, Math.max(0, limit));
}
