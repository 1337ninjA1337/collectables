import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { distributeIntoMasonryColumns, resolveColumnCount } from "@/lib/masonry";

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
