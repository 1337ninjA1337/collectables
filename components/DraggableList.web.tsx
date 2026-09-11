import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, ScrollView, View } from "react-native";

import { AMBER_ACCENT } from "../lib/design-tokens";
import { moveItem, targetIndexForPointer, type RowRect } from "../lib/drag-reorder";

/**
 * The web spelling of the draggable list, which is the one users actually run.
 *
 * Metro picks between this file and `DraggableList.tsx` by platform, and
 * GitHub Pages serves the web bundle — so on the deployed site this shim IS
 * the list. `react-native-draggable-flatlist` needs gesture-handler and
 * reanimated worklets that the web build does not carry, hence a `FlatList`
 * underneath and the same four exports on top.
 *
 * Dragging is implemented here rather than given up on. A row calls `drag()`
 * from its `onLongPress` (both screens do), and from that moment until the
 * pointer comes back up the document decides: every `pointermove` re-measures
 * the rows and remembers which index the cursor is over, and `pointerup`
 * hands `onDragEnd` the reordered array. The two decisions in that sentence —
 * which index, and what the array becomes — live in `lib/drag-reorder.ts` so
 * they can be tested without a browser.
 *
 * What this is not: it does not animate, and it does not shuffle the rows
 * under the cursor while the gesture is running. The dragged row dims, a line
 * marks the edge it would land on, and the list re-renders once, from the
 * persisted order, after the drop. Everything
 * degrades to the previous behaviour where there is no DOM (`drag()` becomes
 * the no-op it used to be), which is what the node-run suites see.
 */

export type RenderItemParams<T> = {
  item: T;
  drag: () => void;
  isActive: boolean;
  getIndex: () => number | undefined;
};

/** What `onDragEnd` receives — the shape `react-native-draggable-flatlist` sends. */
type DragEndParams<T> = {
  data: T[];
  from: number;
  to: number;
};

/** The part of a DOM element this file uses, so nothing here needs `lib.dom`. */
type Measurable = {
  getBoundingClientRect?: () => { top: number; bottom: number };
};

type PointerLike = { clientY?: number };

/** Dimming rather than lifting: the row stays in place until the drop lands. */
const ACTIVE_ROW = { opacity: 0.6 } as const;

/**
 * The line that says where the row will land.
 *
 * Absolutely positioned so it costs no layout: a border would grow the row by
 * its own width and push everything below it down by two points on every
 * pointer move, which reads as the list twitching. The wrapper it sits in is a
 * `View`, whose position is `relative` by default in both React Native and
 * react-native-web, so `left: 0 / right: 0` is the row's width.
 */
const DROP_MARKER = {
  position: "absolute",
  left: 0,
  right: 0,
  height: 2,
  backgroundColor: AMBER_ACCENT,
  zIndex: 1,
} as const;

/** Above the target row when dragging up, below it when dragging down. */
const DROP_MARKER_ABOVE = { ...DROP_MARKER, top: -1 } as const;
const DROP_MARKER_BELOW = { ...DROP_MARKER, bottom: -1 } as const;

/**
 * Every row's extent, in list order, or nothing at all.
 *
 * All-or-nothing because a partial measurement is worse than none:
 * `targetIndexForPointer` walks the array by index, so a list missing its
 * third row would silently rank the fourth as the third and drop the dragged
 * row one place short. A row is missing whenever its ref has not attached yet
 * — a windowed `FlatList` that has not rendered it, or any environment without
 * a layout engine — and both mean the same thing here: do not guess.
 */
function measureRows(nodes: Map<number, Measurable>, count: number): RowRect[] {
  const rects: RowRect[] = [];
  for (let index = 0; index < count; index += 1) {
    const rect = nodes.get(index)?.getBoundingClientRect?.();
    if (!rect) return [];
    rects.push({ top: rect.top, bottom: rect.bottom });
  }
  return rects;
}

/** The document, when there is one that can carry a drag. */
function draggableDocument(): Document | null {
  if (typeof document === "undefined") return null;
  if (typeof document.addEventListener !== "function") return null;
  if (typeof document.removeEventListener !== "function") return null;
  return document;
}

/**
 * Stops the browser from scrolling the page instead of dragging the row.
 *
 * A long press is a finger held STILL, so at the moment `drag()` runs the
 * browser has not decided anything yet — the first `touchmove` is where it
 * chooses between scrolling and letting the page have the gesture, and a
 * non-passive listener that calls `preventDefault` is how the page wins. Once
 * a scroll has started the choice is made and `pointercancel` ends the drag,
 * which is what happened on every phone before this existed.
 *
 * Registered per gesture rather than as `touch-action: none` on the rows: the
 * list IS the page on both screens that use it, so a permanent `touch-action`
 * would cost the user the ability to scroll past the collection they are
 * looking at.
 */
