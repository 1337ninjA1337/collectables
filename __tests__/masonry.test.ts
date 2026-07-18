import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  allocateColumns,
  distributeByHeight,
  distributeIntoMasonryColumns,
  resolveColumnCount,
} from "@/lib/masonry";

/**
 * Round-robin distribution helper backing the collection-detail masonry
 * layout. Pure module (no React, no RN imports) so the math is unit-tested
 * directly — the file `app/collection/[id].tsx` will pick it up in a
 * follow-up sub-task (VM-B) and the assertions below are the contract.
 */

describe("resolveColumnCount", () => {
  it("returns the input for positive finite integers", () => {
    assert.equal(resolveColumnCount(1), 1);
    assert.equal(resolveColumnCount(2), 2);
    assert.equal(resolveColumnCount(3), 3);
    assert.equal(resolveColumnCount(10), 10);
  });

  it("falls back to 1 for non-finite / non-positive values", () => {
    // A 0 or negative column count would break the `i % safeCount` math
    // inside the distributor (modulo zero is NaN; modulo negative does
    // odd things). Falling back to 1 guarantees the helper still
    // produces a usable single-column passthrough.
    assert.equal(resolveColumnCount(0), 1);
    assert.equal(resolveColumnCount(-1), 1);
    assert.equal(resolveColumnCount(-100), 1);
    assert.equal(resolveColumnCount(Number.NaN), 1);
    assert.equal(resolveColumnCount(Number.POSITIVE_INFINITY), 1);
    assert.equal(resolveColumnCount(Number.NEGATIVE_INFINITY), 1);
  });

  it("floors fractional column counts", () => {
    assert.equal(resolveColumnCount(2.7), 2);
    assert.equal(resolveColumnCount(3.1), 3);
    assert.equal(resolveColumnCount(1.9), 1);
  });
});

describe("distributeIntoMasonryColumns", () => {
  it("returns N empty columns for an empty input", () => {
    // The collection-detail viewer needs to render the two-column grid
    // shell even when items.length === 0 so the empty-state placeholder
    // takes its layout slot; the helper must always return `columnCount`
    // arrays, never a shorter list.
    assert.deepEqual(distributeIntoMasonryColumns<number>([], 2), [[], []]);
    assert.deepEqual(distributeIntoMasonryColumns<number>([], 1), [[]]);
    assert.deepEqual(distributeIntoMasonryColumns<number>([], 3), [[], [], []]);
  });

  it("passes everything through column 0 when columnCount = 1", () => {
    assert.deepEqual(distributeIntoMasonryColumns([1, 2, 3, 4], 1), [[1, 2, 3, 4]]);
  });

  it("round-robins items across 2 columns at an exact multiple", () => {
    // This is the legacy `.filter((_, i) => i % 2 === N)` shape — column
    // 0 gets even indices, column 1 gets odd indices. A regression here
    // would shuffle the visual order in the collection-detail masonry.
    assert.deepEqual(
      distributeIntoMasonryColumns([0, 1, 2, 3, 4, 5], 2),
      [[0, 2, 4], [1, 3, 5]],
    );
  });

  it("round-robins items across 2 columns when uneven (column 0 carries the trailing item)", () => {
    assert.deepEqual(
      distributeIntoMasonryColumns([0, 1, 2, 3, 4], 2),
      [[0, 2, 4], [1, 3]],
    );
  });

  it("round-robins across 3 columns", () => {
    assert.deepEqual(
      distributeIntoMasonryColumns([0, 1, 2, 3, 4, 5, 6], 3),
      [[0, 3, 6], [1, 4], [2, 5]],
    );
  });

  it("defaults to 2 columns when columnCount is omitted", () => {
    assert.deepEqual(
      distributeIntoMasonryColumns([0, 1, 2, 3]),
      [[0, 2], [1, 3]],
    );
  });

  it("falls back to 1 column when columnCount is non-positive / non-finite", () => {
    // resolveColumnCount handles the clamp — this asserts the helper
    // actually wires through it instead of crashing on `i % 0` = NaN.
    assert.deepEqual(distributeIntoMasonryColumns([1, 2, 3], 0), [[1, 2, 3]]);
    assert.deepEqual(distributeIntoMasonryColumns([1, 2, 3], -1), [[1, 2, 3]]);
    assert.deepEqual(distributeIntoMasonryColumns([1, 2, 3], Number.NaN), [[1, 2, 3]]);
  });

  it("does not mutate the input array", () => {
    // The masonry path is sometimes given a memoized `visibleItems`
    // reference that other render branches also read — mutating it
    // would corrupt unrelated views on the same screen.
    const input = [0, 1, 2, 3, 4];
    const snapshot = [...input];
    distributeIntoMasonryColumns(input, 2);
    assert.deepEqual(input, snapshot);
  });

  it("preserves item identity (returns references, not copies)", () => {
    // ItemCard renders by reference; if the helper cloned its entries
    // the memoization downstream would invalidate every render.
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    const cols = distributeIntoMasonryColumns([a, b, c], 2);
    assert.equal(cols[0][0], a);
    assert.equal(cols[1][0], b);
    assert.equal(cols[0][1], c);
  });

  it("handles a single item across multiple columns (only column 0 populated)", () => {
    assert.deepEqual(distributeIntoMasonryColumns([42], 3), [[42], [], []]);
  });

  it("preserves item order within each column", () => {
    // Within column 0 the indices are 0, 2, 4, … in ascending order;
    // this is what gives the masonry its visual top-to-bottom flow.
    const cols = distributeIntoMasonryColumns([10, 20, 30, 40, 50, 60], 2);
    assert.deepEqual(cols[0], [10, 30, 50]);
    assert.deepEqual(cols[1], [20, 40, 60]);
  });
});

