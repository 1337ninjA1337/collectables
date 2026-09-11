/**
 * Pure selectors behind the home dashboard, kept out of `app/index.tsx` so they
 * stay node-importable under `tsx --test` (same reasoning as
 * `minimum-visible-helpers.ts` and `debounce-helpers.ts` — the screen itself
 * pulls react-native and expo-router and cannot be mounted).
 */

import { selectOwnedActiveItems } from "./collections-helpers";
import { byCreatedAtDescThenId } from "./sort-helpers";
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
 * a fixed-offset format — no `Date` parsing needed. Items sharing a timestamp
 * keep their input order: `Array.prototype.sort` has been stable since ES2019,
 * but only for a consistent comparator, which is why this goes through
 * `byCreatedAtDesc` rather than the inline `? -1 : 1` it used to inline.
 * `selectOwnedActiveItems` returns a fresh array, so the sort never touches the
 * caller's (context-owned) `items`.
 */
export function selectRecentItems(
  items: CollectableItem[],
  collections: Collection[],
  limit: number = RECENT_ITEMS_LIMIT,
): CollectableItem[] {
  return selectOwnedActiveItems(items, collections)
    .sort(byCreatedAtDescThenId)
    .slice(0, Math.max(0, limit));
}

/**
 * The collections shown under "Friends' collections" — on BOTH screens that
 * carry that label.
 *
 * There were two lists with one name. `app/index.tsx` filtered the merged
 * `collections` by "a viewer copy whose owner is a friend, or a collection
 * somebody shared with me"; `app/collections-feed.tsx` rendered the context's
 * `friendCollections`, which is only what `fetchPublicCollectionsByUserId`
 * returned for each friend. So the feed's tab was a strict subset: no seeded
 * friend collections (the whole list, on a device with no Supabase, or before
 * the fetch lands) and nothing shared directly with the viewer. A user moving
 * between two screens saw two different answers to one question, and nothing
 * said which was meant.
 *
 * The merged rule wins because it is the one that can see every source: the
 * context's `collections` already holds the cloud fetch, the seeds and the
 * shares, and reading the merged list is what makes this one answer rather
 * than one per fetch that happens to have landed.
 *
 * **The shared-with-me arm is deliberate and it is not obviously right.** A
 * collection a stranger shared with the viewer appears here, under a label
 * that says "friends". It is here because there is nowhere else: no screen in
 * the app renders `sharedWithMeCollections` on its own, so dropping the arm
 * would not move those collections, it would hide them. The arm goes when that
 * surface exists.
 */
export function selectFriendCollections(
  collections: readonly Collection[],
  friendIds: ReadonlySet<string>,
  sharedWithMeCollections: readonly Collection[],
): Collection[] {
  const sharedWithMeIds = new Set(sharedWithMeCollections.map((c) => c.id));
  return collections.filter(
    (collection) =>
      collection.role === "viewer" &&
      (friendIds.has(collection.ownerUserId) || sharedWithMeIds.has(collection.id)),
  );
}
