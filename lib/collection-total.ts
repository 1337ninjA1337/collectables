/**
 * What a collection is worth, as a pure function of its items.
 *
 * The sum lived inside the collections provider's `getCollectionTotalCost`
 * accessor, which meant three things at once: it could only be tested by
 * matching source text (the provider pulls React Native and cannot be mounted
 * under `tsx --test`), it re-ran on every call, and every `<CollectionCard>`
 * calls it on every render. Extracting it makes the arithmetic testable on
 * values and lets the provider compute each collection's total once per
 * change of the things a total actually depends on.
 *
 * **The currency the answer is in.** A collection can override the viewer's
 * app-wide `displayCurrency` (set from the edit modal, or the tap-to-swap chip
 * on the summary card), so the caller resolves the target and passes it in.
 * An item without its own `costCurrency` is assumed to already be in that
 * target — the same fallback `convertItemCost` documents.
 *
 * **Without rates, raw amounts are summed.** That is a deliberate lie of
 * convenience: it is better than blanking the card while the rate table loads,
 * and once the rates land the totals re-render with real conversion. It is
 * also only ever right when the items share a currency.
 *
 * It used to report that sum as fully `converted`, which made it
 * indistinguishable from a total that really had converted everything — fine
 * for a card that re-renders two seconds later, and not fine for the PDF
 * export, which is the one output a user keeps, mails and files. `approximate`
 * is how a consumer that cannot re-render tells the two apart; `skipped`
 * answers the other half, where the table existed and did not hold every
 * currency in it.
 */

import { sumConverted, type UsdRates } from "@/lib/currency-rates";
import { hasFiniteCost } from "@/lib/item-cost";
import { CollectableItem } from "@/lib/types";

export type CollectionTotalCost = {
  /** Sum of all item costs, converted to `currency`. */
  amount: number;
  /** Currency the amount is expressed in (the user's preferred display currency). */
  currency: string;
  /** Number of items whose cost was successfully converted. */
  converted: number;
  /** Number of items whose cost couldn't be converted (missing rate). */
  skipped: number;
  /**
   * True when the amount is a sum of RAW values because no rate table was
   * available — a figure in no single currency, labelled with one.
   *
   * The no-rates branch reported `converted: entries.length, skipped: 0`,
   * which is indistinguishable from a total that really did convert every
   * item. That is a fine lie for a card which re-renders two seconds later
   * with real conversion, and it is not fine for the PDF export, which is the
   * one output a user keeps, mails and files: a document filed during a cold
   * start states a sum of three currencies as a figure in one, permanently,
   * with nothing on it saying so.
   *
   * So the field exists for the consumers that cannot re-render. `skipped`
   * answers the other half — some items had no rate — and the two are
   * genuinely different: `approximate` is about the table, `skipped` about
   * the currencies in it.
   */
  approximate: boolean;
};

/**
 * The total for a collection that holds nothing priced — and the honest
 * answer for a collection id nothing knows about.
 *
 * Zero of zero items is not a special case: `sumConverted([])` returns exactly
 * this, so the empty answer is the general one rather than a shortcut that
 * could drift from it.
 */
export function emptyCollectionTotal(currency: string): CollectionTotalCost {
  // `approximate: false` and not "unknown": zero of zero items is exact in
  // every currency, so there is nothing here a rate table would have changed.
  return { amount: 0, currency, converted: 0, skipped: 0, approximate: false };
}

/**
 * Sum `items`' costs into `target`.
 *
 * `hasFiniteCost` rather than `typeof item.cost === "number"`, which is what
 * this used to ask: `NaN` and `Infinity` are both numbers, so a single item
 * carrying one made the whole collection's total `NaN` and the card rendered
 * it. The rest of the app has gone through `hasFiniteCost` — the shared gate
 * for "this item has a renderable cost" — since it was written; the collection
 * total was the one place still asking the weaker question.
 */
export function collectionTotalCost(
  items: readonly CollectableItem[],
  target: string,
  rates: UsdRates | null,
): CollectionTotalCost {
  return sumEntries(
    items.filter(hasFiniteCost).map((item) => ({
      amount: item.cost,
      currency: item.costCurrency ?? target,
    })),
    target,
    rates,
  );
}

/**
 * What EVERYTHING is worth — the same sum across items drawn from many
 * collections, each of which may label itself in a different currency.
 *
 * The stats screen was the one place in the app that totalled money without
 * converting it: it reduced raw `cost` fields into a bare number and labelled
 * the result "total value", so a collector holding items priced in EUR, GBP
 * and USD read the sum of three different units, printed with no currency at
 * all, beside collection cards that had converted the same figures correctly.
 *
 * **Why the collection's override is consulted per item and not just the
 * viewer's currency.** `collectionTotalCost` resolves a costless-currency item
 * as `item.costCurrency ?? target`, and for a collection card `target` IS that
 * collection's override. Reading the override here keeps the two answers
 * consistent: the portfolio total is the sum of the collection totals, which
 * is the property a user checks by adding the cards up, and the one a
 * per-item `?? displayCurrency` fallback would quietly break for exactly the
 * collections that set an override.
 *
 * `collectionCurrency` is a lookup rather than a map so the caller can hand
 * over the index it already has (`collectionsById.get(id)?.currency`) without
 * building a second one.
 */
export function portfolioTotalCost(
  items: readonly CollectableItem[],
  collectionCurrency: (collectionId: string) => string | null | undefined,
  target: string,
  rates: UsdRates | null,
): CollectionTotalCost {
  return sumEntries(
    items.filter(hasFiniteCost).map((item) => ({
      amount: item.cost,
      currency: item.costCurrency ?? collectionCurrency(item.collectionId) ?? target,
    })),
    target,
    rates,
  );
}

/**
 * The arithmetic both totals share: convert every entry into `target`, or sum
 * raw amounts when there is no rate table yet.
 *
 * Written once because the no-rates branch is a judgement call (see the module
 * header) and a second copy of a judgement call is how two screens end up
 * disagreeing about what an unconvertible item is worth.
 */
function sumEntries(
  entries: ReadonlyArray<{ amount: number; currency: string }>,
  target: string,
  rates: UsdRates | null,
): CollectionTotalCost {
  if (rates) {
    const { total, converted, skipped } = sumConverted(entries, target, rates);
    return { amount: total, currency: target, converted, skipped, approximate: false };
  }

  // No rates yet: sum raw amounts (assume each item is already in the target
  // currency). Better than blanking the UI; once rates load the totals
  // re-render with real conversion — and `approximate` is how a consumer that
  // will NOT re-render (the PDF export) can tell this apart from a total that
  // really converted. An empty list is exact either way.
  const amount = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return {
    amount,
    currency: target,
    converted: entries.length,
    skipped: 0,
    approximate: entries.length > 0,
  };
}
