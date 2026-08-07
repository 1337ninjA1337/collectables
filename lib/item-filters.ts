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

/**
 * `"{axis}-{direction}"`, kept as a FLAT string union rather than the
 * discriminated object union the task sketched (`{ mode: "cost", direction }`).
 * The value is persisted verbatim inside `ItemFilters` and round-trips through
 * the filter sheet's `draft` state, so a plain string stays comparable with
 * `===`, usable as a React `key`, and JSON-stable — an object shape would need
 * a normaliser at every one of those boundaries to avoid `{mode,direction}`
 * identity churn re-running the sort `useMemo` on each render.
 *
 * The axis/direction halves are still first-class: `SORT_MODE_PARTS` below
 * decodes them, so the comparator never string-matches on mode names.
 */
export type ItemSortMode =
  | "default"
  | "name-asc"
  | "name-desc"
  | "cost-asc"
  | "cost-desc"
  | "acquired-asc"
  | "acquired-desc";

/** What a non-default mode orders by. */
export type ItemSortAxis = "name" | "cost" | "acquired";
export type ItemSortDirection = "asc" | "desc";

/**
 * Decodes each non-default mode into its axis + direction. Exhaustive over
 * `Exclude<ItemSortMode, "default">` on purpose (same forcing function as
 * `SORT_CHIP_ICONS`): adding a mode to the union without a row here is a type
 * error, so no mode can reach `applySortMode` without a defined comparator.
 */
export const SORT_MODE_PARTS = {
  "name-asc": { axis: "name", direction: "asc" },
  "name-desc": { axis: "name", direction: "desc" },
  "cost-asc": { axis: "cost", direction: "asc" },
  "cost-desc": { axis: "cost", direction: "desc" },
  "acquired-asc": { axis: "acquired", direction: "asc" },
  "acquired-desc": { axis: "acquired", direction: "desc" },
} as const satisfies Record<
  Exclude<ItemSortMode, "default">,
  { axis: ItemSortAxis; direction: ItemSortDirection }
>;

/**
 * The sort picker's options, in display order. Carries the i18n KEY rather
 * than a translated label so this module stays free of `useI18n` (it must be
 * importable under `node --test`) and so every surface that renders the
 * picker — the `<ItemFilterBar>` sheet today, a future "sort all collections"
 * sheet — offers the same modes in the same order.
 *
 * Grouped by axis (name, then cost, then acquisition date) with `"default"`
 * first, so the picker reads as three direction pairs rather than an
 * arbitrary list.
 *
 * Kept in lockstep with `ItemSortMode` by `sort-options-parity.test.ts`:
 * adding a mode to the union without adding a row here would ship a mode no
 * UI can reach.
 */
