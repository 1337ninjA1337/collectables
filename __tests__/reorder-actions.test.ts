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
  availableReorderActions,
  reorderActionProps,
  type ReorderActionName,
} from "@/lib/reorder-actions";

const ROWS = ["a", "b", "c", "d"] as const;

/** A label function that shows its key, so a case can assert both halves. */
const label = (key: ReorderActionName) => `label:${key}`;

/** Fires one action and reports what the row committed and announced. */
function perform(
  actionName: string,
  options: { index: number | undefined; rows?: readonly string[]; enabled?: boolean },
): { committed: string[] | null; announced: [number, number] | null } {
  let committed: string[] | null = null;
  let announced: [number, number] | null = null;
  const props = reorderActionProps({
    rows: options.rows ?? ROWS,
    index: options.index,
    enabled: options.enabled,
    label,
    commit: (next) => {
      committed = next;
    },
    announce: (to, total) => {
      announced = [to, total];
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
    assert.deepEqual(announced, [1, 4]);
  });

  it("moves the row one place down and says where it landed", () => {
    const { committed, announced } = perform("moveDown", { index: 1 });
    assert.deepEqual(committed, ["a", "c", "b", "d"]);
    assert.deepEqual(announced, [2, 4]);
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
    assert.deepEqual(perform("moveDown", { index: 0 }).announced, [1, 4]);
    assert.deepEqual(perform("moveUp", { index: 3 }).announced, [2, 4]);
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
