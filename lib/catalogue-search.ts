/**
 * What the global search box matches on a collection and on an item, written
 * once for the readers that ask it.
 *
 * `lib/profile-search.ts` is the same argument for the third of this box's
 * three sections — `searchPlaceholder` is "Search items, collections,
 * people...", the people half went through that module on 2026-10-13, and
 * the other two were still five inline lines in `components/search-overlay.tsx`
 * with a SECOND copy of the collection half in `app/create.tsx`'s collection
 * picker. Two readers of one question, with nothing holding them in step: the
 * picker and the overlay both matched `name` and `description`, and an edit
 * adding a third field to one would have left the other answering differently
 * about the same collection — which is the defect most of this repository's
 * history is about removing, and the exact pair the profile half was fixed for.
 *
 * The name is the subject rather than the type: the module answers "what are
 * the user's own things findable by", which is one question asked of two
 * shapes, not two questions. {@link collectionMatchesSearch} and
 * {@link itemMatchesSearch} differ only in which fields they read, and that
 * difference is the whole content of the module.
 *
 * The one thing this half does NOT share with the profile half is the
 * sanitiser, and the omission is a decision rather than an oversight. A
 * profile query is sent to PostgREST as an `ilike` pattern inside an `or=(…)`,
 * so `%`, `*`, commas and parens carry meaning there and have to be stripped
 * from both halves or the page and the table answer differently. Collections
 * and items are AsyncStorage-only (see CLAUDE.md's data layer) — there is no
 * server half to disagree with, and a `%` or a `(` in a query is a character
 * somebody typed because it is in the title they are looking for. If a server
 * half ever lands, `sanitizeProfileSearchQuery` has to join this needle on the
 * same day, for the same reason it had to join the profile one.
 */

/** The fields a collection is findable by. */
export interface SearchableCollection {
  readonly name: string;
  readonly description: string;
}

/** The fields an item is findable by. */
export interface SearchableItem {
  readonly title: string;
  readonly description: string;
  readonly acquiredFrom: string;
}

/**
 * What somebody typed, reduced to the text the predicates compare against.
 *
 * Trimmed and lower-cased, which is the line both call sites wrote inline. An
 * empty result is the callers' cue to skip the filter entirely rather than a
 * meaning of its own, and the two callers skip it in opposite directions on
 * purpose — the overlay shows NOTHING for an empty query (there is nothing to
 * search for) and the collection picker shows EVERYTHING (it is a picker with
 * a search box, not a search with a list). `"".includes("")` is `true`, so a
 * caller that forgets to skip gets "matches everything", which is the safer of
 * the two wrong answers.
 */
export function catalogueSearchNeedle(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Whether this collection answers the needle.
 *
 * `name` and `description`, which is what both readers already did. The
 * description is matched even though the rows only PRINT the name, and that is
 * deliberate in both places: somebody searching "vinyl" should find the
 * collection whose description says vinyl, and the alternative — matching only
 * what is drawn — makes the result list depend on the row layout.
 */
export function collectionMatchesSearch(
  collection: SearchableCollection,
  needle: string,
): boolean {
  return (
    collection.name.toLowerCase().includes(needle) ||
    collection.description.toLowerCase().includes(needle)
  );
}

/**
 * Whether this item answers the needle.
 *
 * Three fields rather than the collection's two, because `acquiredFrom` is
 * where "bought at Camden market" lives and "where did I get this" is the
 * question this box is most often opened for.
 *
 * Deliberately NOT the same question as `applyItemFilters`' `query`, which
 * matches `item.title` alone: that field sits in the per-collection filter
 * sheet under copy that says so in all six locales
 * (`searchInCollectionPlaceholder` is "Search items by title"), so the two
 * are different promises rather than one promise kept two ways. The profile
 * half's bug was a field labelled after an identifier it did not search; this
 * is the opposite, and the labels are why.
 *
 * Liveness is not here either: the overlay drops wants, sold and archived
 * items with `isLiveItem` BEFORE asking this, because that rule is shared with
 * the card counts and the collection totals and is not a fact about the query.
 */
export function itemMatchesSearch(item: SearchableItem, needle: string): boolean {
  return (
    item.title.toLowerCase().includes(needle) ||
    item.description.toLowerCase().includes(needle) ||
    item.acquiredFrom.toLowerCase().includes(needle)
  );
}
