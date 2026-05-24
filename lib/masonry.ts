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
  const safeCount = resolveColumnCount(columnCount);
  const columns: T[][] = Array.from({ length: safeCount }, () => []);
  for (let i = 0; i < items.length; i++) {
    columns[i % safeCount].push(items[i]);
  }
  return columns;
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
