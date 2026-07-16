/**
 * Per-item cost conversion. Pure helper so node tests can exercise the
 * conversion math without mounting the React context.
 *
 * `collections-context` binds this to the live `displayCurrency` +
 * `currencyRates` and re-exports it as `convertItemCost(item, targetCurrency?)`.
 *
 * Semantics of the returned `converted` flag:
 *   - true  → `amount` is expressed in the requested `target` currency
 *             (either a real conversion ran, or the stored currency already
 *             matched the target). Callers render `amount` in `currency`.
 *   - false → conversion was impossible (no cost, or rates missing / not
 *             loaded). `amount`/`currency` carry the RAW stored value so the
 *             caller can show the original untouched.
 */

import { convertAmount, type UsdRates } from "@/lib/currency-rates";

/**
 * Single cost formatter for the whole app. Historically this module carried
 * its own weaker copy (no thousands separator, padded trailing zeros), so
 * item cards rendered "1500 USD" while collection totals showed "1,500" —
 * re-exporting keeps the two import paths but one implementation.
 */
export { formatCostAmount } from "@/lib/format-cost";

/** Shared gate for "this item has a renderable cost" (excludes null/NaN/±Infinity). */
export function hasFiniteCost(item: { cost?: number | null }): boolean {
  return typeof item.cost === "number" && Number.isFinite(item.cost);
}

export type ConvertedItemCost = {
  /** Cost expressed in `currency`. `null` when the item has no numeric cost. */
  amount: number | null;
  /** Currency `amount` is in: `target` when converted, else the original stored currency. */
  currency: string;
  /** True when `amount` is expressed in the requested `target` currency. */
  converted: boolean;
};

export function convertItemCost(
  item: { cost?: number | null; costCurrency?: string | null },
  target: string,
  rates: UsdRates | null,
): ConvertedItemCost {
  // No stored currency → assume the cost is already in the target currency,
  // mirroring getCollectionTotalCost's `item.costCurrency ?? target` fallback.
  const stored = item.costCurrency ?? target;

  if (typeof item.cost !== "number" || !Number.isFinite(item.cost)) {
    return { amount: null, currency: stored, converted: false };
  }

  if (stored === target) {
    return { amount: item.cost, currency: target, converted: true };
  }

  if (rates) {
    const result = convertAmount(item.cost, stored, target, rates);
    if (result !== null) {
      return { amount: result, currency: target, converted: true };
    }
  }

  // Missing rate (or rates not loaded yet): hand back the raw stored value so
  // the caller shows the original amount instead of a wrong/blank figure.
  return { amount: item.cost, currency: stored, converted: false };
}
