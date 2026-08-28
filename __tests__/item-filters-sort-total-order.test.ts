import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applySortMode, type ItemSortMode } from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";

/**
 * `applySortMode`'s rule 2 (tie → collated title) was documented as making the
 * cost/acquired axes "total". It does not, and the gap is wider than a reader
 * of that line would guess, for two reasons that compound:
 *
 *  1. The collator runs at `sensitivity: "base"`, so "Écu", "ecu" and "ECU"
 *     are EQUAL to it. Rule 2 leaves every such pair tied, not just literal
 *     duplicates.
 *  2. Literal duplicates are the common case anyway — two copies of one card,
 *     same title, same price, is what a collection app is full of.
 *
 * Tied rows then fell through to the incoming array order, which comes from
 * the same id-keyed cloud merge as every other list in the app, so one
 * collection could render in two orders on two devices. Rule 3 (tie → `id`)
 * closes it. These tests assert the ORDER IS TOTAL — one output per input set,
 * whatever order it arrived in — rather than spot-checking pairs.
 */
function item(
  id: string,
  title: string,
  overrides: Partial<CollectableItem> = {},
): CollectableItem {
  return {
    id,
    collectionId: "c1",
    title,
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "u1",
    createdByUserId: "u1",
    createdAt: "2026-05-23",
    ...overrides,
  };
}

/** Deterministic shuffles, so a failure reproduces rather than flakes. */
function permutations<T>(rows: readonly T[], count = 12): T[][] {
  const out: T[][] = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let n = 0; n < count; n += 1) {
    const copy = rows.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    out.push(copy);
  }
  return out;
}

function assertStableAcrossPermutations(rows: CollectableItem[], sort: ItemSortMode) {
  const expected = applySortMode(rows, sort, "en").map((i) => i.id);
  for (const shuffled of permutations(rows)) {
    assert.deepEqual(
      applySortMode(shuffled, sort, "en").map((i) => i.id),
      expected,
      `${sort} depends on input order`,
    );
  }
  return expected;
}

describe("applySortMode is a total order on every axis", () => {
  it("pins duplicate title + duplicate cost by id", () => {
    const rows = [
      item("c", "Charizard", { cost: 10 }),
      item("a", "Charizard", { cost: 10 }),
      item("b", "Charizard", { cost: 10 }),
    ];
    for (const sort of ["cost-asc", "cost-desc"] as const) {
      assert.deepEqual(assertStableAcrossPermutations(rows, sort), ["a", "b", "c"]);
    }
  });

  it("pins titles the base-sensitivity collator calls equal", () => {
    // The collator folds case AND accents, so these three are one tie to it.
    // This is the case rule 2 silently failed to cover.
    const rows = [item("z", "Écu"), item("m", "ECU"), item("a", "ecu")];
    for (const sort of ["name-asc", "name-desc"] as const) {
      assert.deepEqual(assertStableAcrossPermutations(rows, sort), ["a", "m", "z"]);
    }
  });

  it("pins items that share a missing key and a title", () => {
    // Both keys null → rule 1's `av === bv` branch, which fell through to the
    // title alone and so tied on identical titles too.
    const rows = [item("c", "Ditto"), item("a", "Ditto"), item("b", "Ditto")];
    for (const sort of ["cost-asc", "acquired-desc"] as const) {
      assert.deepEqual(assertStableAcrossPermutations(rows, sort), ["a", "b", "c"]);
    }
  });

  it("breaks ties ascending by id under BOTH directions", () => {
    // The tiebreak is a machine ordering, not a secondary presentation axis:
    // flipping the primary direction must not flip it.
    const rows = [item("b", "Same", { cost: 5 }), item("a", "Same", { cost: 5 })];
    assert.deepEqual(applySortMode(rows, "cost-asc", "en").map((i) => i.id), ["a", "b"]);
    assert.deepEqual(applySortMode(rows, "cost-desc", "en").map((i) => i.id), ["a", "b"]);
    assert.deepEqual(applySortMode(rows, "name-asc", "en").map((i) => i.id), ["a", "b"]);
    assert.deepEqual(applySortMode(rows, "name-desc", "en").map((i) => i.id), ["a", "b"]);
  });
});

describe("the id tiebreak never outranks a real ordering rule", () => {
  it("leaves rule 1 (missing keys sink last) intact in both directions", () => {
    // The regression to fear: an `|| compareKeysAsc(...)` bolted onto the wrong
    // branch would let a low id float a priceless item above priced ones.
    const rows = [item("z", "Priced", { cost: 5 }), item("a", "Priceless")];
    assert.deepEqual(applySortMode(rows, "cost-asc", "en").map((i) => i.id), ["z", "a"]);
    assert.deepEqual(applySortMode(rows, "cost-desc", "en").map((i) => i.id), ["z", "a"]);
  });

  it("leaves rule 2 (title tiebreak) ahead of the id", () => {
    const rows = [item("a", "Zubat", { cost: 5 }), item("z", "Abra", { cost: 5 })];
    assert.deepEqual(applySortMode(rows, "cost-asc", "en").map((i) => i.id), ["z", "a"]);
  });

  it("leaves the primary key ahead of both tiebreaks", () => {
    const rows = [item("a", "Abra", { cost: 99 }), item("z", "Zubat", { cost: 1 })];
    assert.deepEqual(applySortMode(rows, "cost-asc", "en").map((i) => i.id), ["z", "a"]);
    assert.deepEqual(applySortMode(rows, "cost-desc", "en").map((i) => i.id), ["a", "z"]);
  });

  it("still returns the input reference for the drag-ordered default mode", () => {
    // `"default"` must stay the identity path — the user's drag order IS the
    // answer there, and callers depend on reference equality for React memo.
    const input = [item("b", "B"), item("a", "A")];
    assert.equal(applySortMode(input, "default", "en"), input);
  });
});
