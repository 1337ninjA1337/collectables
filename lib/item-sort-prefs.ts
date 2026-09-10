import { SORT_OPTIONS, type ItemSortMode } from "@/lib/item-filters";
import { blobObject, readStoredObject } from "@/lib/stored-blob";

/**
 * The sort each collection was last viewed with, keyed by collection id.
 *
 * `itemFilters` resets to `EMPTY_FILTERS` on every mount of the
 * collection-detail screen, so a user who prefers A→Z re-picked it on every
 * visit — and the pick is two taps behind a sheet. The sort is the one filter
 * worth remembering: a query or a tag filter is about the question the user is
 * asking right now, while the sort is about how they like to READ the
 * collection, and that does not change between visits.
 *
 * Per collection rather than app-wide, because it does not generalise: the
 * cost sort makes sense for a collection whose items carry prices and none for
 * one where they don't, and the same user wants "newest first" in one and
 * "A→Z" in another.
 *
 * Pure, so the parse/merge rules can be tested without AsyncStorage — the
 * reading and writing halves live in `lib/use-item-sort-pref.ts`.
 */
export type ItemSortPrefs = Readonly<Record<string, ItemSortMode>>;

export const EMPTY_SORT_PREFS: ItemSortPrefs = {};

const KNOWN_MODES: ReadonlySet<string> = new Set(SORT_OPTIONS.map((option) => option.mode));

/**
 * True for a mode the picker can actually offer.
 *
 * The stored blob outlives the build that wrote it: a mode removed from
 * `SORT_OPTIONS` in a later release is still sitting in the store on the
 * user's device, and `applySortMode` would fall through to the drag order
 * while the picker showed no chip at all — an invisible sort. Reading through
 * `SORT_OPTIONS` rather than a second hardcoded list means the check retires
 * a mode at the same moment the UI does.
 */
export function isItemSortMode(value: unknown): value is ItemSortMode {
  return typeof value === "string" && KNOWN_MODES.has(value);
}

/**
 * The stored preferences, with anything unrecognisable dropped.
 *
 * A blob of the wrong SHAPE (an array, a string, unparseable JSON) yields no
 * preferences at all — `readStoredObject` decides that, and the whole blob is
 * a cache of a two-tap choice, so there is nothing to recover. A blob of the
 * right shape holding one bad ENTRY keeps the others: one collection whose
 * mode was retired must not cost the user every other collection's sort.
 */
export function parseSortPrefs(raw: string | null | undefined): ItemSortPrefs {
  const stored = blobObject(readStoredObject<Record<string, unknown>>(raw), {});
  const prefs: Record<string, ItemSortMode> = {};
  for (const [collectionId, mode] of Object.entries(stored)) {
    if (!collectionId || !isItemSortMode(mode)) continue;
    prefs[collectionId] = mode;
  }
  return prefs;
}

/** The remembered sort for one collection, or the default nobody chose. */
export function sortPrefFor(prefs: ItemSortPrefs, collectionId: string | undefined): ItemSortMode {
  if (!collectionId) return "default";
  const stored = prefs[collectionId];
  return isItemSortMode(stored) ? stored : "default";
}

/**
 * The preferences after the user picks `sort` for `collectionId`.
 *
 * `"default"` DELETES the entry rather than storing the string. The default is
 * the absence of a choice — the picker's own reset row, and what
 * `sortPrefFor` answers for a collection nobody has sorted — so storing it
 * would grow the blob by one entry per collection the user ever opened the
 * sheet in and then backed out of, and would make "clear my sort" and "never
 * had one" two different states that behave identically.
 *
 * Returns `prefs` by reference when it says nothing new, the same no-op
 * contract the cloud merges state: the caller writes to AsyncStorage only when
 * the reference changes.
 */
export function withSortPref(
  prefs: ItemSortPrefs,
  collectionId: string | undefined,
  sort: ItemSortMode,
): ItemSortPrefs {
  if (!collectionId) return prefs;
  const current = prefs[collectionId];
  if (sort === "default") {
    if (current === undefined) return prefs;
    const next = { ...prefs };
    delete next[collectionId];
    return next;
  }
  if (!isItemSortMode(sort) || current === sort) return prefs;
  return { ...prefs, [collectionId]: sort };
}

/**
 * The preferences with entries for collections that no longer exist removed.
 *
 * The blob is written every time a sort changes and read on every collection
 * open, and nothing else prunes it: a deleted collection's entry would sit
 * there for the life of the install. Called with the ids the user can actually
 * reach, so it is a no-op in the common case and returns `prefs` by reference
 * when it is.
 */
export function pruneSortPrefs(
  prefs: ItemSortPrefs,
  knownCollectionIds: ReadonlySet<string>,
): ItemSortPrefs {
  const stale = Object.keys(prefs).filter((id) => !knownCollectionIds.has(id));
  if (stale.length === 0) return prefs;
  const next = { ...prefs };
  for (const id of stale) delete next[id];
  return next;
}