describe("allocateColumns", () => {
  it("returns columnCount independent empty arrays", () => {
    const cols = allocateColumns<number>(3);
    assert.equal(cols.length, 3);
    // Independence matters: a shared array reference would make every
    // column receive every item.
    cols[0].push(1);
    assert.deepEqual(cols, [[1], [], []] as number[][]);
  });

  it("clamps through resolveColumnCount (never fewer than one column)", () => {
    assert.deepEqual(allocateColumns(0), [[]]);
    assert.deepEqual(allocateColumns(Number.NaN), [[]]);
    assert.deepEqual(allocateColumns(2.9), [[], []]);
  });
});

describe("distributeByHeight", () => {
  const height = (n: number) => n;

  it("places each item in the currently-shortest column", () => {
    // Heights 10, 2, 3: col0 takes 10, col1 takes 2 (shorter), col1 again
    // takes 3 (2 < 10) — the greedy step round-robin would get wrong.
    assert.deepEqual(distributeByHeight([10, 2, 3], 2, height), [[10], [2, 3]]);
  });

  it("breaks ties toward the lowest-index column, so uniform heights reproduce round-robin", () => {
    // The switch-without-visual-jump contract: while every card is the
    // same fixed height, this helper and distributeIntoMasonryColumns
    // must produce identical layouts.
    const uniform = [0, 1, 2, 3, 4, 5];
    assert.deepEqual(
      distributeByHeight(uniform, 2, () => 180),
      distributeIntoMasonryColumns(uniform, 2),
    );
    assert.deepEqual(
      distributeByHeight(uniform, 3, () => 180),
      distributeIntoMasonryColumns(uniform, 3),
    );
  });

  it("returns N empty columns for an empty input", () => {
    assert.deepEqual(distributeByHeight<number>([], 2, height), [[], []]);
  });

  it("falls back to a single column for bad columnCount", () => {
    assert.deepEqual(distributeByHeight([1, 2, 3], 0, height), [[1, 2, 3]]);
    assert.deepEqual(distributeByHeight([1, 2, 3], Number.NaN, height), [[1, 2, 3]]);
  });

  it("treats non-finite / negative heights as 0 instead of poisoning the comparison", () => {
    // A NaN height would make every subsequent `<` comparison false and
    // dump ALL remaining items into whichever column got the NaN.
    const cols = distributeByHeight([Number.NaN, 5, 1, 1], 2, height);
    // NaN→col0 counts as 0, so col0 is still "shortest" for 5; then 1
    // lands in col1 (0+... col0 has 0+5? no — col0 got NaN(0) then 5 → 5),
    // so: NaN→col0 (h 0), 5→col0 (0 ≤ 0 tie → col0, h 5), 1→col1 (0 < 5),
    // 1→col1 (1 < 5).
    assert.deepEqual(cols, [[Number.NaN, 5], [1, 1]]);
    const negative = distributeByHeight([-10, 3, 2], 2, height);
    // -10 counts as 0: col0 stays height 0, 3 ties into col0 (h 3), 2→col1.
    assert.deepEqual(negative, [[-10, 3], [2]]);
  });

  it("does not mutate the input and preserves item identity", () => {
    const a = { id: "a", h: 30 };
    const b = { id: "b", h: 10 };
    const c = { id: "c", h: 10 };
    const input = [a, b, c];
    const snapshot = [...input];
    const cols = distributeByHeight(input, 2, (item) => item.h);
    assert.deepEqual(input, snapshot);
    assert.equal(cols[0][0], a);
    assert.equal(cols[1][0], b);
    // c goes to col1: 10+... col1 height 10 < col0 30? yes → col1.
    assert.equal(cols[1][1], c);
  });

  it("preserves input order within each column", () => {
    const cols = distributeByHeight([4, 4, 4, 4, 1, 1], 2, height);
    // Greedy placement never reorders within a column — each column's
    // entries appear in their original relative order:
    // 4→c0(4), 4→c1(4), 4→c0 tie(8), 4→c1(8), 1→c0 tie(9), 1→c1(9).
    assert.deepEqual(cols, [[4, 4, 1], [4, 4, 1]]);
  });
});
