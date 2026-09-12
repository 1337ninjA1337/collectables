import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectionTotalCost, portfolioTotalCost } from "@/lib/collection-total";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem } from "@/lib/types";
import type { UsdRates } from "@/lib/currency-rates";

import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertValueInEveryLocale,
  localeValuesOf,
} from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The stats screen's headline figure, tested on values.
 *
 * It was the one total in the app that never converted: `ownedItems` reduced
 * into a bare `sum + i.cost`, rendered with `toLocaleString()` under a label
 * reading "Total value". A collector holding items priced in EUR, GBP and USD
 * got the sum of three different units, printed with no currency beside it,
 * on the same screen as collection cards that had converted those same
 * figures correctly.
 *
 * The property worth the most here is the one a user checks by hand: the
 * portfolio total is what you get by adding the collection cards up. That is
 * why `portfolioTotalCost` resolves an item with no `costCurrency` through its
 * COLLECTION's override before falling back to the viewer's display currency —
 * a plain `?? displayCurrency` passes every other case in this file and
 * silently disagrees with the cards for exactly the collections that set one.
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

/** No collection sets an override — the common case. */
const noOverrides = () => undefined;

describe("portfolioTotalCost — across currencies", () => {
  it("converts each item from its own stored currency", () => {
    // 10 USD + 10 EUR (= 20 USD at 0.5) + 10 GBP (= 40 USD at 0.25).
    const total = portfolioTotalCost(
      [
        item({ id: "a", collectionId: "c-1", cost: 10, costCurrency: "USD" }),
        item({ id: "b", collectionId: "c-2", cost: 10, costCurrency: "EUR" }),
        item({ id: "c", collectionId: "c-3", cost: 10, costCurrency: "GBP" }),
      ],
      noOverrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 70, currency: "USD", converted: 3, skipped: 0, approximate: false });
  });

  it("is not the raw sum the stats screen used to print", () => {
    // The old screen answered 30 here, in no currency at all. This is the
    // whole bug in one assertion.
    const items = [
      item({ id: "a", collectionId: "c-1", cost: 10, costCurrency: "USD" }),
      item({ id: "b", collectionId: "c-2", cost: 10, costCurrency: "EUR" }),
      item({ id: "c", collectionId: "c-3", cost: 10, costCurrency: "GBP" }),
    ];
    const raw = items.reduce((sum, i) => sum + (i.cost ?? 0), 0);

    assert.equal(raw, 30);
    assert.notEqual(portfolioTotalCost(items, noOverrides, "USD", RATES).amount, raw);
  });

  it("reports the target currency, not whichever one the items happened to use", () => {
    const total = portfolioTotalCost(
      [item({ cost: 10, costCurrency: "GBP" })],
      noOverrides,
      "EUR",
      RATES,
    );

    // 10 GBP is 40 USD is 20 EUR.
    assert.deepEqual(total, { amount: 20, currency: "EUR", converted: 1, skipped: 0, approximate: false });
  });

  it("counts an unconvertible currency as skipped rather than as zero", () => {
    const total = portfolioTotalCost(
      [
        item({ id: "a", cost: 10, costCurrency: "USD" }),
        item({ id: "b", cost: 999, costCurrency: "XYZ" }),
      ],
      noOverrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 1, approximate: false });
  });

  it("drops NaN, Infinity, null and absent costs without poisoning the sum", () => {
    const total = portfolioTotalCost(
      [
        item({ id: "a", cost: 10, costCurrency: "USD" }),
        item({ id: "b", cost: NaN, costCurrency: "USD" }),
        item({ id: "c", cost: Infinity, costCurrency: "USD" }),
        item({ id: "d", cost: -Infinity, costCurrency: "USD" }),
        item({ id: "e", cost: null, costCurrency: "USD" }),
        item({ id: "f", costCurrency: "USD" }),
      ],
      noOverrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("keeps zero and negative costs, which are prices", () => {
    const total = portfolioTotalCost(
      [
        item({ id: "a", cost: 0, costCurrency: "USD" }),
        item({ id: "b", cost: -5, costCurrency: "USD" }),
      ],
      noOverrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: -5, currency: "USD", converted: 2, skipped: 0, approximate: false });
  });

  it("totals nothing to zero in the target currency", () => {
    assert.deepEqual(portfolioTotalCost([], noOverrides, "EUR", RATES), {
      amount: 0,
      currency: "EUR",
      converted: 0,
      skipped: 0,
      approximate: false,
    });
  });
});

