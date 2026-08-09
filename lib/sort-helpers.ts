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
