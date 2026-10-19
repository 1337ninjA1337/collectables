/**
 * Saying a search result count out loud, and remembering what was said.
 *
 * The MECHANISM half. `lib/announce.ts` is a platform pair — react-native's
 * announcement API is an empty function on web, so the web half builds an ARIA
 * live region — which is why importing it here keeps this module out of reach
 * of the node suites, and why the decision about WHETHER to speak lives next
 * door in `lib/search-announcement.ts` where a suite can run it.
 * `lib/tab-announcement.ts` / `lib/tab-sentence.ts` and
 * `lib/reorder-announcement.ts` / `lib/drag-reorder.ts` are the same split for
 * the same reason, and this is the third instance.
 *
 * ## Why it exists rather than the effect being written twice
 *
 * `components/search-overlay.tsx` had the whole thing inline: a ref, a
 * `searchAnnouncement` call, the memory write and the `announceMessage`. That
 * was fine while one surface announced. `app/people.tsx` is the second — it
 * holds the same page-plus-server union, the same settling state and the same
 * locale key, and announced NOTHING, so a screen-reader user got a count in
 * the sheet and silence on the screen — and copying four lines into it is how
 * the two halves of this feature start to disagree, which the search seam has
 * already done four times in a week over the predicate, the union, the
 * ordering and the filter.
 *
 * The memory is RETURNED rather than held here: it is per-surface (two
 * independent searches, two things last spoken) and a module-level cache would
 * make the sheet's last count silence the screen's identical one. The caller
 * keeps it in a ref, which is also what keeps the write out of a render.
 *
 * `t` is a narrow parameter rather than a hook call, as in both sibling
 * modules: this is a plain function, and the one key it can ask for is the one
 * whose noun agrees with the number in six languages.
 */

import { announceMessage } from "@/lib/announce";
import {
  searchAnnouncement,
  type SearchAnnouncementReadiness,
  type SearchResultsState,
} from "@/lib/search-announcement";

/** The only key this accepts — the sentence whose noun agrees with the count. */
export type SearchResultsTranslate = (
  key: "searchResultsAnnouncement",
  params?: Record<string, string | number>,
) => string;

/**
 * Announce `next`'s total if it says anything new, and return the memory the
 * caller should keep.
 *
 * Returning the memory rather than a `void` plus a second call is the point:
 * the decision module answers both questions at once (speak, and what to
 * remember), and a caller that wrote one without the other would be wrong in
 * the direction nobody notices — an unsettled total recorded as spoken
 * silences the real announcement when it lands.
 */
export function announceSearchResults(
  t: SearchResultsTranslate,
  next: SearchResultsState,
  spoken: SearchResultsState | null,
  readiness: SearchAnnouncementReadiness,
): SearchResultsState | null {
  const decision = searchAnnouncement(next, spoken, readiness);
  if (decision.speak) {
    announceMessage(t("searchResultsAnnouncement", { count: next.total }));
  }
  return decision.spoken;
}
