import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { byId, moveItem, planDragCommit } from "@/lib/drag-reorder";

/**
 * What a finished drag commits, when the list did not stay still under it.
 *
 * The keyboard route stopped trusting the render's array two commits ago:
 * `reorderActionProps` reads its rows at action time and finds the row by key.
 * The pointer route — the one that produced the argument — kept committing
 * `data`, the list's reordered copy of what it DREW, and every case here is a
 * thing that can land between the gesture starting and the finger coming up.
 *
 * The first group is the one that must never change: an ordinary drag on a
 * list nothing touched has to reproduce `data` exactly, or the fix has broken
 * the 99% to protect the 1%.
 */

type Row = { readonly id: string };

const row = (id: string): Row => ({ id });

/** Four rows, as the list drew them. */
const RENDERED: readonly Row[] = ["a", "b", "c", "d"].map(row);

/** The ids of a plan's rows, which is what every assertion here is about. */
const ids = (rows: readonly Row[]): string[] => rows.map(byId);

/**
 * What the list hands `onDragEnd` after dragging `from` to `to`.
 *
 * Both halves build it the same way — the native library from its own
 * bookkeeping, `components/DraggableList.web.tsx` from `moveItem` — so the
 * snapshot a case starts from is the snapshot a gesture really produces.
 */
const dragged = (rows: readonly Row[], from: number, to: number) => ({
  data: moveItem(rows, from, to),
  from,
  to,
});