describe("portfolioTotalCost — the collection's currency override", () => {
  const overrides = (collectionId: string) => (collectionId === "c-eur" ? "EUR" : undefined);

  it("resolves an item with no stored currency through its collection", () => {
    // 10 in a EUR-labelled collection is 10 EUR, which is 20 USD — not 10 USD.
    const total = portfolioTotalCost(
      [item({ collectionId: "c-eur", cost: 10 })],
      overrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 20, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("lets the item's own stored currency win over its collection's label", () => {
    const total = portfolioTotalCost(
      [item({ collectionId: "c-eur", cost: 10, costCurrency: "USD" })],
      overrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("falls back to the viewer's currency for a collection with no override", () => {
    const total = portfolioTotalCost(
      [item({ collectionId: "c-plain", cost: 10 })],
      overrides,
      "USD",
      RATES,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: false });
  });

  it("adds up to what the collection cards show — the property a user checks by hand", () => {
    // Two collections, one labelled EUR, holding items with no stored
    // currency of their own. Each card totals in its own label; the portfolio
    // figure must be those two, converted into the viewer's currency.
    const eurItems = [item({ id: "a", collectionId: "c-eur", cost: 10 })];
    const usdItems = [item({ id: "b", collectionId: "c-plain", cost: 30 })];

    const eurCard = collectionTotalCost(eurItems, "EUR", RATES);
    const usdCard = collectionTotalCost(usdItems, "USD", RATES);
    assert.deepEqual(eurCard, { amount: 10, currency: "EUR", converted: 1, skipped: 0, approximate: false });
    assert.deepEqual(usdCard, { amount: 30, currency: "USD", converted: 1, skipped: 0, approximate: false });

    const portfolio = portfolioTotalCost([...eurItems, ...usdItems], overrides, "USD", RATES);
    // 10 EUR is 20 USD; plus the 30 USD card.
    assert.equal(portfolio.amount, 50);
    assert.equal(portfolio.currency, "USD");
  });

  it("would disagree with the cards if the override were ignored", () => {
    // The negative case for the bullet above: a `?? displayCurrency` fallback
    // reads the EUR collection's 10 as 10 USD and answers 40.
    const items = [
      item({ id: "a", collectionId: "c-eur", cost: 10 }),
      item({ id: "b", collectionId: "c-plain", cost: 30 }),
    ];

    assert.equal(portfolioTotalCost(items, overrides, "USD", RATES).amount, 50);
    assert.equal(portfolioTotalCost(items, noOverrides, "USD", RATES).amount, 40);
  });
});

describe("portfolioTotalCost — before the rates land", () => {
  it("sums raw amounts and marks the total approximate", () => {
    // The same deliberate lie of convenience collectionTotalCost documents:
    // better than blanking the headline while the rate table loads.
    const total = portfolioTotalCost(
      [
        item({ id: "a", cost: 10, costCurrency: "EUR" }),
        item({ id: "b", cost: 5, costCurrency: "GBP" }),
      ],
      noOverrides,
      "USD",
      null,
    );

    assert.deepEqual(total, { amount: 15, currency: "USD", converted: 2, skipped: 0, approximate: true });
  });

  it("still drops non-finite costs with no rates", () => {
    const total = portfolioTotalCost(
      [item({ id: "a", cost: 10 }), item({ id: "b", cost: NaN })],
      noOverrides,
      "USD",
      null,
    );

    assert.deepEqual(total, { amount: 10, currency: "USD", converted: 1, skipped: 0, approximate: true });
  });
});

describe("the two totals share one implementation", () => {
  const SRC = stripComments(readRepoFile("lib/collection-total.ts"));

  it("both delegate the arithmetic to sumEntries", () => {
    const calls = SRC.match(/sumEntries\(/g) ?? [];
    // One declaration plus the two call sites.
    assert.equal(calls.length, 3, "collectionTotalCost and portfolioTotalCost must both delegate");
  });

  it("the no-rates branch is written once", () => {
    const reduces = SRC.match(/entries\.reduce\(/g) ?? [];
    assert.equal(reduces.length, 1, "a second copy of the no-rates judgement call is how two screens drift");
  });

  it("agrees with collectionTotalCost when every item is in the target currency", () => {
    const items = [
      item({ id: "a", cost: 10, costCurrency: "USD" }),
      item({ id: "b", cost: 5, costCurrency: "EUR" }),
    ];

    assert.deepEqual(
      portfolioTotalCost(items, noOverrides, "USD", RATES),
      collectionTotalCost(items, "USD", RATES),
    );
  });
});

describe("the provider hands the screen a value, not the arithmetic", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("memoises the owned total on the things it depends on", () => {
    assert.match(
      SRC,
      /\}, \[collections, collectionsById, itemsByCollection, displayCurrency, currencyRates\]\);/,
    );
  });

  it("builds it from the live-item index rather than re-filtering every visible item", () => {
    // itemsByCollection is already isLiveItem-filtered, and walking owned
    // collections skips friends' / subscriptions' / shares' items instead of
    // testing each one.
    assert.match(SRC, /const ownedTotalCost = useMemo\(\(\) => \{/);
    assert.match(SRC, /if \(collection\.role !== "owner"\) continue;/);
    assert.match(SRC, /itemsByCollection\.get\(collection\.id\)/);
  });

  it("passes the collection's currency override through as the per-item fallback", () => {
    assert.match(SRC, /\(collectionId\) => collectionsById\.get\(collectionId\)\?\.currency,/);
  });

  it("puts it on the context value and in its dep list", () => {
    assert.match(SRC, /^\s+ownedTotalCost,$/m);
    assert.match(SRC, /collectionTotals, ownedTotalCost,/);
  });
});

describe("the stats screen renders a converted, labelled total", () => {
  const SRC = stripComments(readRepoFile("app/stats.tsx"));

  it("reads ownedTotalCost from the context", () => {
    assert.match(SRC, /const \{ collections, items, ownedTotalCost, refresh \} = useCollections\(\);/);
  });

  it("no longer reduces raw costs into a headline number", () => {
    assert.doesNotMatch(SRC, /reduce\(\(sum, i\) => sum \+ i\.cost/);
    assert.doesNotMatch(SRC, /totalValue/);
    // toLocaleString() on a bare number is how the figure got printed with no
    // currency at all.
    assert.doesNotMatch(SRC, /toLocaleString\(\)/);
  });

  it("renders the amount through CostBadge so the currency travels with it", () => {
    assert.match(SRC, /import \{ CostBadge \} from "@\/components\/cost-badge";/);
    assert.match(SRC, /amount=\{ownedTotalCost\.amount\}/);
    assert.match(SRC, /currency=\{ownedTotalCost\.currency\}/);
  });

  it("keeps the em-dash for a portfolio with nothing priced", () => {
    assert.match(SRC, /ownedTotalCost\.amount > 0 \? \(/);
    assert.match(SRC, /—/);
  });

  it("says so when some items could not be converted", () => {
    assert.match(SRC, /ownedTotalCost\.skipped > 0 \? \(/);
    assert.match(SRC, /t\("statsTotalValuePartial", \{ count: ownedTotalCost\.skipped \}\)/);
  });

  it("drops the hasFiniteCost import it no longer uses", () => {
    // The filter moved into portfolioTotalCost; a leftover import is the
    // shape that invites a second inline sum beside the shared one.
    assert.doesNotMatch(SRC, /hasFiniteCost/);
  });
});

describe("statsTotalValuePartial is translated everywhere", () => {
  const SRC = readI18nSource();

  it("is declared by every locale rather than inherited from en", () => {
    // A hint saying an incomplete sum is incomplete, served in English under
    // somebody else's flag, is the same defect one layer up.
    assertDeclaredInEveryLocale(SRC, "statsTotalValuePartial");
  });

  it("takes the skipped count as a param in every locale", () => {
    assertValueInEveryLocale(
      SRC,
      "statsTotalValuePartial",
      /params\?\.count/,
      "a hint that does not say how many is not a hint",
    );
  });

  it("says it with that locale's own words, not the English one pasted six times", () => {
    // Against `values.length` rather than a literal 6: a seventh language
    // should make this case ask about seven locales, not report "expected 6,
    // got 7" as though the new locale were the defect.
    const values = [...localeValuesOf(SRC, "statsTotalValuePartial").values()];
    assert.ok(values.length > 0);
    assert.equal(
      new Set(values).size,
      values.length,
      "two locales carry the identical formatter",
    );
  });
});
