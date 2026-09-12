import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectionTotalCost } from "@/lib/collection-total";
import type { UsdRates } from "@/lib/currency-rates";
import {
  buildCollectionExportHtml,
  type ExportLabels,
  type ExportMoney,
} from "@/lib/export-pdf-html";
import { convertItemCost } from "@/lib/item-cost";
import { readI18nSource } from "./helpers/i18n-source-file";
import { localeValuesOf } from "./helpers/i18n-locales";
import { stripComments } from "@/lib/strip-comments";
import type { CollectableItem, Collection } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The money in the exported document.
 *
 * The PDF is the one output a user keeps, mails and files, and it was the one
 * place in the app that converted nothing: the builder summed raw `cost`
 * fields itself, printed the result as a bare number beside a "Total cost"
 * label, and printed each item's cost as `${item.cost}` with no currency and
 * no thousands separator. A collection holding items in EUR and USD filed one
 * figure in no unit at all — and `collection.currency`, the per-collection
 * override that reaches every screen in the app, reached this document not at
 * all, because the builder never read the field.
 *
 * **Why the caller resolves the money.** The conversion needs the USD rate
 * table, which lives in the provider behind a fetch and a cache. Taking the
 * ANSWERS rather than the rates keeps the document pure AND gets something
 * better than two implementations that agree today: the PDF prints the figures
 * the screen printed, because they are literally the same values.
 */

const LABELS: ExportLabels = {
  acquiredHow: "Acquired how",
  acquiredDate: "Acquired date",
  description: "Description",
  variants: "Variants",
  costLabel: "Cost",
  totalCost: "Total cost",
  exportPdfItemCount: "Items",
  photosSaved: "Photos",
};

const PRINTED_ON = new Date("2026-01-02T03:04:05Z");

const RATES: UsdRates = { USD: 1, EUR: 0.5, GBP: 0.25 };

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "Vinyl",
    coverPhoto: "",
    description: "",
    ownerName: "Ann",
    ownerUserId: "u1",
    sharedWith: [],
    sharedWithUserIds: [],
    role: "owner",
    visibility: "private",
    ...overrides,
  };
}