describe("planDragCommit on a list that did not change", () => {
  it("reproduces the snapshot exactly, moving a row down", () => {
    const { data, to } = dragged(RENDERED, 0, 2);
    const plan = planDragCommit({ data, to, rows: RENDERED, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ids(data));
    assert.deepEqual(ids(plan!.rows), ["b", "c", "a", "d"]);
    assert.equal(plan!.to, to);
  });

  it("reproduces the snapshot exactly, moving a row up", () => {
    const { data, to } = dragged(RENDERED, 3, 1);
    const plan = planDragCommit({ data, to, rows: RENDERED, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ids(data));
    assert.deepEqual(ids(plan!.rows), ["a", "d", "b", "c"]);
    assert.equal(plan!.to, to);
  });

  it("reproduces a drop at the very top, which has no row above it to anchor on", () => {
    const { data, to } = dragged(RENDERED, 2, 0);
    const plan = planDragCommit({ data, to, rows: RENDERED, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ["c", "a", "b", "d"]);
    assert.equal(plan!.to, 0);
  });

  it("reproduces every drop on a four-row list", () => {
    // The property the three cases above are examples of. A rule that anchors
    // on the wrong neighbour, or that forgets the dragged row is lifted out
    // before the insert, passes a couple of hand-picked drops and fails here.
    for (let from = 0; from < RENDERED.length; from += 1) {
      for (let to = 0; to < RENDERED.length; to += 1) {
        if (to === from) continue;
        const gesture = dragged(RENDERED, from, to);
        const plan = planDragCommit({ ...gesture, rows: RENDERED, keyOf: byId });
        assert.ok(plan, `no plan for ${from} -> ${to}`);
        assert.deepEqual(ids(plan.rows), ids(gesture.data), `${from} -> ${to}`);
        assert.equal(plan.to, to, `${from} -> ${to}`);
      }
    }
  });
});

describe("planDragCommit on a list that changed mid-gesture", () => {
  it("keeps a row that arrived mid-gesture instead of dropping it", () => {
    // `data` was taken before "e" merged in. Committing it would persist a
    // four-row order and lose a row the user never touched.
    const { data, to } = dragged(RENDERED, 0, 2);
    const merged = [...RENDERED, row("e")];
    const plan = planDragCommit({ data, to, rows: merged, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ["b", "c", "a", "d", "e"]);
  });

  it("matches rows by key, so a merge that rebuilt the objects is still the same list", () => {
    // A cloud merge hands back new objects with the same ids. Nothing here may
    // depend on reference identity, or every post-merge drag becomes a no-op.
    const { data, to } = dragged(RENDERED, 3, 1);
    const rebuilt = RENDERED.map((r) => row(r.id));
    const plan = planDragCommit({ data, to, rows: rebuilt, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ["a", "d", "b", "c"]);
  });

  it("lands after the same neighbour when the rows above the drop shifted", () => {
    // The user dropped "d" directly under "a". Two rows arrived above "a"
    // since, so the index they dropped on now names a different card — and the
    // neighbour they actually aimed at is the thing that survived.
    const { data, to } = dragged(RENDERED, 3, 1);
    const grown = [row("x"), row("y"), ...RENDERED];
    const plan = planDragCommit({ data, to, rows: grown, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ["x", "y", "a", "d", "b", "c"]);
    assert.equal(plan!.to, 3);
  });

  it("falls back to the next neighbour up when the one it aimed at is gone", () => {
    // Dropped under "b", and "b" was deleted on another device mid-gesture.
    // "a" is the nearest row above the drop that still exists.
    const { data, to } = dragged(RENDERED, 3, 2);
    const withoutB = RENDERED.filter((r) => r.id !== "b");
    const plan = planDragCommit({ data, to, rows: withoutB, keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ["a", "d", "c"]);
    assert.equal(plan!.to, 1);
  });

  it("goes to the top when every row above the drop is gone", () => {
    // Dropped under "a", and "a" and "b" both went away. Nothing is left to
    // anchor on above the drop, so the top is where the user aimed.
    const { data, to } = dragged(RENDERED, 3, 1);
    const plan = planDragCommit({ data, to, rows: [row("c"), row("d")], keyOf: byId });

    assert.deepEqual(ids(plan!.rows), ["d", "c"]);
    assert.equal(plan!.to, 0);
  });

  it("commits nothing when the drop resolves to where the row already sits", () => {
    // Same gesture, and this time "d" is already the top row of what is left.
    // A move to the place it is at is not a move, however the list got there.
    const { data, to } = dragged(RENDERED, 3, 1);

    assert.equal(planDragCommit({ data, to, rows: [row("d"), row("c")], keyOf: byId }), null);
  });

  it("commits nothing for a row that left the list", () => {
    // Deleted on another device while it was being dragged. Committing `data`
    // would write the row back into the order and resurrect it on the next
    // read.
    const { data, to } = dragged(RENDERED, 0, 2);
    const withoutA = RENDERED.filter((r) => r.id !== "a");

    assert.equal(planDragCommit({ data, to, rows: withoutA, keyOf: byId }), null);
  });

  it("commits nothing against an empty list", () => {
    const { data, to } = dragged(RENDERED, 0, 2);

    assert.equal(planDragCommit({ data, to, rows: [], keyOf: byId }), null);
  });
});

describe("planDragCommit on a drag with nothing to commit", () => {
  it("refuses a drop that resolves to where the row already is", () => {
    // Not a move, and announcing one as "moved to position 3 of 7" is exactly
    // the "it moved" / "it was already there" ambiguity the keyboard actions
    // refuse to create.
    assert.equal(
      planDragCommit({ data: RENDERED, to: 2, rows: RENDERED, keyOf: byId }),
      null,
    );
  });

  it("refuses a `to` that is not a position in the snapshot", () => {
    for (const to of [-1, RENDERED.length, 1.5, Number.NaN]) {
      assert.equal(
        planDragCommit({ data: RENDERED, to, rows: RENDERED, keyOf: byId }),
        null,
        `to=${to}`,
      );
    }
  });

  it("refuses an empty snapshot, which is every `to` at once", () => {
    assert.equal(planDragCommit({ data: [], to: 0, rows: RENDERED, keyOf: byId }), null);
  });
});

describe("planDragCommit's result", () => {
  it("never returns the caller's array", () => {
    // Both screens map the result into an id list and hand it to a writer; a
    // returned input would let one of them renumber a context's own array.
    const { data, to } = dragged(RENDERED, 0, 2);
    const plan = planDragCommit({ data, to, rows: RENDERED, keyOf: byId });

    assert.notEqual(plan!.rows, RENDERED);
    assert.notEqual(plan!.rows as readonly Row[], data);
  });

  it("reports the index the row landed on, not the one it was dropped at", () => {
    // What the announcement reads aloud. The two differ exactly when the list
    // changed, which is the case a user cannot see to check.
    const { data, to } = dragged(RENDERED, 0, 1);
    const grown = [row("x"), ...RENDERED];
    const plan = planDragCommit({ data, to, rows: grown, keyOf: byId });

    assert.equal(to, 1);
    assert.equal(plan!.to, 2);
    assert.equal(ids(plan!.rows)[plan!.to], "a");
  });

  it("keeps the whole current list, not the page the snapshot held", () => {
    const { data, to } = dragged(RENDERED, 0, 1);
    const grown = [...RENDERED, row("e"), row("f")];
    const plan = planDragCommit({ data, to, rows: grown, keyOf: byId });

    assert.equal(plan!.rows.length, grown.length);
  });
});

describe("byId", () => {
  it("reads the id every list in this app is keyed by", () => {
    assert.equal(byId({ id: "abc" }), "abc");
  });

  it("is the same function at every call site, which is the point of it", () => {
    // Four call sites spelled `(row) => row.id` before this existed: two
    // `keyExtractor`s and two `identify`s. The guard is that they now share an
    // implementation, so a change to what "the same row" means cannot reach
    // three of them and miss the fourth.
    const rows = RENDERED.map(byId);
    assert.deepEqual(rows, ["a", "b", "c", "d"]);
  });
});
