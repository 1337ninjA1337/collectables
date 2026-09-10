import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, ScrollView, View } from "react-native";

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
 * under the cursor while the gesture is running. The dragged row dims and the
 * list re-renders once, from the persisted order, after the drop. Everything
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

function makeDraggableShim() {
  return function DraggableShim<T>(props: any) {
    const {
      renderItem,
      onDragEnd,
      activationDistance: _activationDistance,
      data,
      ...rest
    } = props as {
      renderItem?: (params: RenderItemParams<T>) => ReactNode;
      onDragEnd?: (params: DragEndParams<T>) => void;
      activationDistance?: number;
      data?: readonly T[];
    } & Record<string, unknown>;

    const rows: readonly T[] = Array.isArray(data) ? (data as T[]) : [];
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    /**
     * The listeners outlive the render that attached them, so everything they
     * read has to come through a ref. `data` in particular: a drag that starts
     * before a cloud merge lands and ends after it must reorder the list as it
     * is at the drop, not as it was at the long press.
     */
    const latest = useRef({ rows, onDragEnd });
    latest.current = { rows, onDragEnd };

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

      let to = from;
      const onMove = (event: PointerLike) => {
        if (typeof event?.clientY !== "number") return;
        const rects = measureRows(nodes.current, latest.current.rows.length);
        const next = targetIndexForPointer(rects, event.clientY);
        if (next >= 0) to = next;
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
        if (to === from) return;
        const { rows: current, onDragEnd: commit } = latest.current;
        commit?.({ data: moveItem(current, from, to), from, to });
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

    const adaptedRenderItem = renderItem
      ? ({ item, index }: { item: T; index: number }) => (
          <View
            ref={(node: unknown) => {
              if (node) nodes.current.set(index, node as Measurable);
              else nodes.current.delete(index);
            }}
            style={index === activeIndex ? ACTIVE_ROW : undefined}
          >
            {renderItem({
              item,
              drag: () => beginDrag(index),
              isActive: index === activeIndex,
              getIndex: () => index,
            })}
          </View>
        )
      : undefined;

    return <FlatList {...rest} data={data} renderItem={adaptedRenderItem} />;
  };
}

export const DraggableFlatList = makeDraggableShim();
export const NestableDraggableFlatList = makeDraggableShim();
export const NestableScrollContainer = ScrollView;
export function ScaleDecorator({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
