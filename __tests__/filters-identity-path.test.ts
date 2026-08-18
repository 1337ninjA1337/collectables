/**
 * Pins the "identity path on the no-op input" optimisation for
 * `applyItemFilters`, and the `hasActiveMatchers` / `countActiveFilters`
 * relationship it rests on.
 *
 * `applySortMode(items, "default")` already returned the input reference
 * unchanged; `applyItemFilters` did not — `.filter()` allocates a fresh array
 * even when the predicate accepts every element, so an unfiltered collection
 * produced a new reference every time the `[allItems, itemFilters]` memo
 * re-ran. Downstream, `useChunkedList` resets its window to page one on an
 * `items` reference change, so the wasted allocation threw a user who had
 * scrolled deep into an unfiltered collection back to the top whenever a new
 * (still-empty) `ItemFilters` object was produced.
 *
 * The subtle half is which fields gate the short-circuit. `countActiveFilters`
 * counts `sort`, which `applyItemFilters` does not read — gating on the count
 * would skip the identity path for a sorted-but-unfiltered collection, the
 * single most common non-empty state. `hasActiveMatchers` is the count minus
 * that one clause, and the parity block below is what keeps the difference
 * deliberate instead of drifting.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  applyItemFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  hasActiveMatchers,
  type ItemFilters,
} from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";
import { readRepoFile } from "./helpers/repo-file";

function item(title: string, overrides: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: title.toLowerCase(),
    collectionId: "c1",
    title,
    acquiredAt: "2025-01-01",
    acquiredFrom: "shop",
    description: "",
    variants: "",
    photos: [],
    createdBy: "u1",
    createdByUserId: "u1",
    createdAt: "2026-05-23",
    ...overrides,
  };
}

const ITEMS = [item("Alpha", { cost: 5 }), item("Beta", { cost: 50 })];

/**
 * One entry per field of `ItemFilters`, each with a value that makes that
 * field active. Drives the parity block so a field added to the type without
 * a decision about which side of the matcher/count line it falls on shows up
 * as a failure here.
 */
const ACTIVE_BY_FIELD: { [K in keyof ItemFilters]: ItemFilters[K] } = {
  priceFrom: "10",
  priceTo: "99",
  dateFrom: "2024-01-01",
  dateTo: "2026-12-31",
  source: "ebay",
  hasPhotos: true,
  query: "alpha",
  sort: "name-asc",
};

/** The one field `applyItemFilters` deliberately ignores. */
const SORT_ONLY_FIELD: keyof ItemFilters = "sort";

describe("applyItemFilters — identity path on the no-op input", () => {
  it("returns the SAME reference for EMPTY_FILTERS (no allocation)", () => {
    assert.equal(applyItemFilters(ITEMS, EMPTY_FILTERS), ITEMS);
  });

  it("returns the same reference for a sorted-but-unfiltered state", () => {
    // The case gating on `countActiveFilters` would have missed: the badge
    // says 1, but the filter pass is still a pure no-op.
    const sorted: ItemFilters = { ...EMPTY_FILTERS, sort: "cost-desc" };
    assert.equal(countActiveFilters(sorted), 1);
    assert.equal(applyItemFilters(ITEMS, sorted), ITEMS);
  });

  it("returns the same reference for a whitespace-only query", () => {
    // `applyItemFilters` already treated `"   "` as no search, so it must not
    // block the identity path either.
    assert.equal(applyItemFilters(ITEMS, { ...EMPTY_FILTERS, query: "   " }), ITEMS);
  });

  it("allocates a NEW array as soon as any matcher is active", () => {
    for (const field of Object.keys(ACTIVE_BY_FIELD) as (keyof ItemFilters)[]) {
      if (field === SORT_ONLY_FIELD) continue;
      const filters = { ...EMPTY_FILTERS, [field]: ACTIVE_BY_FIELD[field] } as ItemFilters;
      assert.notEqual(
        applyItemFilters(ITEMS, filters),
        ITEMS,
        `${field} is active but applyItemFilters returned the input reference`,
      );
    }
  });

  it("still filters correctly once a matcher is active", () => {
    // The short-circuit must not swallow a real filter pass.
    const out = applyItemFilters(ITEMS, { ...EMPTY_FILTERS, priceFrom: "10" });
    assert.deepEqual(
      out.map((i) => i.title),
      ["Beta"],
    );
  });

  it("does not mutate or alias-corrupt on the identity path", () => {
    // Returning the input means the CALLER now shares the array. Nothing in
    // the function may write to it, or a "filter" would edit the source list.
    const input = [...ITEMS];
    const out = applyItemFilters(input, EMPTY_FILTERS);
    assert.equal(out, input);
    assert.deepEqual(input.map((i) => i.title), ["Alpha", "Beta"]);
  });

  it("handles an empty collection on both paths", () => {
    const empty: CollectableItem[] = [];
    assert.equal(applyItemFilters(empty, EMPTY_FILTERS), empty);
    assert.deepEqual(applyItemFilters(empty, { ...EMPTY_FILTERS, source: "x" }), []);
  });
});

