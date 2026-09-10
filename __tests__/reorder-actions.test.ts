/**
 * `lib/reorder-actions.ts` — the keyboard reorder, as behaviour a node suite
 * can run.
 *
 * Both screens carried the same twelve lines and both were pinned by REGEX, in
 * two suites, because `app/index.tsx` and `app/collection/[id].tsx` pull
 * expo-router and react-native and cannot be imported here. So "move up is not
 * offered on the first row" was a fact about source text in two files, and
 * "the action moved the row where it said it would" was asserted nowhere at
 * all — the screens' suites could only check that the arithmetic was SPELLED
 * correctly.
 *
 * The extraction is what makes these runnable. What the screen suites still
 * pin is the wiring: which array, which writer, which translations.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REORDER_ACTIONS,
  REORDER_ROW_ROLE,
  availableReorderActions,
  reorderActionProps,
  type ReorderActionName,
} from "@/lib/reorder-actions";
import type { ReorderAnnouncement } from "@/lib/reorder-announcement";

const ROWS = ["a", "b", "c", "d"] as const;

/** A label function that shows its key, so a case can assert both halves. */
const label = (key: ReorderActionName) => `label:${key}`;

/** Fires one action and reports what the row committed and announced. */
type Announced = [ReorderAnnouncement, number | undefined, number];

function perform(
  actionName: string,
  options: { index: number | undefined; rows?: readonly string[]; enabled?: boolean },
): { committed: string[] | null; announced: Announced | null } {
  let committed: string[] | null = null;
  let announced: Announced | null = null;
  const props = reorderActionProps({
    rows: options.rows ?? ROWS,
    index: options.index,
    enabled: options.enabled,
    label,
    commit: (next) => {
      committed = next;
    },
    announce: (key, at, total) => {
      announced = [key, at, total];
    },
  });
  props.onAccessibilityAction({ nativeEvent: { actionName } });
  return { committed, announced };
}

describe("availableReorderActions — only the move that would do something", () => {
  it("offers both in the middle of the list", () => {
    assert.deepEqual(availableReorderActions(ROWS, 1), ["moveUp", "moveDown"]);
    assert.deepEqual(availableReorderActions(ROWS, 2), ["moveUp", "moveDown"]);
  });

  it("offers no move up on the first row", () => {
    // `moveItem` clamps, so the call would be a silent no-op — and an action a
    // screen reader announces as available and that then changes nothing is
    // worse than one it never mentions, because the listener cannot glance at
    // the list to check.
    assert.deepEqual(availableReorderActions(ROWS, 0), ["moveDown"]);
  });

  it("offers no move down on the last row", () => {
    assert.deepEqual(availableReorderActions(ROWS, ROWS.length - 1), ["moveUp"]);
  });

  it("offers nothing on the only row of a one-row list", () => {
    assert.deepEqual(availableReorderActions(["only"], 0), []);
  });

  it("offers nothing when the row has no index", () => {
    // `getIndex()` returns undefined for a windowed row the list has not
    // placed yet, and `undefined + 1` reaches moveItem as NaN.
    assert.deepEqual(availableReorderActions(ROWS, undefined), []);
  });

  it("offers nothing when reordering is disabled for a reason of its own", () => {
    // `app/collection/[id].tsx` passes `isDragBranch`: under a non-default
    // sort the visible order is not the manual one, so committing it from a
    // keyboard corrupts exactly what dragging is blocked from corrupting.
    assert.deepEqual(availableReorderActions(ROWS, 1, false), []);
  });

  it("offers nothing for an index outside the list", () => {
    // Reachable from a stale render: the row was drawn, the list shrank, the
    // action fired.
    assert.deepEqual(availableReorderActions(ROWS, 9), []);
    assert.deepEqual(availableReorderActions([], 0), []);
  });
});

describe("reorderActionProps — the props a row spreads", () => {
  const propsFor = (index: number | undefined, enabled?: boolean) =>
    reorderActionProps({
      rows: ROWS,
      index,
      enabled,
      label,
      commit: () => {},
      announce: () => {},
      drag: () => {},
    });

  it("names each action and labels it through the caller's translations", () => {
    assert.deepEqual(propsFor(1).accessibilityActions, [
      { name: "moveUp", label: "label:moveUp" },
      { name: "moveDown", label: "label:moveDown" },
    ]);
  });

  it("hands back an empty list rather than an absent prop", () => {
    // A row with no moves still spreads both props; `accessibilityActions: []`
    // is what tells the platform there is nothing to offer.
    const props = propsFor(undefined);
    assert.deepEqual(props.accessibilityActions, []);
    assert.equal(typeof props.onAccessibilityAction, "function");
  });

  it("covers every declared action name", () => {
    // The table and the props cannot drift: a third action added to
    // REORDER_ACTIONS without a delta would not compile, and one added with a
    // delta shows up here.
    assert.deepEqual(
      propsFor(1).accessibilityActions.map((action) => action.name),
      [...REORDER_ACTIONS],
    );
  });
});