function item(overrides: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: "i1",
    collectionId: "c1",
    title: "Kind of Blue",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "Ann",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Exactly what `app/collection/[id].tsx` hands the builder. */
function money(
  items: CollectableItem[],
  col: Collection,
  rates: UsdRates | null = RATES,
  displayCurrency = "USD",
): ExportMoney {
  const target = col.currency ?? displayCurrency;
  return {
    total: collectionTotalCost(items, target, rates),
    itemCost: (i) => convertItemCost(i, target, rates),
  };
}

const render = (
  items: CollectableItem[],
  col: Collection = collection(),
  rates: UsdRates | null = RATES,
  displayCurrency = "USD",
): string =>
  buildCollectionExportHtml(
    col,
    items,
    LABELS,
    money(items, col, rates, displayCurrency),
    PRINTED_ON,
  );

describe("the exported total carries a currency", () => {
  it("prints the amount and the code, not a bare number", () => {
    const html = render([item({ cost: 12, costCurrency: "USD" })]);

    assert.match(html, /<div class="stat-value">12 USD<\/div>\s*<div class="stat-label">Total cost<\/div>/);
  });

  it("converts across currencies instead of adding different units together", () => {
    // 10 USD + 10 EUR + 10 GBP. The old builder answered 30, in no unit.
    const html = render([
      item({ id: "a", cost: 10, costCurrency: "USD" }),
      item({ id: "b", cost: 10, costCurrency: "EUR" }),
      item({ id: "c", cost: 10, costCurrency: "GBP" }),
    ]);

    assert.match(html, /<div class="stat-value">70 USD<\/div>/);
    assert.doesNotMatch(html, /<div class="stat-value">30<\/div>/);
  });

  it("formats the total the way the rest of the app does", () => {
    // `formatCostAmount`, so a five-figure collection reads "12,500" rather
    // than "12500" — the in-app totals have had the separator since the
    // formatter was unified, and the printed one had not.
    const html = render([item({ cost: 12500, costCurrency: "USD" })]);

    assert.match(html, /<div class="stat-value">12,500 USD<\/div>/);
  });

  it("prints no total stat when nothing cost anything", () => {
    assert.ok(!render([item({ cost: null }), item({ id: "i2" })]).includes("Total cost"));
    // Zero is a cost somebody recorded, and it is still not a total worth a
    // stat card.
    assert.ok(!render([item({ cost: 0, costCurrency: "USD" })]).includes("Total cost"));
  });
});

describe("the collection's currency override reaches the document", () => {
  const eur = collection({ currency: "EUR" });

  it("totals in the collection's currency, not the viewer's", () => {
    // 10 USD is 5 EUR at these rates.
    const html = render([item({ cost: 10, costCurrency: "USD" })], eur);

    assert.match(html, /<div class="stat-value">5 EUR<\/div>/);
  });

  it("prices each item in it too", () => {
    const html = render([item({ cost: 10, costCurrency: "USD" })], eur);

    assert.match(html, /Cost<\/span><span>≈ 5 EUR<\/span>/);
  });

  it("treats an item with no stored currency as already being in it", () => {
    // The same `costCurrency ?? target` fallback the in-app totals document.
    const html = render([item({ cost: 10 })], eur);

    assert.match(html, /<div class="stat-value">10 EUR<\/div>/);
    assert.match(html, /Cost<\/span><span>10 EUR<\/span>/);
  });

  it("falls back to the viewer's display currency when the collection sets none", () => {
    const html = render([item({ cost: 10 })], collection(), RATES, "GBP");

    assert.match(html, /<div class="stat-value">10 GBP<\/div>/);
  });
});

describe("each item's cost cell", () => {
  it("carries its currency, which it never used to", () => {
    // `${item.cost}` before this round: "1500", with nothing saying of what.
    const html = render([item({ cost: 1500, costCurrency: "USD" })]);

    assert.match(html, /Cost<\/span><span>1,500 USD<\/span>/);
    assert.doesNotMatch(html, /<span>1500<\/span>/);
  });

  it("marks a converted figure with ≈ and leaves an unconverted one plain", () => {
    // The distinction is worth printing in a document somebody files: a figure
    // derived from a rate table on the day it was printed is not the price
    // that was paid.
    const converted = render([item({ cost: 10, costCurrency: "EUR" })]);
    assert.match(converted, /Cost<\/span><span>≈ 20 USD<\/span>/);

    const asStored = render([item({ cost: 10, costCurrency: "USD" })]);
    assert.match(asStored, /Cost<\/span><span>10 USD<\/span>/);
    assert.ok(!asStored.includes("≈"));
  });

  it("prints the raw stored amount and currency when the rate is missing", () => {
    // `convertItemCost` hands back the original rather than a wrong figure or
    // a blank, and the document must print what it was handed.
    const html = render([item({ cost: 10, costCurrency: "XYZ" })]);

    assert.match(html, /Cost<\/span><span>10 XYZ<\/span>/);
    assert.ok(!html.includes("≈"));
  });

  it("prints raw amounts before the rate table lands", () => {
    const html = render([item({ cost: 10, costCurrency: "EUR" })], collection(), null);

    // No rates: the item shows its own stored currency untouched, and the
    // header sums raw amounts into the target — the same convenience the
    // in-app totals take, now taken identically in the export.
    assert.match(html, /Cost<\/span><span>10 EUR<\/span>/);
    assert.match(html, /<div class="stat-value">10 USD<\/div>/);
  });

  it("omits the cell entirely for an item with no finite price", () => {
    for (const cost of [null, undefined, NaN, Infinity, -Infinity]) {
      const html = render([item({ cost })]);
      assert.ok(!html.includes("Cost</span>"), `a cost of ${String(cost)} printed a cell`);
      assert.doesNotMatch(html, /NaN|Infinity/);
    }
  });

  it("escapes the cell, because a currency code is a string from a row", () => {
    // The amount is a number and the code comes from `costCurrency`, which is
    // stored text. Nothing validates it on the way out of the database.
    const html = render([item({ cost: 10, costCurrency: '"><script>' })]);

    assert.ok(!html.includes("<script>"));
    assert.match(html, /&quot;&gt;&lt;script&gt;/);
  });
});

describe("the builder no longer does its own arithmetic", () => {
  const SRC = stripComments(readRepoFile("lib/export-pdf-html.ts"));

  it("summed the costs itself, and does not now", () => {
    assert.doesNotMatch(SRC, /reduce\(\(sum, item\) => sum \+ item\.cost/);
    assert.doesNotMatch(SRC, /\$\{item\.cost\}/, "the bare unformatted cost cell is back");
  });

  it("takes the answers rather than the rate table", () => {
    // Taking rates would make this module's signature about where rates come
    // from instead of about the document, and would be a second conversion
    // implementation to keep in step with the screen's.
    assert.doesNotMatch(SRC, /UsdRates/);
    assert.match(SRC, /money: ExportMoney,/);
  });

  it("still reads the shared finite-cost gate", () => {
    assert.match(SRC, /hasFiniteCost\(item\)/);
  });
});

describe("the screen hands over what it is already showing", () => {
  const SRC = stripComments(readRepoFile("app/collection/[id].tsx"));

  it("passes the memoised total rather than recomputing one", () => {
    assert.match(SRC, /total: getCollectionTotalCost\(collection\.id\),/);
  });

  it("passes the same per-item conversion CostBadge renders", () => {
    assert.match(
      SRC,
      /itemCost: \(item\) => convertItemCost\(item, collection\.currency \?\? undefined\),/,
    );
  });

  it("keeps both accessors in the callback's dep list", () => {
    assert.match(
      SRC,
      /\}, \[collection, allItems, getCollectionTotalCost, convertItemCost, t, toast\]\);/,
    );
  });
});

describe("the ≈ marker matches what the app renders", () => {
  it("is the whole of itemValueApprox in every locale", () => {
    // The builder emits the marker itself rather than taking a label, and the
    // argument for that is that the marker is a symbol rather than a word.
    // This is the case that checks the argument rather than the sentence.
    for (const [code, value] of localeValuesOf(readI18nSource(), "itemValueApprox")) {
      assert.match(
        value,
        /≈ \$\{params\?\.amount \?\? ""\} \$\{params\?\.currency \?\? ""\}/,
        `${code} spells the approx marker differently — the export must take a label instead`,
      );
    }
  });
});
