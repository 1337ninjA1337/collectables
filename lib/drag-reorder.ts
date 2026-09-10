/**
 * The two decisions a drag-to-reorder gesture makes, with no DOM in either.
 *
 * `components/DraggableList.web.tsx` is the only caller: the native builds get
 * dragging from `react-native-draggable-flatlist`, and the web bundle — the
 * one GitHub Pages serves — gets it from a shim that listens for pointer
 * events itself. The shim's DOM half (which element is under the cursor, which
 * listeners are attached) cannot be exercised by the node test runner; the two
 * functions here are the half that decides what the list ends up looking like,
 * and they are ordinary array and number work.
 *
 * Splitting them out is not only for the tests. "Where does the row land" is
 * the question a reorder bug is always about, and it was previously unaskable
 * without a browser.
 */

/** A row's vertical extent in viewport coordinates, as `getBoundingClientRect` reports it. */
export type RowRect = {
  readonly top: number;
  readonly bottom: number;
};

/**
 * The list with the row at `from` lifted out and dropped in at `to`.
 *
 * Total on purpose — a pointer that leaves the window, a list that changed
 * length mid-drag, and a `to` computed from a stale measurement all reach here
 * as out-of-range numbers, and none of them should throw at the end of a
 * gesture the user has already finished. An unusable `from` returns the order
 * untouched; a `to` past either end clamps to that end, which is what dragging
 * a row above the first or below the last one means.
 *
 * Always a new array, even when nothing moved: the caller hands the result
 * straight to `onDragEnd`, whose consumers (`reorderItemsInCollection`,
 * `reorderOwnedCollections`) map it into an id list, and returning the input
 * would let one of them hold a reference to a caller's array.
 */
export function moveItem<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows];
  if (!Number.isInteger(from) || from < 0 || from >= next.length) return next;
  if (!Number.isInteger(to)) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Which row index a pointer at `pointerY` is over, given the rows' extents.
 *
 * The comparison is against each row's MIDPOINT rather than its box, so the
 * answer changes exactly when the dragged row has travelled far enough to swap
 * with its neighbour — the behaviour every list with drag handles has, and the
 * one that does not require the pointer to be inside any row at all. A pointer
 * in the gap between two rows, or past the end of the list, still resolves.
 *
 * `rects` is in list order and must hold one entry per row. An empty list
 * returns `-1`, which the shim reads as "nothing to drop onto" and abandons the
 * gesture — the case where the rows could not be measured, which is every
 * environment without a layout engine.
 */
export function targetIndexForPointer(rects: readonly RowRect[], pointerY: number): number {
  if (rects.length === 0) return -1;
  if (!Number.isFinite(pointerY)) return -1;
  for (let index = 0; index < rects.length; index += 1) {
    const { top, bottom } = rects[index];
    if (pointerY < (top + bottom) / 2) return index;
  }
  return rects.length - 1;
}
