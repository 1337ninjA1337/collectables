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
 * Callers MUST therefore pass a stable reference when the underlying list
 * doesn't change (i.e. memoize their `.filter()` outputs with `useMemo`) —
 * otherwise the window resets on every render and `loadMore` becomes a no-op.
 *
 * The hook is intentionally render-pure: no effects, no timers, no remote
 * fetch. Pagination over server-paginated data is a separate concern (this
 * codebase stores items in AsyncStorage so the full list is already in RAM —
 * the chunking is for *render* cost, not network cost).
 */
const DEFAULT_PAGE_SIZE = 20;

export const DEFAULT_CHUNK_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export type ChunkedList<T> = {
  visibleItems: T[];
  hasMore: boolean;
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

  const hasMore = items.length > visibleItems.length;

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

  return { visibleItems, hasMore, loadMore, reset };
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
