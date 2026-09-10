import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { moveItem, targetIndexForPointer, type RowRect } from "@/lib/drag-reorder";

/**
 * The two decisions a web drag makes, away from the DOM that feeds them.
 *
 * `components/DraggableList.web.tsx` is the shim the deployed bundle uses in
 * place of `react-native-draggable-flatlist`, and it runs its own pointer
 * gesture. `draggable-list-web.test.ts` drives that gesture end to end against
 * a fake document; what is here is the arithmetic underneath, where the cases
 * that matter are the ones a gesture only reaches occasionally — a pointer
 * above the first row, a list that changed length mid-drag, a measurement that
 * came back empty.
 *
 * Both functions are total, and the cases say so rather than the header: a
 * reorder that throws does it at the end of a gesture the user has already
 * finished, with the row half-dragged and nothing to undo.
 */

const ROWS = ["a", "b", "c", "d"] as const;

/** Four 100pt rows stacked from the top of the viewport; midpoints 50/150/250/350. */
const RECTS: readonly RowRect[] = ROWS.map((_, index) => ({
  top: index * 100,
  bottom: (index + 1) * 100,
}));

describe("moveItem", () => {
  it("moves a row down, closing the gap behind it", () => {
    assert.deepEqual(moveItem(ROWS, 0, 2), ["b", "c", "a", "d"]);
  });

  it("moves a row up, pushing the rest down", () => {
    assert.deepEqual(moveItem(ROWS, 3, 1), ["a", "d", "b", "c"]);
  });

  it("moves a row to either end", () => {
    assert.deepEqual(moveItem(ROWS, 2, 0), ["c", "a", "b", "d"]);
    assert.deepEqual(moveItem(ROWS, 1, 3), ["a", "c", "d", "b"]);
  });

  it("keeps the order when the row did not move", () => {
    assert.deepEqual(moveItem(ROWS, 2, 2), [...ROWS]);
  });

  it("clamps a target past either end instead of dropping the row", () => {
    // A pointer dragged above the list or below it. `targetIndexForPointer`
    // does not return out-of-range indices today, so this is the guard for the
    // day a caller computes one some other way — and `splice` with a negative
    // index counts from the END, which would move the row to the wrong place
    // silently rather than fail.
    assert.deepEqual(moveItem(ROWS, 0, -5), ["a", "b", "c", "d"]);
    assert.deepEqual(moveItem(ROWS, 0, 99), ["b", "c", "d", "a"]);
  });

  it("leaves the order alone when the row it was given does not exist", () => {
    assert.deepEqual(moveItem(ROWS, 9, 0), [...ROWS]);
    assert.deepEqual(moveItem(ROWS, -1, 0), [...ROWS]);
    assert.deepEqual(moveItem([], 0, 0), []);
  });

  it("refuses fractional indices rather than splicing on them", () => {
    assert.deepEqual(moveItem(ROWS, 1.5, 0), [...ROWS]);
    assert.deepEqual(moveItem(ROWS, 0, 1.5), [...ROWS]);
  });

  it("always returns a new array, so no caller shares one", () => {
    const input: string[] = [...ROWS];
    const untouched = moveItem(input, 1, 1);
    assert.notEqual(untouched, input);
    untouched.push("e");
    assert.deepEqual(input, [...ROWS]);
  });
});

describe("targetIndexForPointer", () => {
  it("answers with the row whose midpoint the pointer has not yet passed", () => {
    assert.equal(targetIndexForPointer(RECTS, 0), 0);
    assert.equal(targetIndexForPointer(RECTS, 49), 0);
    assert.equal(targetIndexForPointer(RECTS, 51), 1);
    assert.equal(targetIndexForPointer(RECTS, 149), 1);
    assert.equal(targetIndexForPointer(RECTS, 151), 2);
  });

  it("swaps exactly at a midpoint, not at a row boundary", () => {
    // The boundary between rows 0 and 1 is y=100, and dragging row 0 down to
    // y=100 should NOT yet have moved it: a swap on the boundary makes the row
    // jump as soon as the cursor leaves it, which reads as the list flickering.
    assert.equal(targetIndexForPointer(RECTS, 100), 1);
    assert.equal(targetIndexForPointer(RECTS, 50), 1);
    assert.equal(targetIndexForPointer(RECTS, 49.9), 0);
  });

  it("clamps above the first row and below the last", () => {
    assert.equal(targetIndexForPointer(RECTS, -400), 0);
    assert.equal(targetIndexForPointer(RECTS, 9999), RECTS.length - 1);
  });

  it("reads a scrolled list from the rects it was given, not from the index", () => {
    // `getBoundingClientRect` is viewport-relative, so a list scrolled halfway
    // down reports negative tops. Nothing here may assume the first row starts
    // at zero.
    const scrolled = RECTS.map((rect) => ({ top: rect.top - 250, bottom: rect.bottom - 250 }));
    assert.equal(targetIndexForPointer(scrolled, -201), 0);
    assert.equal(targetIndexForPointer(scrolled, 0), 3);
  });

  it("has no answer for an unmeasured list", () => {
    assert.equal(targetIndexForPointer([], 100), -1);
  });

  it("has no answer for a pointer that is not a number on the page", () => {
    assert.equal(targetIndexForPointer(RECTS, Number.NaN), -1);
    assert.equal(targetIndexForPointer(RECTS, Number.POSITIVE_INFINITY), -1);
  });

  it("is monotonic, so a drag never doubles back on itself", () => {
    // The property the two cases above are examples of: as the pointer travels
    // down the list the answer never decreases. A comparison written against
    // the wrong edge of a rect passes a handful of point cases and fails this.
    let previous = -1;
    for (let y = -50; y <= 450; y += 5) {
      const index = targetIndexForPointer(RECTS, y);
      assert.ok(index >= previous, `pointer at ${y} went back to row ${index} from ${previous}`);
      previous = index;
    }
    assert.equal(previous, RECTS.length - 1);
  });
});
