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

export type ItemSortMode = "default" | "name-asc" | "name-desc";

/**
 * The sort picker's options, in display order. Carries the i18n KEY rather
 * than a translated label so this module stays free of `useI18n` (it must be
 * importable under `node --test`) and so every surface that renders the
 * picker — the `<ItemFilterBar>` sheet today, a future "sort all collections"
 * sheet — offers the same three modes in the same order.
 *
 * Kept in lockstep with `ItemSortMode` by `sort-options-parity.test.ts`:
 * adding a mode to the union without adding a row here would ship a mode no
 * UI can reach.
 */
export const SORT_OPTIONS = [
  { mode: "default", labelKey: "sortDefault" },
  { mode: "name-asc", labelKey: "sortNameAsc" },
  { mode: "name-desc", labelKey: "sortNameDesc" },
] as const satisfies ReadonlyArray<{ mode: ItemSortMode; labelKey: string }>;

/**
 * Ionicons glyph paired with each non-default sort mode for the removable
 * quick-chip in `<ItemFilterBar>`. Typed as an exhaustive record over
 * `Exclude<ItemSortMode, "default">` on purpose: adding a fourth mode to the
 * union is then a type error HERE, forcing the icon decision at the same time
 * as the `SORT_OPTIONS` row rather than shipping a chip with a blank glyph.
 * `"default"` has no entry because it has no chip — it IS the empty state.
 */
export const SORT_CHIP_ICONS = {
  "name-asc": "arrow-up",
  "name-desc": "arrow-down",
} as const satisfies Record<Exclude<ItemSortMode, "default">, string>;

export type ActiveSortChip = {
  mode: Exclude<ItemSortMode, "default">;
  /** i18n key, not a label — see the `SORT_OPTIONS` note on why. */
  labelKey: (typeof SORT_OPTIONS)[number]["labelKey"];
  icon: (typeof SORT_CHIP_ICONS)[keyof typeof SORT_CHIP_ICONS];
};

/**
 * Descriptor for the removable "active sort" quick-chip, or `null` when there
 * is nothing to show.
 *
 * The hide-on-default rule lives here rather than in the JSX so it is testable
 * without React, and so every surface that renders the chip agrees on when it
 * disappears: tapping it writes `sort: "default"`, which makes this return
 * `null`, which un-renders the chip. That round trip is the whole contract.
 */
export function activeSortChip(sort: ItemSortMode): ActiveSortChip | null {
  if (sort === "default") return null;
  const option = SORT_OPTIONS.find((o) => o.mode === sort);
  // Unreachable while `sort-options-parity.test.ts` holds (every union member
  // has a row), but staying total keeps a future mode from crashing the bar
  // before the parity test is run.
  if (!option) return null;
  return { mode: sort, labelKey: option.labelKey, icon: SORT_CHIP_ICONS[sort] };
}

export type ItemFilters = {
  priceFrom: string;
  priceTo: string;
  dateFrom: string;
  dateTo: string;
  source: string;
  hasPhotos: boolean;
  /** Free-text needle matched case-insensitively against `item.title`. */
  query: string;
  /**
   * Alphabetical sort applied AFTER `applyItemFilters` via `applySortMode`.
   * `"default"` preserves the existing `sortOrder` → `createdAt` ordering
   * coming out of `getItemsForCollection` (i.e. user-managed drag order).
   */
  sort: ItemSortMode;
};

export const EMPTY_FILTERS: ItemFilters = {
  priceFrom: "",
  priceTo: "",
  dateFrom: "",
  dateTo: "",
  source: "",
  hasPhotos: false,
  query: "",
  sort: "default",
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
  if (f.sort !== "default") n++;
  return n;
}

/**
 * Memoise the `Intl.Collator` per BCP-47 tag, mirroring the
 * `relativeTimeFormatCache` shape in `lib/i18n-context.tsx`.
 *
 * `String.prototype.localeCompare(other, locale, options)` constructs a fresh
 * collator on every call, and a comparator is called O(n log n) times per sort
 * — so an 2000-item collection paid ~22 000 ICU collator constructions per
 * re-sort, each walking the collation tables for the locale. Hoisting the
 * instance turns that into one construction per locale for the app's lifetime;
 * `collator.compare` itself is the same comparison, just without the setup.
 *
 * Keyed by the locale string, with `""` standing in for "runtime default"
 * (`undefined`), because a Map keyed on `string | undefined` would let a
 * caller passing `undefined` and a caller passing `""` collide on semantics
 * that differ. Unbounded by design: the key space is the six supported app
 * languages plus the device default, not user input.
 */
const collatorCache = new Map<string, Intl.Collator>();

export function getTitleCollator(locale?: string): Intl.Collator {
  const key = locale ?? "";
  const cached = collatorCache.get(key);
  if (cached) return cached;
  // `sensitivity: "base"` folds case and accents together (so "Écu" sorts next
  // to "ecu"); `numeric: true` makes "Card 2" precede "Card 10" instead of the
  // lexicographic reverse. Both must match the pre-cache `localeCompare` call
  // exactly — changing either silently re-orders every sorted collection.
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  collatorCache.set(key, collator);
  return collator;
}

/**
 * Pure alphabetical sort applied AFTER `applyItemFilters`. Kept separate so
 * the comparator stays composable and unit-testable in isolation.
 *
 * `"default"` returns the input array unchanged (same reference) so the
 * user-managed drag ordering coming out of `getItemsForCollection` is
 * preserved without an unnecessary allocation.
 *
 * The comparator runs through the cached `getTitleCollator()` with
 * `{ sensitivity: "base", numeric: true }`, so accented characters collate
 * next to their base letter (matters for ru/be/pl/de/es users) and "Item 2"
 * sorts before "Item 10" (natural numeric ordering, not lexicographic).
 */
export function applySortMode(
  items: CollectableItem[],
  sort: ItemSortMode,
): CollectableItem[] {
  if (sort === "default") return items;
  // Hoisted out of the comparator on purpose: inside the arrow this would run
  // a Map lookup on every pair-compare instead of once per sort.
  const collator = getTitleCollator();
  const sorted = [...items].sort((a, b) => collator.compare(a.title, b.title));
  if (sort === "name-desc") sorted.reverse();
  return sorted;
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
