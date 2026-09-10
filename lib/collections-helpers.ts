/**
 * Pure helpers for the Collections domain — no React, no AsyncStorage,
 * no Supabase. Anything that operates on plain `Collection` / id values
 * and is testable in isolation lives here.
 */

import { CollectableItem, Collection } from "./types";
import { byCreatedAtDescThenId, compareKeysAsc } from "./sort-helpers";

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

/**
 * The collection-detail ordering: the user's manual drag order first, then the
 * items they never dragged, newest-first.
 *
 * Extracted from the inline comparator in `CollectionsProvider` so the rules
 * below are unit-testable — the provider pulls React Native and cannot be
 * mounted under `tsx --test`, which left this ordering pinned only by a source
 * regex even though it is the ordering every collection screen renders.
 *
 * Three rules, in order:
 *  1. **An item WITH a `sortOrder` outranks one without, in that direction
 *     only.** A dragged item has an explicit place the user chose; an
 *     undragged one has no opinion, so it sorts after rather than being
 *     interleaved by timestamp.
 *  2. **Both dragged → ascending `sortOrder`, ties broken by `id`.**
 *     `reorderItemsInCollection` writes a dense 0..N-1 run over the whole
 *     collection (the drag handler appends the unrendered tail precisely so the
 *     off-screen items keep their places), so one device cannot produce a
 *     duplicate index. Two can: the same owner reordering on phone and web
 *     merges per-item by `updated_at`, so one surviving index from each write
 *     can collide. Without the tiebreak the collision falls through to the
 *     incoming array, which is the id-keyed cloud-merge order.
 *  3. **Neither dragged → newest first, ties broken by `id`**
 *     (`byCreatedAtDescThenId`, for the same reason).
 */
export function byCollectionOrder(a: CollectableItem, b: CollectableItem): number {
  const aHas = typeof a.sortOrder === "number";
  const bHas = typeof b.sortOrder === "number";
  if (aHas && bHas) {
    return (a.sortOrder as number) - (b.sortOrder as number) || compareKeysAsc(a.id, b.id);
  }
  if (aHas) return -1;
  if (bHas) return 1;
  return byCreatedAtDescThenId(a, b);
}

/** What a reorder would write: the new item array, and only the rows that moved. */
export type ItemReorderPlan = {
  /** Every item, the collection's members renumbered in place. `items` by reference when nothing moved. */
  readonly items: CollectableItem[];
  /** The renumbered members whose `sortOrder` actually changed — the rows worth syncing. */
  readonly changed: CollectableItem[];
};

/**
 * The `sortOrder` run a reorder should persist for one collection.
 *
 * `byCollectionOrder` renders a duplicate `sortOrder` deterministically, which
 * is damage control rather than prevention — the collided indices stay in
 * storage and the next reorder writes on top of a run that already has holes.
 * This is the other half: the writer lays the collection out as a dense
 * 0..N-1 permutation, so a collision cannot be *authored* on one device at all.
 *
 * The rules:
 *
 *  1. **Every member of the collection is renumbered, not just the named
 *     ones.** Renumbering only `orderedIds` is what leaves the rest holding
 *     their old indices — a partial list (the exact bug
 *     `orderWithUnrenderedTail` exists to avoid at the call site) would collide
 *     the unnamed tail with the freshly-written head.
 *  2. **`orderedIds` decides the head, in the order given.** An id that names
 *     no member of this collection is skipped, and a repeated id counts once,
 *     at its first appearance: an id list is a request, and neither an unknown
 *     nor a duplicate entry should be able to shift the rows around it.
 *  3. **The members `orderedIds` left out follow, in `byCollectionOrder`.**
 *     That is the order they are currently rendered in, so items the caller did
 *     not mention keep their places relative to each other rather than landing
 *     in whatever order the id-keyed cloud merge happened to hand over.
 *  4. **Items in other collections are untouched**, at their existing index in
 *     the array — a reorder in one collection must not perturb another.
 *
 * `changed` holds only the rows whose number actually moved, so a no-op
 * reorder (the drag that ends where it started) syncs nothing; when it is
 * empty the plan returns `items` by reference, the same no-op contract
 * `mergeItemsFromCloud` and the pending-write helpers state, so the caller can
 * skip the `setState` and the AsyncStorage rewrite it would trigger.
 */
export function planItemReorder(
  items: readonly CollectableItem[],
  collectionId: string,
  orderedIds: readonly string[],
): ItemReorderPlan {
  const members = new Map<string, CollectableItem>();
  for (const item of items) {
    if (item.collectionId === collectionId) members.set(item.id, item);
  }
  if (members.size === 0) return { items: items as CollectableItem[], changed: [] };

  const ranked: CollectableItem[] = [];
  const placed = new Set<string>();
  for (const id of orderedIds) {
    const member = members.get(id);
    if (!member || placed.has(id)) continue;
    placed.add(id);
    ranked.push(member);
  }
  const tail = [...members.values()].filter((item) => !placed.has(item.id)).sort(byCollectionOrder);

  const changed: CollectableItem[] = [];
  const renumbered = new Map<string, CollectableItem>();
  [...ranked, ...tail].forEach((item, index) => {
    if (item.sortOrder === index) return;
    const next = { ...item, sortOrder: index };
    renumbered.set(item.id, next);
    changed.push(next);
  });
  if (changed.length === 0) return { items: items as CollectableItem[], changed: [] };

  return { items: items.map((item) => renumbered.get(item.id) ?? item), changed };
}
