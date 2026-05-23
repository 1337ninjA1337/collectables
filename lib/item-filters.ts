import type { CollectableItem } from "@/lib/types";

/**
 * Pure filter state + matchers shared by the collection-detail screen and the
 * `<ItemFilterBar>` sheet UI. Lives in `lib/` (no React Native imports) so
 * the per-item matching logic stays unit-testable under `node --test` without
 * mocking `@expo/vector-icons` or the StyleSheet runtime.
 *
 * The UI side lives in `components/item-filters.tsx` and re-exports these
 * types so existing callers (`@/components/item-filters`) keep working.
 */

export type ItemFilters = {
  priceFrom: string;
  priceTo: string;
  dateFrom: string;
  dateTo: string;
  source: string;
  hasPhotos: boolean;
  /** Free-text needle matched case-insensitively against `item.title`. */
  query: string;
};

export const EMPTY_FILTERS: ItemFilters = {
  priceFrom: "",
  priceTo: "",
  dateFrom: "",
  dateTo: "",
  source: "",
  hasPhotos: false,
  query: "",
};

export function countActiveFilters(f: ItemFilters): number {
  let n = 0;
  if (f.priceFrom) n++;
  if (f.priceTo) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  if (f.source) n++;
  if (f.hasPhotos) n++;
  // Trim before counting so a whitespace-only query (which `applyItemFilters`
  // treats as a no-op) doesn't inflate the filter badge.
  if (f.query.trim()) n++;
  return n;
}

export function applyItemFilters(items: CollectableItem[], filters: ItemFilters): CollectableItem[] {
  // Pre-compute the title-search needle ONCE — otherwise a 500-item collection
  // would pay 1000 `.toLowerCase()` calls (needle + each item title) on every
  // filter pass. Trim outside the loop too; whitespace-only is "no search".
  const queryNeedle = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.priceFrom) {
      const min = parseFloat(filters.priceFrom);
      if (!isNaN(min) && (typeof item.cost !== "number" || item.cost < min)) return false;
    }
    if (filters.priceTo) {
      const max = parseFloat(filters.priceTo);
      if (!isNaN(max) && (typeof item.cost !== "number" || item.cost > max)) return false;
    }
    if (filters.dateFrom) {
      if (!item.acquiredAt || item.acquiredAt < filters.dateFrom) return false;
    }
    if (filters.dateTo) {
      if (!item.acquiredAt || item.acquiredAt > filters.dateTo) return false;
    }
    if (filters.source) {
      const needle = filters.source.toLowerCase();
      if (!item.acquiredFrom.toLowerCase().includes(needle)) return false;
    }
    if (filters.hasPhotos) {
      if (!item.photos || item.photos.length === 0) return false;
    }
    if (queryNeedle) {
      if (!item.title.toLowerCase().includes(queryNeedle)) return false;
    }
    return true;
  });
}