function suppressTouchScrolling(doc: Document): () => void {
  const block = (event: Event) => {
    if (event.cancelable) event.preventDefault();
  };
  doc.addEventListener("touchmove", block, { passive: false });
  return () => doc.removeEventListener("touchmove", block);
}

/**
 * Stops a mouse drag from selecting the text it passes over.
 *
 * `document.body` is optional here because the node-run suites install a fake
 * document that has none — the guard is the difference between a drag that
 * works and a `TypeError` inside a pointer handler.
 */
function suppressTextSelection(doc: Document): () => void {
  const style = doc.body?.style;
  if (!style) return () => {};
  const previous = style.userSelect;
  style.userSelect = "none";
  return () => {
    style.userSelect = previous;
  };
}

/**
 * Where the dragged row is in the list as it is NOW, or -1 if it has left.
 *
 * By key rather than by reference, for the reason `identify` in
 * `lib/drag-reorder.ts` gives: a cloud merge rebuilds the objects, so the same
 * row comes back as a new object with the same id and `indexOf` would find
 * nothing. Reference identity is the fallback for a list rendered without a
 * `keyExtractor`, which neither screen does and the shim cannot require.
 */
function indexOfDraggedRow<T>(
  rows: readonly T[],
  row: T,
  key: string | undefined,
  keyExtractor?: (item: T, index: number) => string,
): number {
  if (key === undefined || !keyExtractor) return rows.indexOf(row);
  for (let index = 0; index < rows.length; index += 1) {
    if (keyExtractor(rows[index], index) === key) return index;
  }
  return -1;
}

