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
 * In the trash: sold, or manually retired.
 *
 * Per the `archivedAt` contract in `lib/types.ts` an archived item stays in
 * storage for stats and audit history and is excluded from listings, totals,
 * counts, recent items and search. The field is nullable and legacy rows carry
 * `null` rather than being absent, so the question is truthiness of a
 * timestamp and not `"archivedAt" in item`.
 *
 * The one fact the two predicates below share, named so that they can be read
 * as "and not in the trash" rather than each spelling out what the trash is.
 */
export function isArchived(item: CollectableItem): boolean {
  return Boolean(item.archivedAt);
}

/**
 * A thing the collector HAS: not in the trash, not a wishlist entry.
 *
 * Four places stated this rule and no two stated it the same way — a
 * three-clause filter here, a `continue` guard built out of its De Morgan
 * negation forty lines down, and two early returns in the search overlay.
 * They agreed, and checking that they agreed meant negating one of them in
 * your head. It is one function now, so the next reader checks a name.
 *
 * The wishlist exclusion is the load-bearing half: a wishlist entry is
 * something the user does NOT own yet, so counting one inflates a total and
 * reads as an acquisition that never happened. {@link isLiveWishlistItem} is
 * the other side of the same split.
 */
export function isLiveItem(item: CollectableItem): boolean {
  return !isArchived(item) && !item.isWishlist;
}

/**
 * A thing the collector WANTS: not in the trash, on the wishlist.
 *
 * The mirror of {@link isLiveItem}, and the reason both are here rather than
 * one: the wishlist memo in the collections provider asked only
 * `item.isWishlist`, so an archived wishlist entry was in the trash on every
 * screen in the app except the one it was added on. Written as a pair, "and
 * not archived" is the half neither can quietly drop.
 */
export function isLiveWishlistItem(item: CollectableItem): boolean {
  return !isArchived(item) && Boolean(item.isWishlist);
}

/**
 * The user's own, currently-held items: owned collection, not a wishlist
 * entry, not archived.
 *
 * This is the "what do I have" predicate that the home rail, the stats screen
 * and search all need, and each exclusion is load-bearing:
 *
 *   - **wishlist items** and **archived items** are {@link isLiveItem}'s
 *     business, and the two exclusions are explained there.
 *   - **items in non-owned collections** belong to somebody else; without the
 *     ownership gate their items are counted as the user's own. That is this
 *     function's own clause and the reason it takes `collections`.
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
    (item) => isLiveItem(item) && ownedIds.has(item.collectionId),
  );
}

/**
 * Every collection's live items, in one pass over the merged item list.
 *
 * Three context accessors asked the same question by re-walking the whole
 * array: `getItemsForCollection` filtered it, `getCollectionTotalCost`
 * filtered it again with the identical predicate, and a screen that wanted a
 * COUNT got it by taking `.length` of the first one's sorted result. The home
 * screen renders a `<CollectionCard>` per collection and each card asks for
 * both, so twenty cards cost forty full passes over every item the viewer can
 * see — their own, their friends', their subscriptions' and their shares' —
 * plus twenty sorts of lists nobody ordered anything by, because the caller
 * wanted a number.
 *
 * The predicate is the one all three shared, and it is {@link isLiveItem}:
 * stated once, so the three accessors cannot drift on what counts — which is
 * the failure mode worth more than the passes, since a count that includes
 * archived items above a total cost that excludes them is two numbers on one
 * card disagreeing about the same collection.
 *
 * Order is whatever `items` was in; a caller that needs the drag order sorts
 * its own copy through {@link byCollectionOrder}. Entries are the map's, so
 * a caller must not sort them in place — `getItemsForCollection` copies.
 *
 * A collection with nothing in it is ABSENT from the map rather than present
 * with an empty array: `get` answering `undefined` and `?? []` at the call
 * site is the same answer, and building an entry per collection would mean
 * passing the collection list in to learn nothing.
 */
/**
 * The item a mutation is about to change, read BEFORE the state write.
 *
 * Five mutations on the collections provider used to learn what they had
 * changed by assigning to a `let` from inside a `setLocalItems` updater and
 * reading it on the next line. React does not promise to run an updater
 * synchronously: `useState`'s dispatch computes the next state eagerly only
 * when the hook has no work already queued, so the pattern holds right up to
 * the moment something else has queued an update on the same hook — a landing
 * realtime row, a second archive on a fast double-tap, a sync flush — and then
 * the variable is still `null`, the `if` is skipped, and the cloud write never
 * happens. The local state changes and the remote row does not, so the next
 * sync hands the old value straight back: an edit that silently reverts, and
 * only under load.
 *
 * `deleteCollection` in that same file had always read `localItems` directly.
 * This is that shape, named, so the five can say what they are doing in one
 * word — and so the next mutation reaches for the reliable read first.
 */
export function resolveLocalItem(
  items: readonly CollectableItem[],
  itemId: string,
): CollectableItem | undefined {
  return items.find((item) => item.id === itemId);
}