export const SORT_OPTIONS = [
  { mode: "default", labelKey: "sortDefault" },
  { mode: "name-asc", labelKey: "sortNameAsc" },
  { mode: "name-desc", labelKey: "sortNameDesc" },
  { mode: "cost-asc", labelKey: "sortCostAsc" },
  { mode: "cost-desc", labelKey: "sortCostDesc" },
  { mode: "acquired-desc", labelKey: "sortAcquiredDesc" },
  { mode: "acquired-asc", labelKey: "sortAcquiredAsc" },
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
  // The money axis gets the trend glyphs so a glance at the chip distinguishes
  // "cheapest first" from "A → Z" without reading the label; the date axis
  // reuses the plain arrows because its label already names the axis.
  "cost-asc": "trending-up",
  "cost-desc": "trending-down",
  "acquired-asc": "arrow-up",
  "acquired-desc": "arrow-down",
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
   * Sort applied AFTER `applyItemFilters` via `applySortMode` — by title,
   * cost or acquisition date, each in both directions. `"default"` preserves
   * the existing `sortOrder` → `createdAt` ordering coming out of
   * `getItemsForCollection` (i.e. user-managed drag order).
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
 * Whether any field `applyItemFilters` actually MATCHES ON is set — i.e. every
 * field `countActiveFilters` counts EXCEPT `sort`.
 *
 * The exclusion is the whole point, not an oversight. `sort` is applied by
 * `applySortMode`, which runs after and separately; a collection that is only
 * sorted has `countActiveFilters() === 1` while the filter pass is a pure
 * no-op. Gating the identity path on the count would therefore miss exactly
 * the most common non-empty state — sort picked, nothing filtered — which is
 * also the state where the wasted allocation hurts most, because a re-sort
 * re-runs the whole chain.
 *
 * `filters-identity-path.test.ts` pins the two functions against each other
 * field by field so this stays a deliberate one-clause difference rather than
 * drift.
 */
export function hasActiveMatchers(f: ItemFilters): boolean {
  return Boolean(
    f.priceFrom ||
      f.priceTo ||
      f.dateFrom ||
      f.dateTo ||
      f.source ||
      f.hasPhotos ||
      // Trimmed for the same reason as the badge count: `applyItemFilters`
      // treats a whitespace-only query as no search, so it must not keep the
      // identity path from firing.
      f.query.trim(),
  );
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
 * The `cost` sort key, or `null` when the item carries no usable price.
 *
 * `cost` is `number | null | undefined` on `CollectableItem` and a hand-typed
 * field, so `NaN`/`Infinity` are reachable through a bad import; `null` folds
 * all three into one "missing" bucket that `compareByKey` parks at the end.
 */
function costKey(item: CollectableItem): number | null {
  return typeof item.cost === "number" && Number.isFinite(item.cost) ? item.cost : null;
}

/**
 * The `acquiredAt` sort key, or `null` when the item has no date.
 *
 * Kept as the raw `YYYY-MM-DD` string rather than a `Date`: the format is
 * lexicographically chronological, so string `<`/`>` is both correct and free
 * of the timezone drift `new Date("2025-03-01")` introduces (parsed as UTC,
 * compared against a local-midnight sibling). `applyItemFilters`'s
 * `dateFrom`/`dateTo` range already compares these the same way.
 */
function acquiredKey(item: CollectableItem): string | null {
  const raw = item.acquiredAt?.trim();
  return raw ? raw : null;
}

/**
 * Pure sort applied AFTER `applyItemFilters`. Kept separate so the comparator
 * stays composable and unit-testable in isolation.
 *
 * `"default"` returns the input array unchanged (same reference) so the
 * user-managed drag ordering coming out of `getItemsForCollection` is
 * preserved without an unnecessary allocation.
 *
 * Three axes, each with both directions (see `SORT_MODE_PARTS`):
 *  - `name` — collated titles via the cached `getTitleCollator()` with
 *    `{ sensitivity: "base", numeric: true }`, so accented characters collate
 *    next to their base letter (matters for ru/be/pl/de/es users) and "Item 2"
 *    sorts before "Item 10" (natural numeric ordering, not lexicographic).
 *  - `cost` — numeric price.
 *  - `acquired` — `YYYY-MM-DD` acquisition date.
 *
 * Two rules make the cost/acquired axes total:
 *  1. **Items with no key sort LAST in BOTH directions.** A priceless item is
 *     not "free", and an undated one is not "oldest" — flipping the direction
 *     must not promote the unknowns to the top of the screen. This is why the
 *     comparator negates only the value branch and never the whole result, and
 *     why `"desc"` is not implemented as `asc().reverse()`.
 *  2. **Ties break on the collated title**, always ascending. Without it two
 *     €10 items would land in whatever order the drag ordering happened to
 *     leave them, so the same collection could render differently after an
 *     unrelated reorder.
 *
 * `locale` is a BCP-47 tag — pass the one derived from the user's PINNED app
 * language, not the device's. Omitting it falls back to the JS runtime default,
 * which is the device locale on native but often `en-US` on a server-rendered
 * web preview; a Russian user who pinned the app to `pl` would then see an
 * ordering that disagrees with the UI around it. Callers do the
 * `AppLanguage` → BCP-47 mapping themselves because the map lives in
 * `lib/locale-helpers.ts`, which pulls AsyncStorage and would make this module
 * un-importable under `tsx --test`.
 */
export function applySortMode(
  items: CollectableItem[],
  sort: ItemSortMode,
  locale?: string,
): CollectableItem[] {
  if (sort === "default") return items;
  const parts = SORT_MODE_PARTS[sort];
  // Unreachable while the `satisfies` on `SORT_MODE_PARTS` holds, but an
  // unknown mode rehydrated from an older/newer persisted `ItemFilters` must
  // fall back to the drag order rather than throwing inside a render memo.
  if (!parts) return items;
  // Hoisted out of the comparator on purpose: inside the arrow this would run
  // a Map lookup on every pair-compare instead of once per sort.
  const collator = getTitleCollator(locale);
  const sign = parts.direction === "asc" ? 1 : -1;

  if (parts.axis === "name") {
    // Negating the comparison (rather than sorting ascending and reversing)
    // keeps equal-title items in their incoming drag order under both
    // directions instead of mirroring them.
    return [...items].sort((a, b) => sign * collator.compare(a.title, b.title));
  }

  const keyOf =
    parts.axis === "cost"
      ? (costKey as (i: CollectableItem) => number | string | null)
      : (acquiredKey as (i: CollectableItem) => number | string | null);

  return [...items].sort((a, b) => {
    const av = keyOf(a);
    const bv = keyOf(b);
    // Rule 1 — missing keys sink to the bottom regardless of `sign`.
    if (av === null || bv === null) {
      if (av === bv) return collator.compare(a.title, b.title);
      return av === null ? 1 : -1;
    }
    if (av < bv) return -sign;
    if (av > bv) return sign;
    // Rule 2 — deterministic tiebreak, always ascending by title.
    return collator.compare(a.title, b.title);
  });
}

export function applyItemFilters(items: CollectableItem[], filters: ItemFilters): CollectableItem[] {
  // Identity path on the no-op input, mirroring `applySortMode(items,
  // "default")`. `.filter()` ALWAYS allocates a fresh array, even when the
  // predicate accepts every element, so an unfiltered collection produced a
  // brand-new reference every time the `[allItems, itemFilters]` memo re-ran.
  //
  // That is not just GC pressure. The collection screen chains
  // `applyItemFilters → applySortMode → useChunkedList`, and `useChunkedList`
  // resets its window to page one whenever the `items` REFERENCE changes. So
  // a user who had scrolled 200 items into an unfiltered collection and then
  // toggled a quick-chip on and back off — two new `itemFilters` objects, one
  // empty filter state — was thrown back to the top of the list. Returning
  // `items` itself keeps the downstream memo from invalidating at all.
  if (!hasActiveMatchers(filters)) return items;
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
