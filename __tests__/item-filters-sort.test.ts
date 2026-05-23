import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applySortMode,
  countActiveFilters,
  EMPTY_FILTERS,
  type ItemFilters,
  type ItemSortMode,
} from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";

function item(title: string, overrides: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: title.toLowerCase().replace(/\s+/g, "-"),
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

function withSort(sort: ItemSortMode): ItemFilters {
  return { ...EMPTY_FILTERS, sort };
}

describe("applySortMode — alphabetical sort comparator", () => {
  it("default mode returns the input array unchanged (same reference, no allocation)", () => {
    // Identity is the cheap path: callers rely on `applySortMode(items, "default") === items`
    // so React-memo equality holds when no sort is active.
    const input = [item("B"), item("A"), item("C")];
    const out = applySortMode(input, "default");
    assert.equal(out, input, "default mode must return the input array reference, not a copy");
  });

  it("name-asc sorts titles A → Z", () => {
    const out = applySortMode([item("Charlie"), item("Alpha"), item("Bravo")], "name-asc");
    assert.deepEqual(
      out.map((i) => i.title),
      ["Alpha", "Bravo", "Charlie"],
    );
  });

  it("name-desc sorts titles Z → A", () => {
    const out = applySortMode([item("Charlie"), item("Alpha"), item("Bravo")], "name-desc");
    assert.deepEqual(
      out.map((i) => i.title),
      ["Charlie", "Bravo", "Alpha"],
    );
  });

  it("case-insensitive: 'Apple' sorts before 'banana' under sensitivity:base", () => {
    // The expected ordering is "Apple" < "banana" because the comparator
    // uses { sensitivity: "base" } which folds case BEFORE comparing.
    // A naive lexicographic sort would put "banana" before "Apple"
    // (uppercase 'A' = 0x41, lowercase 'b' = 0x62).
    const out = applySortMode([item("banana"), item("Apple")], "name-asc");
    assert.deepEqual(
      out.map((i) => i.title),
      ["Apple", "banana"],
    );
  });

  it("accented characters collate near their base letter (é near e)", () => {
    // "élite" should land next to "elite" (not at the end of the alphabet
    // as it would under a naive Latin-1 sort). With sensitivity:base they
    // collate equal-base, so other titles between them are what determines
    // the relative order — here "fox" sorts after both.
    const out = applySortMode(
      [item("fox"), item("élite"), item("apple")],
      "name-asc",
    );
    // apple < {élite|elite} < fox — exact order between identical-base
    // strings isn't pinned, but we can pin that 'fox' is last and 'apple' first.
    assert.equal(out[0].title, "apple");
    assert.equal(out[2].title, "fox");
  });

  it("numeric-aware: 'Item 2' sorts before 'Item 10' (not lexicographic)", () => {
    // Without { numeric: true }, "Item 10" < "Item 2" because the string
    // comparator hits "1" < "2" before reading the rest of the digit run.
    const out = applySortMode(
      [item("Item 10"), item("Item 2"), item("Item 1")],
      "name-asc",
    );
    assert.deepEqual(
      out.map((i) => i.title),
      ["Item 1", "Item 2", "Item 10"],
    );
  });

  it("name-desc is the strict reverse of name-asc for the same input", () => {
    const input = [item("Zeta"), item("Alpha"), item("Mu")];
    const asc = applySortMode(input, "name-asc");
    const desc = applySortMode(input, "name-desc");
    assert.deepEqual(
      desc.map((i) => i.title),
      [...asc].reverse().map((i) => i.title),
    );
  });

  it("does not mutate the input array under non-default modes", () => {
    // Pure helpers must not mutate — the collection-detail screen feeds
    // a useMemo'd reference into the chunked-list hook, so an in-place
    // sort would corrupt the upstream memo's identity invariant.
    const input = [item("Charlie"), item("Alpha"), item("Bravo")];
    const snapshot = input.map((i) => i.title);
    applySortMode(input, "name-asc");
    assert.deepEqual(
      input.map((i) => i.title),
      snapshot,
      "applySortMode must not mutate the input array",
    );
  });

  it("empty input returns an empty array for every mode", () => {
    for (const mode of ["default", "name-asc", "name-desc"] as ItemSortMode[]) {
      assert.deepEqual(applySortMode([], mode), []);
    }
  });
});

describe("EMPTY_FILTERS / countActiveFilters — sort field integration", () => {
  it("EMPTY_FILTERS.sort defaults to 'default' (no sort applied)", () => {
    // Without this default, a freshly-opened filter sheet would render
    // the wrong sort chip as active.
    assert.equal(EMPTY_FILTERS.sort, "default");
  });

  it("countActiveFilters does NOT increment for the default sort mode", () => {
    assert.equal(countActiveFilters(EMPTY_FILTERS), 0);
    assert.equal(countActiveFilters(withSort("default")), 0);
  });

  it("countActiveFilters increments by 1 for each non-default sort mode", () => {
    assert.equal(countActiveFilters(withSort("name-asc")), 1);
    assert.equal(countActiveFilters(withSort("name-desc")), 1);
  });

  it("countActiveFilters composes sort with other active filters (additive)", () => {
    // priceFrom + sort name-asc = 2 active filters in the badge.
    const filters: ItemFilters = {
      ...EMPTY_FILTERS,
      priceFrom: "10",
      sort: "name-asc",
    };
    assert.equal(countActiveFilters(filters), 2);
  });
});
