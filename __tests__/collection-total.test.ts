import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectionTotalCost, emptyCollectionTotal } from "@/lib/collection-total";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem } from "@/lib/types";
import type { UsdRates } from "@/lib/currency-rates";

import { readRepoFile } from "./helpers/repo-file";

/**
 * What a collection is worth, tested on values instead of on source text.
 *
 * The arithmetic lived inside the provider's `getCollectionTotalCost`
 * accessor, which meant it could only be pinned by matching this file's
 * characters — and it was: three cases asserted the shape of a `sumConverted`
 * call, a `const target = …` line and a returned object literal. What they
 * were really claiming is that a collection with a currency override totals in
 * that currency and not the viewer's, which is a question about numbers.
 *
 * It also re-ran on every call, and every `<CollectionCard>` calls it on every
 * render. The per-collection index made the INPUT cheap to find and did
 * nothing about the conversion, which is the expensive half; the provider
 * memoises a `Map<collectionId, CollectionTotalCost>` off it now.
 */

const RATES: UsdRates = { USD: 1, EUR: 0.5, GBP: 0.25 };

const item = (over: Partial<CollectableItem> = {}): CollectableItem => ({
  id: "i-1",
  collectionId: "c-1",
  title: "An item",
  acquiredAt: "",
  acquiredFrom: "",
  description: "",
  variants: "",
  photos: [],
  createdBy: "u-1",
  createdByUserId: "u-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("collectionTotalCost — with rates", () => {
  it("sums items already in the target currency", () => {
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10, costCurrency: "USD" }), item({ id: "b", cost: 5, costCurrency: "USD" })],
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 15, currency: "USD", converted: 2, skipped: 0, approximate: false });
  });

  it("converts an item stored in another currency", () => {
    // EUR is 0.5 USD-rate here, so 10 EUR is 20 USD.
    const total = collectionTotalCost([item({ cost: 10, costCurrency: "EUR" })], "USD", RATES);

    assert.deepEqual(total, { amount: 20, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("answers in the target currency, not the items'", () => {
    // The per-collection override is the caller's decision and arrives as
    // `target`; this is the half of it that has to hold for the card to be
    // labelled honestly.
    const total = collectionTotalCost([item({ cost: 10, costCurrency: "USD" })], "EUR", RATES);

    assert.equal(total.currency, "EUR");
    assert.equal(total.amount, 5);
  });

  it("assumes an item with no costCurrency is already in the target", () => {
    // The same fallback `convertItemCost` documents. Without it, an item
    // entered before the currency column existed would be converted out of a
    // currency it was never in.
    const total = collectionTotalCost([item({ cost: 10 })], "EUR", RATES);

    assert.deepEqual(total, { amount: 10, currency: "EUR", converted: 1, skipped: 0, approximate: false });
  });

  it("counts an unconvertible item as skipped rather than as zero", () => {
    // A currency with no rate is not worth nothing; it is worth an unknown
    // amount, and `skipped` is how the card can say the total is partial.
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10, costCurrency: "USD" }), item({ id: "b", cost: 99, costCurrency: "XYZ" })],
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 1, approximate: false });
  });
});

describe("collectionTotalCost — before the rates land", () => {
  it("sums raw amounts and marks the total approximate", () => {
    // The case shipped as "reports them as converted", which was true and was
    // the bug: a raw sum was indistinguishable from one that really converted
    // every item. Fine for a card that re-renders two seconds later, and not
    // for the PDF export, which is the one output a user keeps. `approximate`
    // is what a consumer that cannot re-render reads.
    // A deliberate lie of convenience: better than blanking the card while the
    // rate table loads, and the totals re-render for real once it arrives.
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10, costCurrency: "EUR" }), item({ id: "b", cost: 5, costCurrency: "USD" })],
      "USD",
      null,
    );

    assert.deepEqual(total, { amount: 15, currency: "USD", converted: 2, skipped: 0, approximate: true });
  });

  it("still answers in the target currency", () => {
    assert.equal(collectionTotalCost([item({ cost: 1 })], "PLN", null).currency, "PLN");
  });
});

describe("collectionTotalCost — what counts as a cost", () => {
  it("ignores an item with no cost at all", () => {
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10 }), item({ id: "b" }), item({ id: "c", cost: null })],
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("ignores a NaN cost instead of poisoning the whole total", () => {
    // `typeof NaN === "number"`, which is what this used to ask. One item
    // carrying it made the collection's total `NaN` and the card rendered it.
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10 }), item({ id: "b", cost: NaN })],
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("ignores an infinite cost", () => {
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10 }), item({ id: "b", cost: Infinity }), item({ id: "c", cost: -Infinity })],
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("keeps a zero cost, which is a price and not a missing one", () => {
    const total = collectionTotalCost([item({ cost: 0 })], "USD", RATES);

    assert.deepEqual(total, { amount: 0, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("keeps a negative cost", () => {
    // Not obviously meaningful, and not this function's call to make: nothing
    // in the app stops one being entered, so silently dropping it would make a
    // total disagree with the items a user can see.
    assert.equal(collectionTotalCost([item({ cost: -5 })], "USD", RATES).amount, -5);
  });

  it("answers an empty collection with a zero total in the target currency", () => {
    assert.deepEqual(collectionTotalCost([], "EUR", RATES), {
      amount: 0,
      currency: "EUR",
      converted: 0,
      skipped: 0,
      approximate: false,
    });
  });

  it("agrees with emptyCollectionTotal, which is what the accessor answers with", () => {
    // The empty answer is the general one rather than a shortcut that could
    // drift from it — this is the case that keeps them equal.
    assert.deepEqual(collectionTotalCost([], "EUR", RATES), emptyCollectionTotal("EUR"));
    assert.deepEqual(collectionTotalCost([], "EUR", null), emptyCollectionTotal("EUR"));
  });
});

describe("the provider computes each total once, not once per card", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("indexes the collections by id", () => {
    assert.match(
      SRC,
      /const collectionsById = useMemo\(\s*\(\) => new Map\(collections\.map\(\(collection\) => \[collection\.id, collection\]\)\),\s*\[collections\],\s*\);/,
    );
  });

  it("resolves a collection by lookup rather than by scanning the list", () => {
    assert.match(SRC, /getCollectionById: \(id\) => collectionsById\.get\(id\)/);
    assert.doesNotMatch(SRC, /collections\.find\(\(collection\) => collection\.id === id\)/);
  });

  it("memoises the totals on the four things a total depends on", () => {
    // The items, the rate table, the viewer's display currency and the
    // collections (for their overrides). None of those change on a render.
    assert.match(
      SRC,
      /\}, \[itemsByCollection, collectionsById, displayCurrency, currencyRates\]\);/,
    );
  });

  it("reads the collection's currency override when building each total", () => {
    assert.match(
      SRC,
      /const target = collectionsById\.get\(collectionId\)\?\.currency \?\? displayCurrency;/,
    );
  });

  it("the accessor is a lookup with an empty-total fallback", () => {
    assert.match(SRC, /collectionTotals\.get\(collectionId\) \?\?/);
    assert.match(
      SRC,
      /emptyCollectionTotal\(collectionsById\.get\(collectionId\)\?\.currency \?\? displayCurrency\)/,
    );
  });

  it("no longer does the arithmetic inline", () => {
    assert.doesNotMatch(SRC, /sumConverted\(/);
  });
});
