/**
 * Comparators for the ISO-timestamp sorts the app does everywhere.
 *
 * Fifteen call sites in `lib/` had independently written the same shape:
 *
 *     .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
 *
 * which is wrong for ties. `comparefn(a, b)` and `comparefn(b, a)` must have
 * opposite signs; when `a.createdAt === b.createdAt` this returns `-1` both
 * ways, so the function claims each element sorts after the other. The spec
 * (ECMA-262, `Array.prototype.sort`) makes the result of an inconsistent
 * comparator **implementation-defined** — not "stable", not "unspecified but
 * consistent", just whatever the engine does. V8 happens to preserve input
 * order for the shapes this app produces, which is why nobody saw it; Hermes
 * is a different sort implementation and is what runs on device.
 *
 * The failure it produces is the annoying kind: rows minted in the same
 * millisecond (a bulk import, a seed fixture, a chat burst) shuffling between
 * renders with no state change to blame. Returning `0` for ties makes the
 * comparator consistent, which is also what makes `Array.prototype.sort`'s
 * ES2019 stability guarantee apply — that guarantee says equal elements keep
 * their relative order, and it can only do that if the comparator says they
 * are equal.
 *
 * ISO-8601 strings with a fixed offset order lexicographically, so these
 * compare strings directly rather than parsing to `Date`.
 *
 * Pure and dependency-free so it imports under `tsx --test`.
 */

/** Oldest first. Equal timestamps keep their input order. */
export function compareIsoAsc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Newest first. Equal timestamps keep their input order. */
export function compareIsoDesc(a: string, b: string): number {
  return compareIsoAsc(b, a);
}

/** Oldest first by `createdAt` — the common case, spelled once. */
export function byCreatedAtAsc<T extends { createdAt: string }>(a: T, b: T): number {
  return compareIsoAsc(a.createdAt, b.createdAt);
}

/** Newest first by `createdAt` — the common case, spelled once. */
export function byCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T): number {
  return compareIsoDesc(a.createdAt, b.createdAt);
}

/**
 * Ascending string compare with a real zero for ties.
 *
 * Deliberately NOT locale-aware: this is for sorting opaque keys and ids, where
 * a stable machine ordering is the point. Use `Intl.Collator` (as
 * `lib/item-filters.ts` does for titles) for anything a user reads as text.
 */
export function compareKeysAsc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The second half of the ordering bug the comparators above only half-fixed.
 *
 * Returning `0` for ties made the comparators *consistent*, which is what makes
 * `Array.prototype.sort`'s ES2019 stability guarantee apply. But stability only
 * promises that tied rows keep their **input** order — it says nothing about
 * what that input order was. Every list in this app is rebuilt from a source
 * whose order is itself incidental:
 *
 *  - `buildChatPreviews` iterates `Object.entries(messagesByChat)`, so the
 *    preview order for same-millisecond chats is AsyncStorage rehydration order
 *    on a cold start and append order on a warm one — different orders for
 *    identical data.
 *  - the marketplace surfaces sort listings that arrived through
 *    `mergeCollectionsFromCloud`-style id-keyed `Map` merges, where insertion
 *    order tracks which rows the last delta pull happened to return.
 *
 * So a consistent comparator still lets two devices — or the same device
 * before and after a reload — render the same data in different orders. The
 * cases where that is user-visible rather than cosmetic are the ones that then
 * `.slice(0, limit)`: `selectRecentItems`, `recentlySoldListings` and
 * `priceHistoryForTitle` all cut a top-N, so a tie *at the boundary* decides
 * which row is shown and which is dropped.
 *
 * A tiebreak on the row id makes the order **total**, which is the property
 * that actually pins the result: for a given set of rows there is exactly one
 * correct output, no matter what order they were handed over in.
 */
export function tieBreakById<T>(
  primary: (a: T, b: T) => number,
  getId: (value: T) => string,
): (a: T, b: T) => number {
  return (a, b) => primary(a, b) || compareKeysAsc(getId(a), getId(b));
}

/**
 * Oldest first by `createdAt`, ties broken by `id` — a total order.
 *
 * Prefer this over {@link byCreatedAtAsc} whenever the input array's own order
 * is not itself meaningful. Reach for the plain form only where the incoming
 * order IS the fallback the user expects to see (a drag-ordered list).
 */
export function byCreatedAtAscThenId<T extends { createdAt: string; id: string }>(
  a: T,
  b: T,
): number {
  return compareIsoAsc(a.createdAt, b.createdAt) || compareKeysAsc(a.id, b.id);
}

/** Newest first by `createdAt`, ties broken by `id` — a total order. */
export function byCreatedAtDescThenId<T extends { createdAt: string; id: string }>(
  a: T,
  b: T,
): number {
  return compareIsoDesc(a.createdAt, b.createdAt) || compareKeysAsc(a.id, b.id);
}
