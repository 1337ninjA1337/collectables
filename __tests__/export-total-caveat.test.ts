import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectionTotalCost, emptyCollectionTotal, portfolioTotalCost } from "@/lib/collection-total";
import type { UsdRates } from "@/lib/currency-rates";
import {
  buildCollectionExportHtml,
  type ExportLabels,
  type ExportMoney,
} from "@/lib/export-pdf-html";
import { convertItemCost } from "@/lib/item-cost";
import { stripComments } from "@/lib/strip-comments";
import type { CollectableItem, Collection } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * A total in the exported document says when it does not mean what it looks
 * like.
 *
 * Two ways a total can be less than it appears, and the PDF stated neither.
 *
 * The first is `skipped`: the rate table existed and did not hold one of the
 * currencies in the collection, so those items are simply absent from the sum.
 * That field has been on the shape since the shape existed and nothing ever
 * rendered it except the stats screen.
 *
 * The second was invisible even to a caller that wanted to know. With no rate
 * table at all, `collectionTotalCost` summed raw amounts and reported them as
 * fully `converted` — indistinguishable from a total that really had converted
 * everything. That is a fine lie for a card which re-renders two seconds later,
 * and it is not fine for the one output a user keeps, mails and files: a
 * document exported during a cold start states a sum of three currencies as a
 * figure in one, permanently, with nothing on it saying so. Hence `approximate`.
 */

const RATES: UsdRates = { USD: 1, EUR: 0.5, GBP: 0.25 };

const LABELS: ExportLabels = {
  acquiredHow: "Acquired how",
  acquiredDate: "Acquired date",
  description: "Description",
  variants: "Variants",
  costLabel: "Cost",
  totalCost: "Total cost",
  exportPdfItemCount: "Items",
  photosSaved: "Photos",
  totalCostCaveat: "",
};

const collection = (over: Partial<Collection> = {}): Collection => ({
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
  ...over,
});

const item = (over: Partial<CollectableItem> = {}): CollectableItem => ({
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
  ...over,
});

describe("approximate", () => {
  it("is false when a rate table did the work", () => {
    const total = collectionTotalCost([item({ cost: 10, costCurrency: "EUR" })], "USD", RATES);
    assert.equal(total.approximate, false);
  });

  it("is true when raw amounts were summed for want of one", () => {
    // The figure is 20 either way; what changes is whether it means 20 USD.
    const total = collectionTotalCost(
      [item({ id: "a", cost: 10, costCurrency: "EUR" }), item({ id: "b", cost: 10, costCurrency: "GBP" })],
      "USD",
      null,
    );

    assert.equal(total.amount, 20);
    assert.equal(total.approximate, true);
  });

  it("is false with no rates and nothing priced, because zero is exact", () => {
    assert.equal(collectionTotalCost([], "USD", null).approximate, false);
    assert.equal(collectionTotalCost([item()], "USD", null).approximate, false);
  });

  it("agrees with emptyCollectionTotal, which the accessor falls back to", () => {
    assert.deepEqual(collectionTotalCost([], "EUR", null), emptyCollectionTotal("EUR"));
    assert.deepEqual(collectionTotalCost([], "EUR", RATES), emptyCollectionTotal("EUR"));
  });

  it("is a different question from skipped", () => {
    // `approximate` is about the TABLE; `skipped` about the currencies in it.
    // A total can be exact-but-partial, and that is the commoner case.
    const partial = collectionTotalCost(
      [item({ id: "a", cost: 10, costCurrency: "USD" }), item({ id: "b", cost: 5, costCurrency: "XYZ" })],
      "USD",
      RATES,
    );
    assert.equal(partial.approximate, false);
    assert.equal(partial.skipped, 1);

    const unrated = collectionTotalCost([item({ cost: 10, costCurrency: "EUR" })], "USD", null);
    assert.equal(unrated.approximate, true);
    assert.equal(unrated.skipped, 0);
  });

  it("is set the same way by the portfolio total", () => {
    // Both go through `sumEntries`, which is the reason the flag cannot drift
    // between the stats screen and a collection card.
    const noOverrides = () => undefined;
    assert.equal(portfolioTotalCost([item({ cost: 10 })], noOverrides, "USD", null).approximate, true);
    assert.equal(portfolioTotalCost([item({ cost: 10 })], noOverrides, "USD", RATES).approximate, false);
  });
});

