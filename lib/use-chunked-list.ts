import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Windowed slice of an in-memory array. Mounts only the first `pageSize`
 * entries; `loadMore()` grows the window by another `pageSize`, capped at the
 * total length. The goal is bounded memory on iOS — a collection with 500
 * items renders 20 cards (+ their remote images) at first, then grows on
 * demand instead of mounting all 500 up-front.
 *
 * Identity reset: when the *reference* of the `items` array changes (e.g. the
 * caller's filter chain produces a new array), the visible window snaps back
 * to `pageSize`. Without this, a user who scrolled to "show 200 items" then
 * filtered down to 3 matches would still see "show 200" worth of empty slots.
 *
 * **The stable-reference requirement is a CONTRACT, and `lint:chunked-items`
 * is what holds callers to it.** Callers must pass a reference React itself
 * holds stable — a `useMemo` result, an array destructured from a `use*()`
 * hook (a provider memoizes it), or a `useState` value. Anything else resets
 * the window on every render, so `count` never grows and `loadMore()` becomes
 * a button that responds to the press and changes nothing on screen.
 *
 * That sentence was here, in these words, for as long as the hook existed, and
 * four of the five call sites then restated it in their own comments — which is
 * what a contract looks like when nothing enforces it. Nothing could: the types
 * cannot see it (`T[]` is `T[]` however it was built), this hook cannot see it
 * (React hands it an array, not the expression that made one), and a rendering
 * test only catches it if somebody thought to press Load more twice. Nothing
 * throws and nothing logs. `scripts/check-chunked-list-items.ts` reads the
 * first argument of every call in `app/`, `components/` and `lib/` and refuses
 * the ones it cannot prove stable; `lib/check-chunked-list-items.ts` argues
 * which three forms count and why the list is that short.
 *
 * The hook is intentionally render-pure: no effects, no timers, no remote
 * fetch. Pagination over server-paginated data is a separate concern (this
 * codebase stores items in AsyncStorage so the full list is already in RAM —
 * the chunking is for *render* cost, not network cost).
 *
 * **Page size is a property of the ROW, not of the hook.** Every one of the
 * five call sites took the default 20 for as long as the hook existed, across
 * rows that differ by an order of magnitude in what they mount: a collection
 * card with a full-bleed remote cover against an archive row with a 56px
 * thumbnail. One number was doing five jobs, and the export existed to be
 * overridden with nothing overriding it. {@link CHUNK_PAGE_SIZE_CARDS} and
 * {@link CHUNK_PAGE_SIZE_ROWS} are the two shapes the app actually has.
 */
const DEFAULT_PAGE_SIZE = 20;

export const DEFAULT_CHUNK_PAGE_SIZE = DEFAULT_PAGE_SIZE;

/**
 * A page of rows that each mount a REMOTE IMAGE at card size.
 *
 * Collection cards (a 220px-tall cover) and the collection-detail masonry
 * (an item photo per tile). Twenty of these is twenty network images decoded
 * before the user has scrolled anywhere, which is the cost this hook exists
 * to bound and the one the shared default was never chosen against.
 *
 * **Why these numbers rather than measurements.** Nobody has profiled the
 * mount cost of either row on a real device, and the honest thing to say is
 * that 12 and 40 are argued from what the rows CONTAIN — a full-bleed remote
 * cover against a 56px thumbnail and two lines of text — not from a
 * stopwatch. The point of splitting is that one number could not be right for
 * both; getting each one exactly right is a separate job with a profiler in
 * it, and this is the shape that makes that job possible.
 */
export const CHUNK_PAGE_SIZE_CARDS = 12;

/**
 * A page of COMPACT rows: a small thumbnail, a title, a line of meta.
 *
 * The wishlist and the archive. These are cheap enough that a twenty-row page
 * makes the user press Load more for no reason on a list of thirty — and the
 * archive's rows are the cheapest in the app, on the list most likely to have
 * a long tail nobody prunes.
 */
export const CHUNK_PAGE_SIZE_ROWS = 40;

export type ChunkedList<T> = {
  visibleItems: T[];
  hasMore: boolean;
  /**
   * Rows the window is not currently mounting.
   *
   * The three screens with a window each computed `total - visibleItems.length`
   * at their call site to label the Load-more button, and each of them got
   * `total` from a different expression — one of which was a ternary picking
   * between two lists. The hook already knows both numbers, so the subtraction
   * belongs here; `hasMore` is `remaining > 0`, stated once rather than
   * asked separately beside it.
   */
  remaining: number;
  loadMore: () => void;
  reset: () => void;
};

export function useChunkedList<T>(
  items: T[],
  pageSize: number = DEFAULT_PAGE_SIZE,
): ChunkedList<T> {
  const safePageSize = resolvePageSize(pageSize);
  const [count, setCount] = useState<number>(() => safePageSize);

  useEffect(() => {
    setCount(safePageSize);
  }, [items, safePageSize]);

  const visibleItems = useMemo(
    () => items.slice(0, clampCount(count, safePageSize, items.length)),
    [items, count, safePageSize],
  );

  const remaining = items.length - visibleItems.length;
  const hasMore = remaining > 0;

  // Both callbacks are referentially stable while the `items` identity is
  // unchanged, so callers can safely list them in `useMemo`/`useCallback`
  // dep arrays (e.g. a memoized Load-more CTA) without the memo re-firing
  // on every parent render. An `items` swap already resets the window via
  // the effect above, so the new closure it produces is never stale.
  const loadMore = useCallback(() => {
    setCount((current) => clampCount(current + safePageSize, safePageSize, items.length));
  }, [items, safePageSize]);

  const reset = useCallback(() => {
    setCount(safePageSize);
  }, [safePageSize]);

  return { visibleItems, hasMore, remaining, loadMore, reset };
}

/**
 * Pure helper exposed for testing — clamps the requested visible count into
 * the valid `[0, total]` range and never falls below one page. A non-finite
 * or non-positive `current` falls back to `pageSize`; `current > total` is
 * pinned to `total` so the slice can't overshoot.
 */
export function clampCount(current: number, pageSize: number, total: number): number {
  const safePage = resolvePageSize(pageSize);
  const safeTotal = Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0;
  if (Number.isNaN(current) || current <= 0) {
    return Math.min(safePage, safeTotal);
  }
  return Math.min(Math.floor(current), safeTotal);
}

/**
 * Pure helper — clamps `pageSize` to a positive finite integer. A caller
 * passing `0`, `NaN`, `Infinity`, or a negative value falls back to the
 * default page so the window can't stall or render an empty slice forever.
 */
export function resolvePageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return DEFAULT_PAGE_SIZE;
  return Math.floor(pageSize);
}
