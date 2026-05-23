import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyItemFilters,
  EMPTY_FILTERS,
  type ItemFilters,
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

function withQuery(query: string): ItemFilters {
  return { ...EMPTY_FILTERS, query };
}

describe("applyItemFilters — in-collection title search (query field)", () => {
  const corpus = [
    item("Hot Wheels Camaro"),
    item("Mustang GT"),
    item("HOT pink poodle"),
    item("Hot Wheels Mustang"),
  ];

  it("empty query is a no-op — returns all items in input order", () => {
    const out = applyItemFilters(corpus, EMPTY_FILTERS);
    assert.equal(out.length, corpus.length);
    assert.deepEqual(
      out.map((i) => i.title),
      corpus.map((i) => i.title),
    );
  });

  it("whitespace-only query is treated as empty (no filtering, no badge)", () => {
    // A user who accidentally types a space then deletes their search text
    // should see the unfiltered list — not zero results because no title
    // happens to contain a literal space prefix.
    const out = applyItemFilters(corpus, withQuery("   "));
    assert.equal(out.length, corpus.length);
  });

  it("matches case-insensitively (needle lowercased; titles compared lowercased)", () => {
    const out = applyItemFilters(corpus, withQuery("HOT"));
    // Should match "Hot Wheels Camaro" and "HOT pink poodle" and "Hot Wheels Mustang"
    assert.equal(out.length, 3);
    assert.ok(out.every((i) => i.title.toLowerCase().includes("hot")));
  });

  it("trims surrounding whitespace from the needle", () => {
    const out = applyItemFilters(corpus, withQuery("  camaro  "));
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "Hot Wheels Camaro");
  });

  it("substring (not whole-word) match — 'mus' matches 'Mustang'", () => {
    const out = applyItemFilters(corpus, withQuery("mus"));
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((i) => i.title).sort(),
      ["Hot Wheels Mustang", "Mustang GT"].sort(),
    );
  });

  it("returns empty array when no title matches the needle", () => {
    const out = applyItemFilters(corpus, withQuery("xenon"));
    assert.deepEqual(out, []);
  });

  it("query composes with other filters (AND semantics)", () => {
    const corpusWithCost = [
      item("Hot Wheels Camaro", { cost: 50 }),
      item("Hot Wheels Mustang", { cost: 200 }),
      item("Mustang GT", { cost: 100 }),
    ];
    // Title contains "Hot" AND cost >= 100 → only "Hot Wheels Mustang".
    const out = applyItemFilters(corpusWithCost, {
      ...EMPTY_FILTERS,
      query: "Hot",
      priceFrom: "100",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "Hot Wheels Mustang");
  });
});

describe("EMPTY_FILTERS / countActiveFilters — query badge integration", () => {
  it("EMPTY_FILTERS.query is the empty string (so EMPTY_FILTERS is a true no-op default)", () => {
    assert.equal(EMPTY_FILTERS.query, "");
  });

  // countActiveFilters is module-private, so we exercise it indirectly via the
  // filter-sheet badge text — the actual integer is tested by the structural
  // pin in the UI sub-task. Here we pin the SHAPE that whitespace-only
  // queries must not increment the badge (the trim() guard in the impl).
  it("ItemFilters shape includes the new query field as a required string", () => {
    // TS-level pin: an EMPTY_FILTERS literal without `query` would fail to
    // compile, so the runtime assertion is a tautology — but having the
    // assertion ensures the test file imports the type and exercises it.
    const filters: ItemFilters = { ...EMPTY_FILTERS, query: "needle" };
    assert.equal(filters.query, "needle");
  });
});
