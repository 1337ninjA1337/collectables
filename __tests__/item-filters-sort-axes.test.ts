/**
 * Pins the `cost` and `acquired` sort axes added alongside the original
 * title-only `name-asc`/`name-desc` pair.
 *
 * Two rules carry the whole design and are the reason this file exists —
 * both are invisible in the happy path and both are easy to "simplify" away:
 *
 *  1. **Missing keys sort LAST in BOTH directions.** A priceless item is not
 *     free and an undated one is not the oldest, so flipping the direction
 *     must not promote the unknowns to the top of the screen. The naive
 *     implementation (`asc(...).reverse()`, which is what the name axis used
 *     to do) gets this exactly backwards.
 *
 *  2. **Ties break on the collated title, always ascending.** Without it two
 *     items at the same price land in whatever order the user's drag ordering
 *     happened to leave them, so an unrelated reorder silently re-renders a
 *     sorted collection differently.
 *
 * `lib/item-filters.ts` is React-Native-free, so this is a real runtime test
 * rather than a source-text assertion.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applySortMode,
  SORT_MODE_PARTS,
  SORT_OPTIONS,
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

const titles = (items: CollectableItem[]) => items.map((i) => i.title);
const ALL_NON_DEFAULT_MODES: string[] = [
  "name-asc",
  "name-desc",
  "cost-asc",
  "cost-desc",
  "acquired-asc",
  "acquired-desc",
];


describe("applySortMode — cost axis", () => {
  const priced = [
    item("Beta", { cost: 50 }),
    item("Alpha", { cost: 5 }),
    item("Gamma", { cost: 500 }),
  ];

  it("cost-asc orders cheapest → priciest", () => {
    assert.deepEqual(titles(applySortMode(priced, "cost-asc")), ["Alpha", "Beta", "Gamma"]);
  });

  it("cost-desc orders priciest → cheapest", () => {
    assert.deepEqual(titles(applySortMode(priced, "cost-desc")), ["Gamma", "Beta", "Alpha"]);
  });

  it("compares numerically, not lexicographically", () => {
    // The bug a string comparison would ship: "9" > "10" as text.
    const out = applySortMode([item("Nine", { cost: 9 }), item("Ten", { cost: 10 })], "cost-asc");
    assert.deepEqual(titles(out), ["Nine", "Ten"]);
  });

  it("handles negative and zero costs as ordinary values", () => {
    const out = applySortMode(
      [item("Zero", { cost: 0 }), item("Refund", { cost: -5 }), item("Paid", { cost: 5 })],
      "cost-asc",
    );
    assert.deepEqual(titles(out), ["Refund", "Zero", "Paid"]);
  });

  it("parks priceless items LAST under cost-asc", () => {
    const out = applySortMode(
      [item("NoPrice"), item("Cheap", { cost: 1 }), item("Nulled", { cost: null })],
      "cost-asc",
    );
    assert.deepEqual(titles(out), ["Cheap", "NoPrice", "Nulled"]);
  });

  it("parks priceless items LAST under cost-desc too (not first)", () => {
    // The whole point of rule 1: `desc` is not `asc().reverse()`.
    const out = applySortMode(
      [item("NoPrice"), item("Cheap", { cost: 1 }), item("Rich", { cost: 900 })],
      "cost-desc",
    );
    assert.deepEqual(titles(out), ["Rich", "Cheap", "NoPrice"]);
  });

  it("treats NaN and Infinity as missing, not as extremes", () => {
    // `cost` is hand-typed and can arrive as NaN through a bad import; left
    // raw it would poison the comparator (every comparison false → arbitrary
    // order) or pin Infinity to the top of every priciest-first view.
    const out = applySortMode(
      [item("Nan", { cost: NaN }), item("Inf", { cost: Infinity }), item("Real", { cost: 7 })],
      "cost-desc",
    );
    assert.equal(titles(out)[0], "Real");
    assert.deepEqual(titles(out).slice(1).sort(), ["Inf", "Nan"]);
  });

  it("breaks equal-cost ties on the collated title, ascending, in both directions", () => {
    const tied = [item("Zulu", { cost: 10 }), item("alpha", { cost: 10 })];
    assert.deepEqual(titles(applySortMode(tied, "cost-asc")), ["alpha", "Zulu"]);
    assert.deepEqual(titles(applySortMode(tied, "cost-desc")), ["alpha", "Zulu"]);
  });

  it("breaks ties between two priceless items on the title as well", () => {
    const out = applySortMode([item("Zulu"), item("Alpha")], "cost-asc");
    assert.deepEqual(titles(out), ["Alpha", "Zulu"]);
  });
});

describe("applySortMode — acquired axis", () => {
  const dated = [
    item("Mid", { acquiredAt: "2025-02-11" }),
    item("Old", { acquiredAt: "2024-05-18" }),
    item("New", { acquiredAt: "2025-08-30" }),
  ];

  it("acquired-asc orders oldest → newest", () => {
    assert.deepEqual(titles(applySortMode(dated, "acquired-asc")), ["Old", "Mid", "New"]);
  });

  it("acquired-desc orders newest → oldest", () => {
    assert.deepEqual(titles(applySortMode(dated, "acquired-desc")), ["New", "Mid", "Old"]);
  });

  it("orders within a single month correctly (YYYY-MM-DD is chronological as text)", () => {
    const out = applySortMode(
      [
        item("Late", { acquiredAt: "2025-03-30" }),
        item("Early", { acquiredAt: "2025-03-02" }),
        item("Mid", { acquiredAt: "2025-03-09" }),
      ],
      "acquired-asc",
    );
    assert.deepEqual(titles(out), ["Early", "Mid", "Late"]);
  });

  it("parks undated items LAST in both directions", () => {
    const mixed = [
      item("Undated"),
      item("Blank", { acquiredAt: "   " }),
      item("Dated", { acquiredAt: "2025-01-01" }),
    ];
    assert.equal(titles(applySortMode(mixed, "acquired-asc"))[0], "Dated");
    assert.equal(titles(applySortMode(mixed, "acquired-desc"))[0], "Dated");
    assert.deepEqual(titles(applySortMode(mixed, "acquired-asc")).slice(1), ["Blank", "Undated"]);
    assert.deepEqual(titles(applySortMode(mixed, "acquired-desc")).slice(1), ["Blank", "Undated"]);
  });

  it("treats a whitespace-only date as missing, not as the earliest string", () => {
    // `"   " < "2024-01-01"` is true as a raw string compare, so without the
    // trim a blank-dated item would head every oldest-first view.
    const out = applySortMode(
      [item("Blank", { acquiredAt: "  " }), item("Real", { acquiredAt: "2024-01-01" })],
      "acquired-asc",
    );
    assert.deepEqual(titles(out), ["Real", "Blank"]);
  });

  it("breaks same-day ties on the collated title, ascending, in both directions", () => {
    const tied = [
      item("Zulu", { acquiredAt: "2025-01-01" }),
      item("Alpha", { acquiredAt: "2025-01-01" }),
    ];
    assert.deepEqual(titles(applySortMode(tied, "acquired-asc")), ["Alpha", "Zulu"]);
    assert.deepEqual(titles(applySortMode(tied, "acquired-desc")), ["Alpha", "Zulu"]);
  });
});

describe("applySortMode — invariants shared by every axis", () => {
  const ALL_MODES = SORT_OPTIONS.map((o) => o.mode);

  it("never mutates the input array", () => {
    for (const mode of ALL_MODES) {
      const input = [
        item("Charlie", { cost: 3, acquiredAt: "2025-03-03" }),
        item("Alpha", { cost: 1, acquiredAt: "2025-01-01" }),
      ];
      const snapshot = titles(input);
      applySortMode(input, mode);
      assert.deepEqual(titles(input), snapshot, `${mode} mutated its input`);
    }
  });

  it("returns the same number of items it was given", () => {
    const input = [item("A", { cost: 1 }), item("B"), item("C", { acquiredAt: "2025-01-01" })];
    for (const mode of ALL_MODES) {
      assert.equal(applySortMode(input, mode).length, 3, `${mode} dropped or duplicated an item`);
    }
  });

  it("is idempotent — re-sorting an already-sorted list is a no-op", () => {
    const input = [
      item("B", { cost: 2, acquiredAt: "2025-02-02" }),
      item("A", { cost: 1 }),
      item("C", { cost: 2, acquiredAt: "2025-01-01" }),
    ];
    for (const mode of ALL_MODES) {
      const once = applySortMode(input, mode);
      assert.deepEqual(titles(applySortMode(once, mode)), titles(once), `${mode} is not idempotent`);
    }
  });

  it("handles empty and single-item collections for every mode", () => {
    for (const mode of ALL_MODES) {
      assert.deepEqual(applySortMode([], mode), []);
      assert.deepEqual(titles(applySortMode([item("Solo")], mode)), ["Solo"]);
    }
  });

  it("falls back to the drag order for a mode outside the union", () => {
    // A persisted `ItemFilters` from a newer build can rehydrate with a mode
    // this build has never heard of; a throw inside the render memo would
    // blank the collection screen.
    const input = [item("B"), item("A")];
    assert.equal(applySortMode(input, "colour-asc" as ItemSortMode), input);
  });
});

describe("SORT_MODE_PARTS — the axis/direction decode table", () => {
  it("covers every non-default mode and nothing else", () => {
    const covered = Object.keys(SORT_MODE_PARTS).sort();
    const expected = ALL_NON_DEFAULT_MODES.slice().sort();
    assert.deepEqual(covered, expected);
    assert.ok(!("default" in SORT_MODE_PARTS));
  });

  it("agrees with each mode's name (the string union stays self-describing)", () => {
    // The flat `"{axis}-{direction}"` string union is only readable if the
    // decode table never disagrees with the literal it decodes.
    for (const [mode, parts] of Object.entries(SORT_MODE_PARTS)) {
      assert.equal(`${parts.axis}-${parts.direction}`, mode);
    }
  });

  it("gives every axis both directions", () => {
    const byAxis = new Map<string, string[]>();
    for (const parts of Object.values(SORT_MODE_PARTS)) {
      byAxis.set(parts.axis, [...(byAxis.get(parts.axis) ?? []), parts.direction]);
    }
    assert.deepEqual([...byAxis.keys()].sort(), ["acquired", "cost", "name"]);
    for (const [axis, directions] of byAxis) {
      assert.deepEqual(directions.slice().sort(), ["asc", "desc"], `${axis} is missing a direction`);
    }
  });

  it("every decoded mode has a SORT_OPTIONS row so the UI can reach it", () => {
    for (const mode of ALL_NON_DEFAULT_MODES) {
      assert.ok(
        SORT_OPTIONS.some((o) => o.mode === mode),
        `${mode} is comparable but has no picker row`,
      );
    }
  });
});