describe("reorderActionProps — what an action does", () => {
  it("moves the row one place up and says where it landed", () => {
    const { committed, announced } = perform("moveUp", { index: 2 });
    assert.deepEqual(committed, ["a", "c", "b", "d"]);
    assert.deepEqual(announced, ["reorderMoved", 1, 4]);
  });

  it("moves the row one place down and says where it landed", () => {
    const { committed, announced } = perform("moveDown", { index: 1 });
    assert.deepEqual(committed, ["a", "c", "b", "d"]);
    assert.deepEqual(announced, ["reorderMoved", 2, 4]);
  });

  it("puts the row back when the two moves are undone", () => {
    // The property a keyboard user checks by accident: down, then up.
    const down = perform("moveDown", { index: 1 }).committed;
    assert.ok(down);
    assert.deepEqual(perform("moveUp", { index: 2, rows: down }).committed, [...ROWS]);
  });

  it("commits the WHOLE list, not the pair that swapped", () => {
    // Both writers renumber from the list they are handed, so a two-element
    // commit would drop every row the user did not touch.
    const { committed } = perform("moveDown", { index: 0 });
    assert.equal(committed?.length, ROWS.length);
  });

  it("announces the position the move resolved to, not a re-derivation", () => {
    // The announced index is the one `moveItem` was given, so the spoken
    // position and the visible one cannot drift.
    assert.deepEqual(perform("moveDown", { index: 0 }).announced, ["reorderMoved", 1, 4]);
    assert.deepEqual(perform("moveUp", { index: 3 }).announced, ["reorderMoved", 2, 4]);
  });

  it("does nothing for an action this row does not offer", () => {
    // The end rows: the platform can remember an action after the row stopped
    // offering it, and a commit here would be a write that changes nothing
    // followed by an announcement that says it did.
    assert.deepEqual(perform("moveUp", { index: 0 }), { committed: null, announced: null });
    assert.deepEqual(perform("moveDown", { index: ROWS.length - 1 }), {
      committed: null,
      announced: null,
    });
  });

  it("does nothing when the row has no index", () => {
    assert.deepEqual(perform("moveDown", { index: undefined }), {
      committed: null,
      announced: null,
    });
  });

  it("does nothing when reordering is disabled", () => {
    assert.deepEqual(perform("moveUp", { index: 2, enabled: false }), {
      committed: null,
      announced: null,
    });
  });

  it("ignores an action name that is not one of its own", () => {
    // The row carries other accessibility actions in principle; answering
    // "activate" with a move would be a reorder the user never asked for.
    assert.deepEqual(perform("activate", { index: 1 }), { committed: null, announced: null });
    assert.deepEqual(perform("", { index: 1 }), { committed: null, announced: null });
  });

  it("does not hand a caller's own array to the writer", () => {
    // `moveItem` always returns a new array; a writer that held a reference to
    // `rows` would be holding the screen's state.
    const rows = ["a", "b", "c"];
    const { committed } = perform("moveDown", { index: 0, rows });
    assert.notEqual(committed, rows);
    assert.deepEqual(rows, ["a", "b", "c"]);
  });
});

describe("reorderActionProps — the pointer route", () => {
  /** Builds the props with recording callbacks, and reports what happened. */
  function withLongPress(options: { index: number | undefined; drag?: (() => void) | undefined }) {
    const order: string[] = [];
    let announced: Announced | null = null;
    const props = reorderActionProps({
      rows: ROWS,
      index: options.index,
      label,
      commit: () => {},
      announce: (key, at, total) => {
        order.push("announce");
        announced = [key, at, total];
      },
      drag:
        options.drag === undefined
          ? undefined
          : () => {
              order.push("drag");
              options.drag?.();
            },
    });
    return { props, order, announced: () => announced };
  }

  it("announces the pick-up and then starts the drag, in that order", () => {
    // After `drag()` the row is being held rather than sitting at a position,
    // so a pick-up read aloud from mid-gesture names wherever the finger has
    // reached instead of where the row was.
    const run = withLongPress({ index: 2, drag: () => {} });
    run.props.onLongPress?.();
    assert.deepEqual(run.order, ["announce", "drag"]);
    assert.deepEqual(run.announced(), ["reorderPickedUp", 2, 4]);
  });

  it("announces the pick-up at the row's CURRENT place, not a destination", () => {
    const run = withLongPress({ index: 0, drag: () => {} });
    run.props.onLongPress?.();
    assert.deepEqual(run.announced(), ["reorderPickedUp", 0, 4]);
  });

  it("still starts the drag on a row whose index the list has not placed", () => {
    // The pick-up is the one moment an unknown index must not block: the
    // gesture is the user's and it has already begun. `announcedPosition`
    // refuses the number downstream, so the drag runs and nothing is said.
    const run = withLongPress({ index: undefined, drag: () => {} });
    run.props.onLongPress?.();
    assert.deepEqual(run.order, ["announce", "drag"]);
    assert.deepEqual(run.announced(), ["reorderPickedUp", undefined, 4]);
  });

  it("hands back no long press at all when the row may not be dragged", () => {
    // A viewer's row on the collection screen. `undefined` rather than a
    // handler that announces a pick-up they cannot perform.
    assert.equal(withLongPress({ index: 1, drag: undefined }).props.onLongPress, undefined);
  });

  it("offers the keyboard actions on a row with no drag, and the drag on a row with no actions", () => {
    // The two routes are independent: a viewer keeps neither, but a row at the
    // end of the list keeps its long press while offering one action, and a
    // disabled gate removes the actions without removing the gesture.
    const noDrag = reorderActionProps({
      rows: ROWS,
      index: 1,
      label,
      commit: () => {},
      announce: () => {},
    });
    assert.equal(noDrag.onLongPress, undefined);
    assert.deepEqual(
      noDrag.accessibilityActions.map((a) => a.name),
      ["moveUp", "moveDown"],
    );
    const gated = withLongPress({ index: 1, drag: () => {} });
    assert.equal(typeof gated.props.onLongPress, "function");
  });

  it("claims a role, so the actions are offered consistently across readers", () => {
    // `accessibilityActions` on a node with no role is announced
    // inconsistently: TalkBack reads them off anything focusable, VoiceOver
    // often does not offer the rotor until the element claims one.
    assert.equal(withLongPress({ index: 1, drag: () => {} }).props.accessibilityRole, "button");
    assert.equal(REORDER_ROW_ROLE, "button");
  });
});

