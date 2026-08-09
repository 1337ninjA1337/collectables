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

/**
 * Why a single price bound (`priceFrom` / `priceTo`) failed to become a
 * number. Deliberately the same `"empty" | "unparseable"` vocabulary as
 * `CurrencyValueError` (lib/format-currency-input.ts) so the two amount
 * parsers in the app never name the same failure differently — the third
 * member differs on purpose: a LISTING price of 0 is meaningless
 * (`non_positive`), while a filter bound of 0 is a legitimate "from free",
 * so only a genuinely NEGATIVE bound is rejected here.
 */
export type PriceBoundError = "empty" | "unparseable" | "negative";

export type ParsedPriceBound =
  | { value: number; error: null }
  | { value: null; error: PriceBoundError };

/**
 * Digits with at most one decimal point and an optional leading sign. The
 * shape check exists because `Number` is too permissive at both ends for a
 * price field: `Number("0x10")` is 16 and `Number("1e3")` is 1000, so a
 * typo'd bound would silently filter by a number the user never typed.
 * Anything this rejects becomes `"unparseable"` and is surfaced inline.
 */
const PRICE_BOUND_PATTERN = /^-?\d*(?:\.\d*)?$/;

/**
 * Parse one bound of the price range.
 *
 * Gate order mirrors `parseCurrencyValueDetailed`: empty → unparseable →
 * out-of-domain, so the two can never accept different strings for the same
 * reason. The comma → dot normalisation matches `sanitizeCurrencyInput`; five
 * of the app's six locales write "12,50" and `parseFloat("12,5")` returns 12,
 * which is the quiet kind of wrong — the filter applies, just at the wrong
 * price.
 *
 * `""` is `"empty"`, NOT an error the UI shows: an unset bound is the normal
 * half-open range ("from 10, no ceiling"). Only `validatePriceRange` decides
 * which errors are worth blocking on.
 */
export function parsePriceBound(raw: string): ParsedPriceBound {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: "empty" };
  const normalised = trimmed.replace(",", ".");
  if (!PRICE_BOUND_PATTERN.test(normalised)) return { value: null, error: "unparseable" };
  const n = Number(normalised);
  // Catches the shapes the pattern lets through that are still not numbers:
  // `"."`, `"-"`, `"-."`.
  if (!Number.isFinite(n)) return { value: null, error: "unparseable" };
  if (n < 0) return { value: null, error: "negative" };
  return { value: n, error: null };
}

/**
 * Why the price range as a whole cannot be applied, or `null` when it can.
 *
 * Both failure modes are silent without this. A bound that does not parse is
 * SKIPPED by `applyItemFilters` but still counted by `countActiveFilters`, so
 * the bar reads "Filters (1)" over a list nothing was filtered out of; an
 * inverted range (`from > to`) parses fine and matches no item at all, so the
 * collection renders empty with nothing on screen explaining why. Since the
 * sheet's draft is sticky, either state now PERSISTS across a dismiss instead
 * of being discarded on reopen — which is what makes blocking Apply worth the
 * extra state rather than a nicety.
 *
 * Bounds are reported one at a time, `from` first, because the inline slot
 * under the price row shows a single message.
 */
export type PriceRangeError =
  | "from_unparseable"
  | "to_unparseable"
  | "from_negative"
  | "to_negative"
  | "inverted";

export function validatePriceRange(from: string, to: string): PriceRangeError | null {
  const lo = parsePriceBound(from);
  if (lo.error === "unparseable") return "from_unparseable";
  if (lo.error === "negative") return "from_negative";
  const hi = parsePriceBound(to);
  if (hi.error === "unparseable") return "to_unparseable";
  if (hi.error === "negative") return "to_negative";
  // An unset bound is a half-open range, not an inversion.
  if (lo.value !== null && hi.value !== null && lo.value > hi.value) return "inverted";
  return null;
}

/**
 * i18n key per range error. Exhaustive over `PriceRangeError` on purpose
 * (same forcing function as `SORT_CHIP_ICONS`): adding a code without a
 * message is a type error here rather than a blank error line in the sheet.
 * The two `*_negative` codes share one string — "a price cannot be negative"
 * reads the same for either end, and naming the field would be noise next to
 * the field the caret is already in.
 */
export const PRICE_RANGE_ERROR_I18N_KEY = {
  from_unparseable: "filterPriceFromInvalid",
  to_unparseable: "filterPriceToInvalid",
  from_negative: "filterPriceNegative",
  to_negative: "filterPriceNegative",
  inverted: "filterPriceRangeInverted",
} as const satisfies Record<PriceRangeError, string>;

/**
 * Why one bound of the acquisition-date range failed.
 *
 * `"unparseable"` is the wrong SHAPE (`"tomorrow"`, `"01/02/2024"`);
 * `"not_a_date"` is the right shape naming a day that does not exist
 * (`"2024-02-30"`, `"2024-13-01"`). Worth separating because the fix differs:
 * one is "use this format", the other is "check the calendar".
 */
export type DateBoundError = "empty" | "unparseable" | "not_a_date";

export type ParsedDateBound =
  | { value: string; error: null }
  | { value: null; error: DateBoundError };

