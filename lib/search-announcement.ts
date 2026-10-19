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
 * ## An unsettled count is not a count
 *
 * The caller's total is the rows it is rendering, and one of the sheet's three
 * sections is fetched: people come from a 100-row snapshot PLUS a debounced
 * server query. So between a settled keystroke and its answer the total is the
 * catalogue halves plus whatever the previous query's rows still match — a
 * number about to change. Speaking it meant "0 results" and then, a round trip
 * later, "1 result", for the commonest use of that box: pasting a profile ID
 * only the server knows.
 *
 * That gate was a `return` in the overlay's effect for a few hours on
 * 2026-10-19, which put one half of this policy at the call site and the other
 * half here, where the cases are. `settled` is a REQUIRED option for the
 * reason the brand in `lib/profile-search.ts` is a type: a caller that forgets
 * it would still work, and would be silently wrong only on the queries the
 * server alone can answer.
 *
 * An unsettled round does not update the memory. The number was never said, so
 * remembering it would make the real announcement a repeat and silence it.
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

/** Whether the caller's count is one it is entitled to speak yet. */
export type SearchAnnouncementReadiness = {
  /**
   * False while a request the total depends on is still in flight, or has not
   * been sent because a debounce has not elapsed.
   */
  readonly settled: boolean;
};

/** Whether `next` says anything the user has not already been told. */
export function searchAnnouncement(
  next: SearchResultsState,
  spoken: SearchResultsState | null,
  readiness: SearchAnnouncementReadiness,
): SearchAnnouncementDecision {
  // Whitespace is not a query: the overlay trims before matching, so " " finds
  // everything and would otherwise be announced as a result set.
  //
  // Answered BEFORE the readiness gate: clearing the field is not a search in
  // any state, and the forget has to happen even if a request for the previous
  // query is still in the air.
  if (next.query.trim() === "") return { speak: false, spoken: null };
  // The memory is returned UNCHANGED: this total was never said, so recording
  // it would make the real announcement a repeat and silence it.
  if (!readiness.settled) return { speak: false, spoken };
  if (spoken === null) return { speak: true, spoken: next };
  // The query is still remembered on a silent round, so the memory tracks the
  // field rather than the last thing said out loud.
  if (spoken.total === next.total) return { speak: false, spoken: next };
  return { speak: true, spoken: next };
}
