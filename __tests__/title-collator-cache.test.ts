import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { applySortMode, getTitleCollator } from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";

/**
 * `applySortMode` used to call `a.title.localeCompare(b.title, undefined, {…})`
 * inside the comparator. That constructs a fresh `Intl.Collator` on EVERY
 * pair-compare — O(n log n) ICU collator constructions per sort, each walking
 * the collation tables. `getTitleCollator()` hoists one instance per locale.
 *
 * The risk in that swap is silent re-ordering: `collator.compare` only matches
 * the old behaviour if the options are carried across verbatim. So these tests
 * pin the ORDERING semantics (case-folding, accent-folding, numeric) as much as
 * the caching, because a dropped option compiles fine and quietly reshuffles
 * every sorted collection.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function item(id: string, title: string): CollectableItem {
  return {
    id,
    collectionId: "c1",
    title,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as CollectableItem;
}

function titles(items: CollectableItem[]): string[] {
  return items.map((i) => i.title);
}

describe("getTitleCollator — instance caching", () => {
  it("returns the SAME instance across calls (the point of the change)", () => {
    assert.equal(getTitleCollator(), getTitleCollator());
  });

  it("treats an omitted locale and an explicit undefined as one cache slot", () => {
    assert.equal(getTitleCollator(), getTitleCollator(undefined));
  });

  it("keys distinct locales to distinct instances", () => {
    // Forward-compat: the locale-threading task will pass a real BCP-47 tag,
    // and a single shared instance would then apply German rules to Polish.
    assert.notEqual(getTitleCollator("de"), getTitleCollator("pl"));
    assert.equal(getTitleCollator("de"), getTitleCollator("de"));
  });

  it("does not collide the default slot with a literal empty-string locale", () => {
    // `""` is the sentinel for "runtime default" in the Map. It must not be
    // reachable as a caller-supplied locale meaning something else.
    const fromDefault = getTitleCollator();
    const fromEmpty = getTitleCollator("");
    assert.equal(fromDefault, fromEmpty);
  });

  it("carries sensitivity: base and numeric: true", () => {
    const opts = getTitleCollator().resolvedOptions();
    assert.equal(opts.sensitivity, "base");
    assert.equal(opts.numeric, true);
  });
});

describe("applySortMode — ordering is unchanged by the collator swap", () => {
  it("sorts ascending by title", () => {
    const sorted = applySortMode([item("1", "Zebra"), item("2", "Apple")], "name-asc");
    assert.deepEqual(titles(sorted), ["Apple", "Zebra"]);
  });

  it("sorts descending by title", () => {
    const sorted = applySortMode([item("1", "Apple"), item("2", "Zebra")], "name-desc");
    assert.deepEqual(titles(sorted), ["Zebra", "Apple"]);
  });

  it("folds case (sensitivity: base) — 'apple' and 'Apple' are not separated", () => {
    // With the default sensitivity, "Banana" would wedge between "apple" and
    // "Apple" in some locales. Dropping the option is the silent regression.
    const sorted = applySortMode(
      [item("1", "banana"), item("2", "Apple"), item("3", "apple")],
      "name-asc",
    );
    assert.deepEqual(titles(sorted).slice(2), ["banana"]);
    assert.deepEqual(new Set(titles(sorted).slice(0, 2)), new Set(["Apple", "apple"]));
  });

  it("compares numerically — 'Card 2' precedes 'Card 10'", () => {
    // Lexicographically "Card 10" < "Card 2". Losing `numeric: true` inverts
    // every numbered set in the app (card runs, issue numbers, volumes).
    const sorted = applySortMode(
      [item("1", "Card 10"), item("2", "Card 2"), item("3", "Card 1")],
      "name-asc",
    );
    assert.deepEqual(titles(sorted), ["Card 1", "Card 2", "Card 10"]);
  });

  it("folds accents — 'Écu' sorts with 'ecu', not after 'Z'", () => {
    const sorted = applySortMode([item("1", "Zebra"), item("2", "Écu")], "name-asc");
    assert.deepEqual(titles(sorted), ["Écu", "Zebra"]);
  });

  it("returns the input reference untouched for the default mode", () => {
    // The identity path is what lets the upstream useMemo bail out — the
    // collator must not be constructed or applied at all here.
    const input = [item("1", "Zebra"), item("2", "Apple")];
    assert.equal(applySortMode(input, "default"), input);
  });

  it("does not mutate the input array", () => {
    const input = [item("1", "Zebra"), item("2", "Apple")];
    applySortMode(input, "name-asc");
    assert.deepEqual(titles(input), ["Zebra", "Apple"]);
  });

  it("is stable across repeated calls (the shared instance is not stateful)", () => {
    const input = [item("1", "Zebra"), item("2", "Apple"), item("3", "Mango")];
    const first = titles(applySortMode(input, "name-asc"));
    const second = titles(applySortMode(input, "name-asc"));
    assert.deepEqual(first, second);
  });

  it("handles an empty and a single-item list", () => {
    assert.deepEqual(applySortMode([], "name-asc"), []);
    assert.deepEqual(titles(applySortMode([item("1", "Solo")], "name-desc")), ["Solo"]);
  });
});

describe("lib/item-filters.ts — the per-call construction is gone for good", () => {
  const src = read("lib/item-filters.ts");

  it("no longer calls localeCompare in the sort comparator", () => {
    // The whole point: a reintroduced `localeCompare` inside the comparator
    // restores the O(n log n) collator construction with no visible symptom.
    // Scans CODE lines only — the doc comments legitimately name
    // `String.prototype.localeCompare` as the thing they replaced, and a
    // naive source-wide grep would flag its own rationale.
    const offending = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*"))
      .filter(({ line }) => /\.localeCompare\(/.test(line));
    assert.deepEqual(
      offending,
      [],
      `a localeCompare() call is back — route through getTitleCollator() (${offending
        .map((o) => `L${o.no}`)
        .join(", ")})`,
    );
  });

  it("hoists the collator OUT of the comparator, not inside it", () => {
    // `const collator = getTitleCollator()` must sit above `.sort(`; calling it
    // inside the arrow would keep one Map lookup per pair-compare.
    assert.match(
      src,
      /const\s+collator\s*=\s*getTitleCollator\(locale\);\s*\n\s*const\s+sorted\s*=\s*\[\.\.\.items\]\.sort\(/,
    );
    assert.match(src, /\.sort\(\(a,\s*b\)\s*=>\s*collator\.compare\(a\.title,\s*b\.title\)\)/);
  });

  it("caches through a module-scoped Map, not a single bare instance", () => {
    // A single bare instance would be a locale bug waiting for the threading
    // task: the app supports six languages.
    assert.match(src, /const\s+collatorCache\s*=\s*new\s+Map<string,\s*Intl\.Collator>\(\)/);
  });

  it("constructs the collator exactly once in the source", () => {
    const constructions = src.match(/new\s+Intl\.Collator\(/g) ?? [];
    assert.equal(constructions.length, 1, `expected 1 Intl.Collator construction, got ${constructions.length}`);
  });
});
