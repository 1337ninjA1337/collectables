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
 * **Without rates, raw amounts are summed** and reported as converted. That is
 * a deliberate lie of convenience: it is better than blanking the card while
 * the rate table loads, and once the rates land the totals re-render with real
 * conversion. It is also only ever right when the items share a currency,
 * which is why `converted`/`skipped` come back at all — a caller that wants to
 * say "approximate" has the counts to decide with.
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
  return { amount: 0, currency, converted: 0, skipped: 0 };
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
  const entries = items.filter(hasFiniteCost).map((item) => ({
    amount: item.cost,
    currency: item.costCurrency ?? target,
  }));

  if (rates) {
    const { total, converted, skipped } = sumConverted(entries, target, rates);
    return { amount: total, currency: target, converted, skipped };
  }

  // No rates yet: sum raw amounts (assume each item is already in the target
  // currency). Better than blanking the UI; once rates load the totals
  // re-render with real conversion.
  const amount = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return { amount, currency: target, converted: entries.length, skipped: 0 };
}
