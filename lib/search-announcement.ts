/**
 * When a search result count is worth saying out loud.
 *
 * The search overlay's three section headings became headings this morning, so
 * a screen-reader user can now jump between items, collections and people. The
 * thing they still cannot do is TYPE: results re-render under a query with no
 * announcement at all, and the count that would say whether the last keystroke
 * helped is written into a heading the reader has already passed. The rotor
 * shows what is there after you go looking; a live announcement is what tells
 * you to.
 *
 * ## The rule is "the number changed", not "something rendered"
 *
 * An announcement per keystroke is worse than none: `announceForAccessibility`
 * interrupts, so a reader that speaks on every render spends the whole session
 * cutting itself off — and the answer a user is listening for is the COUNT.
 * Typing one more letter and hearing "12 results" again says nothing; hearing
 * it drop to 3 is the whole signal. So a repeat of the number already spoken is
 * silence, whatever the query did.
 *
 * ## An empty query forgets
 *
 * With nothing typed there are no results to count — the overlay renders no
 * section at all — so an empty field is not "0 results", it is not a search.
 * Clearing the field also clears what was spoken, which is what makes typing
 * the same query again audible: the second search is a new question and
 * deserves the same answer, even though the number has not changed since.
 *
 * The words are NOT here, deliberately: which noun agrees with which number is
 * `lib/plural.ts`'s business and the locale maps', and this module would have
 * to know six languages to hold a sentence. It decides WHETHER, the caller
 * decides what.
 */

export type SearchResultsState = {
  /** The query the counted results came from. */
  readonly query: string;
  /** How many rows the overlay is rendering for it, across all sections. */
  readonly total: number;
};

export type SearchAnnouncementDecision = {
  /** Whether this total should be read aloud now. */
  readonly speak: boolean;
  /**
   * What the caller should remember as spoken — null once the field is empty,
   * which is what lets the same query be announced again later.
   */
  readonly spoken: SearchResultsState | null;
};

/** Whether `next` says anything the user has not already been told. */
export function searchAnnouncement(
  next: SearchResultsState,
  spoken: SearchResultsState | null,
): SearchAnnouncementDecision {
  // Whitespace is not a query: the overlay trims before matching, so " " finds
  // everything and would otherwise be announced as a result set.
  if (next.query.trim() === "") return { speak: false, spoken: null };
  if (spoken === null) return { speak: true, spoken: next };
  // The query is still remembered on a silent round, so the memory tracks the
  // field rather than the last thing said out loud.
  if (spoken.total === next.total) return { speak: false, spoken: next };
  return { speak: true, spoken: next };
}