export function groupItemsByCollection(
  items: readonly CollectableItem[],
): Map<string, CollectableItem[]> {
  const byCollection = new Map<string, CollectableItem[]>();
  for (const item of items) {
    if (!isLiveItem(item)) continue;
    const existing = byCollection.get(item.collectionId);
    if (existing) existing.push(item);
    else byCollection.set(item.collectionId, [item]);
  }
  return byCollection;
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

/**
 * The home screen's owned-collection ordering: the user's manual drag order
 * first, then the collections they never dragged, in the order they came in.
 *
 * `reorderOwnedCollections` has always written `sortOrder` — to the cloud
 * column and to the local row — while the home list rendered the ARRAY it also
 * reordered. So the number was written, synced, and never read: a second
 * device pulls the rows, `mergeCollectionsFromCloud` rebuilds the array by id,
 * and the manual order is gone even though it is sitting in `sort_order` the
 * whole time.
 *
 * Two of the three rules `byCollectionOrder` states, for the same reasons: a
 * dragged collection outranks an undragged one, and two dragged ones sort by
 * `sortOrder` with `id` breaking a cross-device tie.
 *
 * The third is deliberately missing. `Collection` carries no `createdAt`, so
 * there is nothing to rank two undragged collections BY — this returns 0 for
 * that pair and leans on `Array.prototype.sort` being stable (specified since
 * ES2019), which keeps them in the order the caller already had. That order is
 * newest-first, because `addCollection` prepends; it is a local fact rather
 * than a total one, and it is the best available until the row gains a
 * timestamp.
 */
export function byOwnedCollectionOrder(a: Collection, b: Collection): number {
  const aHas = typeof a.sortOrder === "number";
  const bHas = typeof b.sortOrder === "number";
  if (aHas && bHas) {
    return (a.sortOrder as number) - (b.sortOrder as number) || compareKeysAsc(a.id, b.id);
  }
  if (aHas) return -1;
  if (bHas) return 1;
  return 0;
}

/** What a collection reorder would write: the new array, and only the rows that moved. */
export type CollectionReorderPlan = {
  /** Every collection, the owned ones renumbered in place. `collections` by reference when nothing moved. */
  readonly collections: Collection[];
  /** The renumbered owned collections whose `sortOrder` actually changed. */
  readonly changed: Collection[];
};

/**
 * The `sortOrder` run a home-screen reorder should persist.
 *
 * `planItemReorder`'s rules, over the collections the user owns: every owned
 * collection is renumbered (not just the named ones, or the unnamed tail keeps
 * indices that collide with the fresh head), `orderedIds` decides the head with
 * unknown and repeated ids skipped, and the rest follow in
 * `byOwnedCollectionOrder`. Collections the user does not own carry no manual
 * order — they are somebody else's rows — and are left untouched at their place
 * in the array.
 */
export function planCollectionReorder(
  collections: readonly Collection[],
  orderedIds: readonly string[],
): CollectionReorderPlan {
  const owned = new Map<string, Collection>();
  for (const collection of collections) {
    if (collection.role === "owner") owned.set(collection.id, collection);
  }
  if (owned.size === 0) return { collections: collections as Collection[], changed: [] };

  const ranked: Collection[] = [];
  const placed = new Set<string>();
  for (const id of orderedIds) {
    const collection = owned.get(id);
    if (!collection || placed.has(id)) continue;
    placed.add(id);
    ranked.push(collection);
  }
  const tail = [...owned.values()].filter((c) => !placed.has(c.id)).sort(byOwnedCollectionOrder);

  const changed: Collection[] = [];
  const renumbered = new Map<string, Collection>();
  [...ranked, ...tail].forEach((collection, index) => {
    if (collection.sortOrder === index) return;
    const next = { ...collection, sortOrder: index };
    renumbered.set(collection.id, next);
    changed.push(next);
  });
  if (changed.length === 0) return { collections: collections as Collection[], changed: [] };

  return { collections: collections.map((c) => renumbered.get(c.id) ?? c), changed };
}

/**
 * The `sortOrder` a collection created right now should carry, or nothing.
 *
 * Nothing while the user has never dragged: an undragged list is rendered in
 * array order and `addCollection` prepends, so the new collection is already on
 * top and stamping it would only invent a manual order the user never asked
 * for.
 *
 * Once ANY owned collection carries a number, though, rule 1 says every dragged
 * collection outranks every undragged one — so an unstamped newcomer would land
 * at the BOTTOM of the home screen, which is the one place a user does not look
 * for the collection they just made. One below the lowest index puts it back on
 * top for the price of a single row write; the run stops being dense until the
 * next reorder, which is exactly what `planCollectionReorder` renumbers.
 */
export function nextCollectionSortOrder(
  collections: readonly Collection[],
): number | undefined {
  let lowest: number | undefined;
  for (const collection of collections) {
    if (collection.role !== "owner") continue;
    if (typeof collection.sortOrder !== "number") continue;
    if (lowest === undefined || collection.sortOrder < lowest) lowest = collection.sortOrder;
  }
  return lowest === undefined ? undefined : lowest - 1;
}
