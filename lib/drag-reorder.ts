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
 * The key every list in this app is ordered and reconciled by.
 *
 * `Collection` and `CollectableItem` both carry `id`, both `keyExtractor`s
 * read it, and every `identify` in the two screens spelled it again as its own
 * arrow. Four copies of the same function is four chances for one of them to
 * be written as something that is not stable — an index, a title, a composite
 * — and the failure that produces (a drag committing against a row it matched
 * by name) is invisible until two rows share the value.
 */
export function byId(row: { readonly id: string }): string {
  return row.id;
}

/** Where a finished drag actually lands, once the list is read again. */
export type DragEndPlan<T> = {
  /** The whole of the CURRENT list, with the dragged row moved into place. */
  readonly rows: T[];
  /** The row's 0-based index in `rows` — the position to announce. */
  readonly to: number;
};

/**
 * What a finished drag means, expressed against the list as it is NOW.
 *
 * `onDragEnd` hands back `data`: the list's own reordered copy of what it
 * DREW. Between the frame the gesture started on and the finger coming up, a
 * cloud merge or a `loadMore` can land — and committing `data` then persists a
 * snapshot taken before it, silently reverting rows the user never touched and
 * dropping ones that arrived mid-gesture. The keyboard route stopped trusting
 * the render's answer when `identify` was added; this is the same fix for the
 * route that produced the argument in the first place.
 *
 * ## The drop is read as "after this row", not as an index
 *
 * `to` is an index into `data`, and an index into a list that has changed
 * means nothing — row 3 of the old list may be row 5 or may be gone. What the
 * user expressed is a position RELATIVE TO THE ROWS THEY COULD SEE, so the
 * nearest predecessor in `data` that still exists is the anchor, and the row
 * lands immediately after it. A drop at the top has no predecessor and lands
 * at the top.
 *
 * When nothing changed underneath — every ordinary drag — this reproduces
 * `data` exactly: the two lists hold the same rows, so "after the same
 * neighbour" is the same place. The rule only starts deciding anything when
 * the snapshot and the list have actually diverged.
 *
 * Null for a drag there is nothing to commit for: a `to` that is not a
 * position in `data`, a dragged row that has left the list (committing it
 * would resurrect a row somebody else deleted), or a drop that resolves to
 * where the row already is — which is not a move, and announcing one as
 * "moved to position 3 of 7" is indistinguishable from a move that did
 * nothing.
 */
export function planDragCommit<T>(params: {
  /** The reordered snapshot `onDragEnd` handed back. */
  readonly data: readonly T[];
  /** The index within `data` the row was dropped on. */
  readonly to: number;
  /** The list as it is now — a ref the render writes, not the render's array. */
  readonly rows: readonly T[];
  /** How a row is recognised across a merge that rebuilt the objects. */
  readonly keyOf: (row: T) => string;
}): DragEndPlan<T> | null {
  const { data, to, rows, keyOf } = params;
  if (!Number.isInteger(to) || to < 0 || to >= data.length) return null;

  const movedKey = keyOf(data[to]);
  const from = rows.findIndex((row) => keyOf(row) === movedKey);
  if (from === -1) return null;

  // Indices are read against the list WITHOUT the dragged row, because that is
  // the list `moveItem` splices into: it lifts the row out first, so a target
  // computed against the full array would be one place late for every drop
  // below the row's old position.
  const remaining = rows.filter((_, index) => index !== from);
  let target = 0;
  for (let above = to - 1; above >= 0; above -= 1) {
    const key = keyOf(data[above]);
    if (key === movedKey) continue;
    const anchor = remaining.findIndex((row) => keyOf(row) === key);
    if (anchor !== -1) {
      target = anchor + 1;
      break;
    }
  }

  if (target === from) return null;
  return { rows: moveItem(rows, from, target), to: target };
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