describe("the document prints the caveat it is handed", () => {
  const render = (caveat: string, money: ExportMoney): string =>
    buildCollectionExportHtml(
      collection(),
      [item({ cost: 10, costCurrency: "USD" })],
      { ...LABELS, totalCostCaveat: caveat },
      money,
      new Date("2026-01-02T03:04:05Z"),
    );

  const moneyFor = (rates: UsdRates | null): ExportMoney => {
    const items = [item({ cost: 10, costCurrency: "USD" })];
    return {
      total: collectionTotalCost(items, "USD", rates),
      itemCost: (i) => convertItemCost(i, "USD", rates),
    };
  };

  it("renders it under the total", () => {
    const html = render("Summed without exchange rates.", moneyFor(null));
    assert.match(
      html,
      /<div class="stat-label">Total cost<\/div>\s*<div class="stat-caveat">Summed without exchange rates\.<\/div>/,
    );
  });

  it("prints no caveat element at all when the total is exact", () => {
    // An empty <div> under every total would be a line of whitespace on every
    // exported page, forever. Matched on the ELEMENT and not the class name:
    // `.stat-caveat` is in the stylesheet on every page whether or not the
    // document uses it, so `includes("stat-caveat")` is always true and would
    // have made this case unfailable.
    const html = render("", moneyFor(RATES));
    assert.ok(!html.includes('<div class="stat-caveat">'));
  });

  it("escapes it, because it is a translated string with a count in it", () => {
    const html = render('5 <items> & "more"', moneyFor(null));
    assert.ok(!html.includes("<items>"));
    assert.match(html, /5 &lt;items&gt; &amp; &quot;more&quot;/);
  });

  it("does not print it when there is no total to qualify", () => {
    const items = [item({ cost: null })];
    const html = buildCollectionExportHtml(
      collection(),
      items,
      { ...LABELS, totalCostCaveat: "Summed without exchange rates." },
      { total: collectionTotalCost(items, "USD", null), itemCost: (i) => convertItemCost(i, "USD", null) },
      new Date("2026-01-02T03:04:05Z"),
    );

    assert.ok(!html.includes("Total cost"));
    assert.ok(!html.includes('<div class="stat-caveat">'));
  });
});

describe("the screen picks which caveat it is", () => {
  const SRC = stripComments(readRepoFile("app/collection/[id].tsx"));

  it("reads the total once, for the labels and the document both", () => {
    // Two calls could straddle a rate table landing, printing a caveat about
    // a total that is no longer the one on the page.
    assert.match(SRC, /const exportTotal = getCollectionTotalCost\(collection\.id\);/);
    assert.match(SRC, /total: exportTotal,/);
  });

  it("lets the unconverted sentence win over the partial one", () => {
    // A total summed with NO rate table is a worse claim than one missing a
    // few currencies, so it wins when both could apply.
    assert.match(
      SRC,
      /totalCostCaveat: exportTotal\.approximate\s*\?\s*t\("exportTotalUnconverted"\)\s*:\s*exportTotal\.skipped > 0\s*\?\s*t\("exportTotalPartial", \{ count: exportTotal\.skipped \}\)\s*:\s*"",/,
    );
  });
});

describe("both caveats are translated everywhere", () => {
  const I18N = readI18nSource();

  for (const key of ["exportTotalUnconverted", "exportTotalPartial"] as const) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(I18N, key);
    });
  }

  it("the counted one reads its count", () => {
    for (const [code, value] of localeValuesOf(I18N, "exportTotalPartial")) {
      assert.ok(value.includes("params?.count"), `${code}'s partial caveat does not say how many`);
    }
  });

  it("the Slavic locales decline the counted noun", () => {
    for (const code of ["ru", "be", "pl"]) {
      assert.match(
        localeValuesOf(I18N, "exportTotalPartial").get(code) ?? "",
        /slavicPlural\(/,
        `${code} pins one noun form in a counted sentence`,
      );
    }
  });

  it("the two say different things in every locale", () => {
    // One says the table was missing, the other that it was incomplete. A
    // locale that collapsed them would lose the distinction the flag exists
    // for, in the document where it matters most.
    for (const [code, unconverted] of localeValuesOf(I18N, "exportTotalUnconverted")) {
      assert.notEqual(
        unconverted,
        localeValuesOf(I18N, "exportTotalPartial").get(code),
        `${code} uses one sentence for both`,
      );
    }
  });
});
