import { useMemo } from "react";

import { distributeIntoMasonryColumns } from "./masonry";

/**
 * Memoized wrapper around `distributeIntoMasonryColumns`, mirroring
 * `useChunkedList`'s API shape so every manual-column masonry consumer
 * shares one `useMemo` instead of re-rolling
 * `useMemo(() => distributeIntoMasonryColumns(items, 2), [items])` per
 * screen.
 *
 * The dep array is exactly `[items, columnCount]` BY CONTRACT (the VM-B
 * concern): callers must pass the already-narrowed visible window (e.g.
 * `useChunkedList`'s `visibleItems`), never a wider source array — adding
 * a wider array to the deps would re-allocate the columns on renders where
 * the visible slice didn't change, defeating the memoization.
 *
 * NOTE the collection-detail viewer does NOT use this hook: its grid is a
 * `FlatList numColumns={masonryColumnCount}` (row-locked, virtualized),
 * which owns column distribution natively. This hook is for future
 * manual-column layouts — e.g. a balanced-height masonry via
 * `distributeByHeight`, which FlatList's row-locked grid cannot express —
 * where virtualization is deliberately traded away.
 */
export function useMasonryColumns<T>(items: T[], columnCount: number = 2): T[][] {
  return useMemo(() => distributeIntoMasonryColumns(items, columnCount), [items, columnCount]);
}