function makeDraggableShim() {
  return function DraggableShim<T>(props: any) {
    const {
      renderItem,
      onDragEnd,
      activationDistance: _activationDistance,
      data,
      keyExtractor,
      ...rest
    } = props as {
      renderItem?: (params: RenderItemParams<T>) => ReactNode;
      onDragEnd?: (params: DragEndParams<T>) => void;
      activationDistance?: number;
      data?: readonly T[];
      // Destructured because the gesture needs it — a row has to be
      // recognisable across a merge that rebuilt it — and handed straight back
      // to the `FlatList`, which needs it for the same reason React does.
      keyExtractor?: (item: T, index: number) => string;
    } & Record<string, unknown>;

    const rows: readonly T[] = Array.isArray(data) ? (data as T[]) : [];
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    /**
     * Where the drop marker is drawn — display only.
     *
     * The gesture's own answer lives in the `to` closure below and is what
     * gets committed. Two holders of one number is a smell, and the
     * alternative is worse: reading the landing index back out of state inside
     * a document handler means reading the value from the render that
     * attached the listener, which is the drag's first frame and never moves.
     */
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    /**
     * The listeners outlive the render that attached them, so everything they
     * read has to come through a ref. `data` in particular: a drag that starts
     * before a cloud merge lands and ends after it must reorder the list as it
     * is at the drop, not as it was at the long press.
     */
    const latest = useRef({ rows, onDragEnd, keyExtractor });
    latest.current = { rows, onDragEnd, keyExtractor };

    /** index → the row's element, written by the ref callback below. */
    const nodes = useRef(new Map<number, Measurable>());
    /** Removes the current gesture's listeners; null when none is running. */
    const detach = useRef<(() => void) | null>(null);

    const beginDrag = useCallback((from: number) => {
      const doc = draggableDocument();
      if (!doc) return;
      // A second long press without an intervening pointerup — possible with a
      // touch that never released — replaces the gesture rather than stacking
      // a second set of listeners on the document.
      detach.current?.();

      const restoreTouch = suppressTouchScrolling(doc);
      const restoreSelection = suppressTextSelection(doc);

      /**
       * WHICH row this gesture is about, captured once, as a row and a key.
       *
       * `from` is an index into the list as it was at the long press, and the
       * drop reads the list as it is at the pointerup — the two are not the
       * same array whenever a cloud merge or a `loadMore` lands in between.
       * Committing `moveItem(current, from, to)` then moves whatever row has
       * since taken that index: the user drags Alpha and Beta moves, silently,
       * with a well-formed whole-list order to persist afterwards. This is the
       * `identify` fix the keyboard route got, arriving at the route that
       * produced the argument for it.
       */
      const draggedRow = latest.current.rows[from];
      const draggedKey = latest.current.keyExtractor?.(draggedRow, from);

      let to = from;
      /**
       * Whether the pointer ever resolved to a row at all.
       *
       * `to === from` used to stand in for this, and it stops being the same
       * question once `from` is re-resolved at the drop: a list that shrank
       * above the dragged row can make a genuine landing index collide with
       * the index the gesture started from, and reading that as "the finger
       * never moved" drops a drag the user made.
       *
       * Set before the `next === to` dedup below rather than after it, because
       * that check asks whether the MARKER needs redrawing — a pointer resting
       * on the index it was already over is still a pointer that resolved.
       */
      let moved = false;
      const onMove = (event: PointerLike) => {
        if (typeof event?.clientY !== "number") return;
        const rects = measureRows(nodes.current, latest.current.rows.length);
        const next = targetIndexForPointer(rects, event.clientY);
        if (next < 0) return;
        moved = true;
        if (next === to) return;
        to = next;
        setDropIndex(next);
      };
      const stop = () => {
        doc.removeEventListener("pointermove", onMove as EventListener);
        doc.removeEventListener("pointerup", onUp as EventListener);
        doc.removeEventListener("pointercancel", onUp as EventListener);
        restoreTouch();
        restoreSelection();
        detach.current = null;
      };
      const onUp = () => {
        stop();
        setActiveIndex(null);
        setDropIndex(null);
        if (!moved) return;
        const { rows: current, onDragEnd: commit, keyExtractor: keyOf } = latest.current;
        const at = indexOfDraggedRow(current, draggedRow, draggedKey, keyOf);
        // The row left the list mid-gesture — deleted on another device, moved
        // to another collection, filtered out. There is no move to commit, and
        // committing one would move whatever is standing where it was.
        if (at === -1) return;
        // Including the drag that moved away and came back: `to` is where the
        // row is going and `at` is where it already is.
        if (to === at) return;
        commit?.({ data: moveItem(current, at, to), from: at, to });
      };

      doc.addEventListener("pointermove", onMove as EventListener);
      doc.addEventListener("pointerup", onUp as EventListener);
      doc.addEventListener("pointercancel", onUp as EventListener);
      detach.current = stop;
      setActiveIndex(from);
    }, []);

    // A screen that navigates away mid-drag leaves the listeners on the
    // document otherwise, and they close over a `rows` nobody is rendering.
    // Unmounting drops the gesture; it does not commit it.
    useEffect(() => () => detach.current?.(), []);

    /**
     * The edge of `index` the dragged row would land on, or nothing.
     *
     * Nothing when the row IS the dragged one, and nothing when the landing
     * index has not moved off it — a marker on the row you are holding says
     * "it will go back where it was", which is true and is not information.
     */
    function dropMarkerStyle(index: number) {
      if (activeIndex === null || dropIndex === null) return null;
      if (index !== dropIndex || dropIndex === activeIndex) return null;
      return dropIndex > activeIndex ? DROP_MARKER_BELOW : DROP_MARKER_ABOVE;
    }

    const adaptedRenderItem = renderItem
      ? ({ item, index }: { item: T; index: number }) => {
          const attachRow = (node: unknown) => {
            if (node) nodes.current.set(index, node as Measurable);
            else nodes.current.delete(index);
          };
          const content = renderItem({
            item,
            drag: () => beginDrag(index),
            isActive: index === activeIndex,
            getIndex: () => index,
          });
          const marker = dropMarkerStyle(index);
          // Two returns rather than one with `{marker && …}` inside: a single
          // child stays the row the screen wrote, which is what the wrapper is
          // supposed to be transparent about when no drag is running.
          if (!marker) {
            return (
              <View ref={attachRow} style={index === activeIndex ? ACTIVE_ROW : undefined}>
                {content}
              </View>
            );
          }
          return (
            <View ref={attachRow} style={index === activeIndex ? ACTIVE_ROW : undefined}>
              <View
                style={marker}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              {content}
            </View>
          );
        }
      : undefined;

    return <FlatList {...rest} data={data} keyExtractor={keyExtractor} renderItem={adaptedRenderItem} />;
  };
}

export const DraggableFlatList = makeDraggableShim();
export const NestableDraggableFlatList = makeDraggableShim();
export const NestableScrollContainer = ScrollView;
export function ScaleDecorator({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