describe("hasActiveMatchers — the count, minus sort, and nothing else", () => {
  it("is false for EMPTY_FILTERS", () => {
    assert.equal(hasActiveMatchers(EMPTY_FILTERS), false);
  });

  it("agrees with countActiveFilters field by field, differing ONLY on sort", () => {
    for (const field of Object.keys(ACTIVE_BY_FIELD) as (keyof ItemFilters)[]) {
      const filters = { ...EMPTY_FILTERS, [field]: ACTIVE_BY_FIELD[field] } as ItemFilters;
      assert.equal(countActiveFilters(filters), 1, `${field} did not register in the badge count`);
      assert.equal(
        hasActiveMatchers(filters),
        field !== SORT_ONLY_FIELD,
        `${field} disagrees between hasActiveMatchers and the matcher set`,
      );
    }
  });

  it("covers every field of ItemFilters (a new field cannot slip past)", () => {
    assert.deepEqual(
      Object.keys(ACTIVE_BY_FIELD).sort(),
      Object.keys(EMPTY_FILTERS).sort(),
      "ACTIVE_BY_FIELD is out of sync with ItemFilters — decide the new field's side",
    );
  });

  it("treats a whitespace-only query as inactive, like the badge count does", () => {
    const blank = { ...EMPTY_FILTERS, query: "   " };
    assert.equal(hasActiveMatchers(blank), false);
    assert.equal(countActiveFilters(blank), 0);
  });

  it("stays true when several matchers are active at once", () => {
    assert.equal(hasActiveMatchers({ ...EMPTY_FILTERS, source: "ebay", hasPhotos: true }), true);
  });
});

describe("the audit the task asked for — other pure-helper array modules", () => {
  /**
   * The task was "audit other pure-helper modules for the same identity
   * path". The audit's finding is recorded as an assertion rather than a
   * comment so it is re-checked rather than trusted: `applyItemFilters` is the
   * ONLY array-transforming lib helper consumed through a `useMemo`, which is
   * where reference stability buys anything. The other candidates
   * (`removeListingById`, `removeViewerFromSharedIds`, `mergePinnedCurrencies`,
   * `remapsOnly`) all take `readonly T[]` and return a mutable `T[]`, so
   * returning the input is not even type-legal — and each runs once per user
   * action, not once per render, so the copy is not on a hot path.
   */
  const SCREEN_DIRS = ["app", "components"];

  function sourceFiles(dir: string): string[] {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        const full = path.join(d, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
    };
    walk(path.join(process.cwd(), dir));
    return out;
  }

  it("applyItemFilters is still the only lib array helper wrapped in a useMemo", () => {
    // If a second one appears, it inherits this task: decide whether it needs
    // an identity path before the allocation reaches a render loop.
    const memoized = new Set<string>();
    for (const dir of SCREEN_DIRS) {
      for (const file of sourceFiles(dir)) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/useMemo\(\(\)\s*=>\s*([a-zA-Z_$][\w$]*)\(/g)) {
          memoized.add(m[1]);
        }
      }
    }
    assert.ok(memoized.has("applyItemFilters"), "applyItemFilters is no longer memoized — re-audit");
    // Helpers that return a NEW array from an array input. Anything else in
    // the memo set returns a scalar/object and cannot benefit from identity.
    const arrayHelpers = [...memoized].filter((name) =>
      ["applyItemFilters", "applySortMode", "coerceListings", "remapsOnly", "removeListingById"].includes(
        name,
      ),
    );
    assert.deepEqual(
      arrayHelpers.sort(),
      ["applyItemFilters"],
      `a new array helper is memoized without an identity-path decision: ${arrayHelpers.join(", ")}`,
    );
  });

  it("the identity path is documented where the short-circuit lives", () => {
    // The line is a one-liner that reads like a micro-optimisation; without
    // the note explaining the useChunkedList reset it is a prime candidate for
    // a "simplify" pass to delete.
    const src = readRepoFile("lib/item-filters.ts");
    const idx = src.indexOf("if (!hasActiveMatchers(filters)) return items;");
    assert.ok(idx > 0, "the identity short-circuit is gone");
    const doc = src.slice(Math.max(0, idx - 1200), idx).replace(/\s+/g, " ");
    assert.match(doc, /useChunkedList/, "the comment never names the memo it protects");
    assert.match(doc, /reference/i, "the comment never explains that the REFERENCE is the point");
  });
});
