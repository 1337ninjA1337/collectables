/**
 * Round-robin distribution of items across N columns — column 0 receives
 * indices 0, N, 2N…; column 1 receives 1, N+1, 2N+1…; and so on. Mirrors
 * the inline `.filter((_, i) => i % 2 === N)` pair that the collection-detail
 * masonry rendered before this helper existed, and generalises it so a
 * 3- or 4-column layout doesn't need to re-implement the same modulo math.
 *
 * The helper is intentionally pure (no React, no RN imports) so it can be
 * unit-tested under `node --test` without mocking — the same shape as
 * `lib/item-filters.ts` and `lib/use-chunked-list.ts`'s pure helpers.
 *
 * A non-positive / non-finite / fractional `columnCount` falls back to 1
 * (single-column passthrough) so the caller can never crash from a bad
 * config value — the worst case is "all items in one column" which still
 * renders something useful.
 *
 * The input array is not mutated.
 */
export function distributeIntoMasonryColumns<T>(items: T[], columnCount: number = 2): T[][] {
  const columns = allocateColumns<T>(columnCount);
  for (let i = 0; i < items.length; i++) {
    columns[i % columns.length].push(items[i]);
  }
  return columns;
}

/**
 * Balanced-height variant: instead of index modulo, each item lands in the
 * currently-shortest column (greedy bin-packing), so a card that renders
 * taller than its siblings — price tag, condition pill, odd aspect ratio —
 * doesn't drag its column visually below the others and break the
 * staggered-flow illusion.
 *
 * Contract mirrors `distributeIntoMasonryColumns`: pure, input not mutated,
 * item references preserved, bad `columnCount` falls back to 1 column.
 * Ties go to the lowest-index column, which makes the distribution stable
 * AND means uniform heights reproduce the round-robin layout exactly — a
 * caller can switch between the two helpers without a visual jump while
 * all cards are still fixed-height.
 *
 * A `getHeight` result that is non-finite or negative counts as 0 (the
 * item still renders *somewhere*; a NaN must not poison every subsequent
 * shortest-column comparison).
 */
export function distributeByHeight<T>(
  items: T[],
  columnCount: number,
  getHeight: (item: T) => number,
): T[][] {
  const columns = allocateColumns<T>(columnCount);
  const heights = columns.map(() => 0);
  for (const item of items) {
    let target = 0;
    for (let c = 1; c < heights.length; c++) {
      if (heights[c] < heights[target]) target = c;
    }
    columns[target].push(item);
    const h = getHeight(item);
    heights[target] += Number.isFinite(h) && h > 0 ? h : 0;
  }
  return columns;
}

/**
 * Shared column allocation for every column-aware helper in this module —
 * one place to harden (e.g. `Object.freeze` the outer array) if column
 * mutation ever becomes a contract risk. Always returns at least one
 * column (see `resolveColumnCount`).
 */
export function allocateColumns<T>(columnCount: number): T[][] {
  const safeCount = resolveColumnCount(columnCount);
  return Array.from({ length: safeCount }, () => []);
}

/**
 * Pure helper exposed for testing — clamps a requested column count to a
 * positive finite integer. `0`, `NaN`, `Infinity`, negative and fractional
 * values all fall back to `1` so the distribution always produces at least
 * one column and the row indexing math (`i % safeCount`) never divides by
 * zero or by NaN.
 */
export function resolveColumnCount(columnCount: number): number {
  if (!Number.isFinite(columnCount) || columnCount < 1) return 1;
  return Math.floor(columnCount);
}