describe("reorderActionProps — rows read at action time", () => {
  /**
   * The gap a plain array leaves open.
   *
   * The props are built during the render that drew the row. The action fires
   * later — a screen reader focuses a card, the user thinks, then presses. A
   * cloud merge or a `loadMore` in between changes the list, and a handler
   * closing over the old array commits an order nobody is looking at. Passing
   * a function backed by a ref is what closes it, and both screens do.
   */
  function movable(initial: readonly string[]) {
    let current = initial;
    let committed: string[] | null = null;
    let announced: Announced | null = null;
    const props = reorderActionProps({
      rows: () => current,
      index: 1,
      label,
      commit: (next) => {
        committed = next;
      },
      announce: (key, at, total) => {
        announced = [key, at, total];
      },
    });
    return {
      props,
      change: (next: readonly string[]) => {
        current = next;
      },
      committed: () => committed,
      announced: () => announced,
    };
  }

  it("commits the list as it is when the action fires, not as it was", () => {
    const run = movable(["a", "b", "c"]);
    run.change(["a", "b", "c", "d", "e"]);
    run.props.onAccessibilityAction({ nativeEvent: { actionName: "moveDown" } });
    assert.deepEqual(run.committed(), ["a", "c", "b", "d", "e"]);
    // …and the total said aloud is the new one, not the length the row was
    // drawn against.
    assert.deepEqual(run.announced(), ["reorderMoved", 2, 5]);
  });

  it("refuses a move the list has grown out of", () => {
    // The row was drawn in the middle of a five-item list and offered both
    // moves; by the time the action fires the list is two items and this row
    // is last. Committing "move down" would clamp — a write that changes
    // nothing, announced as a move.
    const run = movable(["a", "b", "c", "d", "e"]);
    run.change(["a", "b"]);
    run.props.onAccessibilityAction({ nativeEvent: { actionName: "moveDown" } });
    assert.equal(run.committed(), null);
    assert.equal(run.announced(), null);
  });

  it("still offers what the render-time list supported, so the row is not empty", () => {
    // Availability is a render-time question: the platform needs the action
    // list when it draws the row, and re-deciding it at action time is what
    // the case above is for.
    const run = movable(["a", "b", "c"]);
    assert.deepEqual(
      run.props.accessibilityActions.map((action) => action.name),
      ["moveUp", "moveDown"],
    );
  });

  it("reads the length fresh for the pick-up announcement too", () => {
    const run = movable(["a", "b", "c"]);
    run.change(["a", "b", "c", "d"]);
    const withDrag = reorderActionProps({
      rows: () => ["a", "b", "c", "d"],
      index: 1,
      label,
      commit: () => {},
      announce: (key, at, total) => {
        assert.deepEqual([key, at, total], ["reorderPickedUp", 1, 4]);
      },
      drag: () => {},
    });
    withDrag.onLongPress?.();
  });

  it("takes a plain array too, for a caller with nothing to go stale", () => {
    // Building a ref to say "this list cannot change" would be ceremony; the
    // suites above pass arrays throughout.
    assert.deepEqual(availableReorderActions(["a", "b"], 0), ["moveDown"]);
    assert.deepEqual(availableReorderActions(() => ["a", "b"], 0), ["moveDown"]);
  });
});