/** `YYYY-M-D` with the month and day allowed to be written unpadded. */
const DATE_BOUND_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** Days in `month` (1-indexed) of `year`, Gregorian leap rule included. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Parse one end of the date range into a ZERO-PADDED `YYYY-MM-DD` string.
 *
 * The padding is the point, not a cosmetic touch. `applyItemFilters` compares
 * these bounds against `item.acquiredAt` with a raw string `<`/`>` — correct
 * and timezone-free for padded ISO dates, silently wrong for anything else,
 * because `"2024-01-15" < "2024-1-1"` is TRUE (`"0"` sorts before `"1"`). A
 * user who typed the perfectly reasonable `2024-1-1` therefore filtered out
 * most of the year it was supposed to include, with the range looking right
 * on screen. Normalising here means the matcher only ever sees the shape its
 * comparison is valid for.
 *
 * Calendar validity is checked arithmetically rather than by round-tripping
 * through `Date`: `new Date("2024-02-30")` does not throw, it rolls over to
 * March 1st, so a `Date`-based check would accept the typo and quietly filter
 * by a different day than the one on screen.
 */
export function parseDateBound(raw: string): ParsedDateBound {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: "empty" };
  const match = DATE_BOUND_PATTERN.exec(trimmed);
  if (!match) return { value: null, error: "unparseable" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return { value: null, error: "not_a_date" };
  if (day < 1 || day > daysInMonth(year, month)) return { value: null, error: "not_a_date" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { value: `${match[1]}-${pad(month)}-${pad(day)}`, error: null };
}

/**
 * Why the acquisition-date range cannot be applied, or `null` when it can.
 *
 * Same three silent failures the price range had — a bound that does not
 * parse is skipped while still counted by the filter badge, an unpadded one
 * excludes days it names, and an inverted range matches nothing — reported
 * with the same precedence: `from` before `to`, a parse failure before the
 * inversion it would otherwise imply.
 */
export type DateRangeError =
  | "from_unparseable"
  | "to_unparseable"
  | "from_not_a_date"
  | "to_not_a_date"
  | "inverted";

export function validateDateRange(from: string, to: string): DateRangeError | null {
  const lo = parseDateBound(from);
  if (lo.error === "unparseable") return "from_unparseable";
  if (lo.error === "not_a_date") return "from_not_a_date";
  const hi = parseDateBound(to);
  if (hi.error === "unparseable") return "to_unparseable";
  if (hi.error === "not_a_date") return "to_not_a_date";
  // Both ends are normalised, so the lexicographic compare is chronological.
  if (lo.value !== null && hi.value !== null && lo.value > hi.value) return "inverted";
  return null;
}

/**
 * i18n key per date-range error, exhaustive over `DateRangeError` for the
 * same reason `PRICE_RANGE_ERROR_I18N_KEY` is. The two `*_not_a_date` codes
 * share one string: which end holds "2024-02-30" is obvious from the field
 * the user is looking at, and the format hint is what they need either way.
 */
export const DATE_RANGE_ERROR_I18N_KEY = {
  from_unparseable: "filterDateFromInvalid",
  to_unparseable: "filterDateToInvalid",
  from_not_a_date: "filterDateNotReal",
  to_not_a_date: "filterDateNotReal",
  inverted: "filterDateRangeInverted",
} as const satisfies Record<DateRangeError, string>;

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
    // Both bounds go through `parsePriceBound` — the SAME parser
    // `validatePriceRange` gates Apply on — so a range the sheet accepted can
    // never be matched on a different number than the one it validated. The
    // old `parseFloat` disagreed with it twice over: `parseFloat("12,50")` is
    // 12 (five of six locales write the comma), and `parseFloat("12abc")` is
    // 12, so a bound the user could not have meant filtered anyway.
    //
    // A bound that does not parse is SKIPPED rather than treated as
    // no-matches, preserving the previous `!isNaN` behaviour: filters
    // persisted before this validation shipped must not empty a collection on
    // upgrade. The sheet no longer lets a new one through.
    if (filters.priceFrom) {
      const min = parsePriceBound(filters.priceFrom).value;
      if (min !== null && (typeof item.cost !== "number" || item.cost < min)) return false;
    }
    if (filters.priceTo) {
      const max = parsePriceBound(filters.priceTo).value;
      if (max !== null && (typeof item.cost !== "number" || item.cost > max)) return false;
    }
    // Normalised through `parseDateBound` for the same reason the price
    // bounds are: the raw `<`/`>` below is only a chronological comparison
    // when BOTH sides are zero-padded `YYYY-MM-DD`, and a bound typed
    // `2024-1-1` sorts after `2024-01-15`. An unparseable bound is skipped
    // rather than treated as no-matches, matching the price bounds and
    // keeping filters persisted before this shipped from emptying a
    // collection on upgrade.
    if (filters.dateFrom) {
      const since = parseDateBound(filters.dateFrom).value;
      if (since !== null && (!item.acquiredAt || item.acquiredAt < since)) return false;
    }
    if (filters.dateTo) {
      const until = parseDateBound(filters.dateTo).value;
      if (until !== null && (!item.acquiredAt || item.acquiredAt > until)) return false;
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
