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
 * The id order to persist after reordering a PAGE of a longer list.
 *
 * `app/collection/[id].tsx` renders a chunked slice of its items, and both
 * routes into `reorderItemsInCollection` — the drag and the keyboard actions —
 * hand it a whole-collection id list. Sending only the visible slice would
 * re-`sortOrder` it to 0..N-1 and leave every item below the page boundary to
 * be renumbered against it, shuffling rows the user never saw and cannot see.
 *
 * So the unrendered remainder is appended in the order it already had. That is
 * the rule, and it is here rather than inside an `onDragEnd` literal because
 * two callers now depend on it and a third would otherwise write it a third
 * time — the failure it prevents is invisible on screen, which is exactly the
 * kind that survives being re-derived slightly differently.
 *
 * `page` is not required to be a subset of `all`: an id in both appears once,
 * from the page, and `all` contributes only what the page left out.
 */
export function orderWithUnrenderedTail<T extends { id: string }>(
  page: readonly T[],
  all: readonly T[],
): string[] {
  const shown = new Set(page.map((row) => row.id));
  return [...page.map((row) => row.id), ...all.filter((row) => !shown.has(row.id)).map((row) => row.id)];
}

/**
 * A row's place in its list as a screen reader should hear it, or nothing.
 *
 * Reordering is announced twice — at the pick-up and at the landing — and both
 * announcements are the same sentence with different numbers. `position` is
 * 1-based because "position 0 of 7" is not a thing anybody says.
 *
 * Nothing rather than a fallback when the numbers cannot be trusted: an index
 * that is `undefined` (a windowed row not yet placed), out of range, or
 * fractional, or an empty list. A wrong position read aloud is worse than
 * silence, because the user cannot see the list to check it — and every one of
 * these is reachable, which is why this returns null instead of clamping.
 */
export function announcedPosition(
  index: number | undefined,
  total: number,
): { position: number; total: number } | null {
  if (!Number.isInteger(index as number)) return null;
  if (!Number.isInteger(total) || total <= 0) return null;
  const at = index as number;
  if (at < 0 || at >= total) return null;
  return { position: at + 1, total };
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
