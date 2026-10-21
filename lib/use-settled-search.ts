import { useEffect, useState } from "react";

import { PROFILE_SEARCH_DEBOUNCE_MS } from "@/lib/debounce-helpers";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useLatestRef } from "@/lib/use-latest-ref";

/** What the hook hands back: the answered rows, the query they answer, and whether one is owed. */
export type SettledSearch<T> = {
  /** Rows the last answered request returned, `[]` while there is nothing to search for. */
  results: T[];
  /**
   * The query `results` answer — what the debounce is holding, which lags the
   * field by `delayMs`. The one reason to read it: a surface that speaks or
   * renders something per-query needs to know WHICH query it has an answer
   * for (`components/search-overlay.tsx` gates its announcement on it).
   */
  query: string;
  /**
   * The answer on hand is not for the query being asked. Two windows, and the
   * first has no request in it at all: the debounce, then the round trip.
   */
  settling: boolean;
};

export type SettledSearchOptions<T> = {
  /** The raw field value, debounced before it is searched for. */
  input: string;
  /**
   * Whether a search is wanted at all — the surface's own reading of "there
   * is a query, and this surface wants people for it". It gates the request
   * AND it is the first term of `settling`, which is the whole reason it is
   * one parameter: the two were written separately on both surfaces and had
   * to agree, because a `settling` that said yes where no request is sent
   * hides an empty state for a search that already finished.
   */
  active: boolean;
  /** The request. Identity may change per render; see the note below. */
  search: (query: string) => Promise<T[]>;
  /** Defaults to the remote-search delay both surfaces use. */
  delayMs?: number;
};

/**
 * A debounced remote search whose caller can tell an answer from a pause.
 *
 * ## What it absorbed
 *
 * `app/people.tsx` and `components/search-overlay.tsx` each held the same
 * twenty lines: `useDebouncedValue`, a results state, an in-flight flag, an
 * effect that clears on an empty query and otherwise fetches under a
 * `cancelled` closure with `.finally` bookkeeping, and a four-term `settling`
 * expression. They were written separately, and the search seam has
 * disagreed with itself five times in a week — over the predicate, the union,
 * the ordering, the filter and the empty state — every time two screens held
 * one question twice. The settling halves were the last pair left: named as
 * duplicated in three suggestion rounds, and the reason each round gave for
 * not taking it was the suite that pinned both copies by source.
 *
 * ## Why `settling` and not `loading`
 *
 * Because the first of its two windows has no request in it. The debounce
 * means the settled query lags the field, so for `delayMs` after a keystroke
 * nothing has been sent — and a reader that only knows about requests shows
 * "nothing found" through it. That is the defect this state was invented for,
 * on both surfaces, a day apart: typing a profile ID only the server knows
 * matched nothing in the rows already loaded, so the empty state rendered for
 * a debounce window plus a round trip and then flipped to the answer. On the
 * sheet it was also SPOKEN, because the announcement is gated on the debounce
 * having caught up and not on the request having landed.
 *
 * ## `active` gates the request too, which is a change from both copies
 *
 * Each effect used to run on "the settled query is non-empty" alone, so a
 * cleared field kept its stale rows until the debounce caught up, and the
 * sheet sent a people request under a `collections` filter it would never
 * render. Both were invisible — each caller re-derived `[]` from the raw
 * field before reading `results` — and neither is worth reproducing: a search
 * nobody is asking for should not be in flight, and `active` is the sentence
 * that says nobody is asking.
 *
 * ## `search` is read through a ref
 *
 * Both call sites close over a per-surface row limit, so the function is a new
 * identity every render; in the dependency list it would re-fire the request
 * per render forever (each response is a `setState`, which is another render).
 * `useLatestRef` is this tree's answer to exactly that — see its header — and
 * putting it here rather than at the call sites is what keeps adoption to one
 * line. The consequence to know: the request that runs is the LATEST `search`,
 * so a caller whose limit changes mid-flight gets the new limit on the next
 * settle rather than a re-fetch, which is what a limit change means anyway.
 *
 * ## One state, and why it is not an `inFlight` boolean
 *
 * Both copies held `results` and an `inFlight` flag, and between the two there
 * was a render in which NEITHER was true: the debounce commits its new query
 * in one pass and the effect that fetches it runs after that pass, so for one
 * frame the settled query was the field's, no request had been made yet, and
 * `settling` read false — the empty state, for a frame, in the middle of a
 * search. Storing the rows WITH the query they answer closes it by
 * construction: "settling" becomes "the answer I have is not for the question
 * being asked", which is true from the keystroke until the rows for that
 * exact query land, with no gap for a flag to be behind in.
 *
 * It also makes a failure answerable. A rejected request records the query
 * with no rows rather than leaving the previous query's rows in place, so a
 * caller cannot render rows that answer something nobody asked.
 */

/** The rows and the query they answer, which are one value or neither. */
type SearchAnswer<T> = { query: string; results: T[] };

/**
 * The one empty array, so a caller's `useMemo` over `results` does not
 * recompute per render while there is nothing to search for. `never[]` is
 * assignable to `T[]`, which is why this needs no cast.
 */
const NO_RESULTS: never[] = [];

export function useSettledSearch<T>({
  input,
  active,
  search,
  delayMs = PROFILE_SEARCH_DEBOUNCE_MS,
}: SettledSearchOptions<T>): SettledSearch<T> {
  const debouncedQuery = useDebouncedValue(input, delayMs);
  const searchRef = useLatestRef(search);
  const [answer, setAnswer] = useState<SearchAnswer<T> | null>(null);

  useEffect(() => {
    if (!active || !debouncedQuery) {
      // `null` rather than empty rows: an answer to nothing is not an answer,
      // and the next time this surface IS searching, `settling` has to be true
      // until the rows for the new query land. React bails out when it is
      // already null, so a clear that clears nothing is not a render.
      setAnswer(null);
      return;
    }
    let cancelled = false;
    searchRef
      .current(debouncedQuery)
      .then((results) => {
        if (!cancelled) setAnswer({ query: debouncedQuery, results });
      })
      .catch(() => {
        // A failed search has still been answered — the rows are none. Without
        // this the caller settles on the PREVIOUS query's rows and `settling`
        // never goes false, so a dropped connection reads as a search that is
        // still running.
        if (!cancelled) setAnswer({ query: debouncedQuery, results: NO_RESULTS });
      });
    return () => {
      cancelled = true;
    };
  }, [active, debouncedQuery, searchRef]);

  return {
    results: answer?.results ?? NO_RESULTS,
    query: debouncedQuery,
    // `debouncedQuery !== input` is the window with no request in it; the
    // second term is the round trip, read off the answer rather than a flag.
    // `active` is first because neither window means anything on a surface
    // that is not searching.
    settling: active && (debouncedQuery !== input || answer?.query !== debouncedQuery),
  };
}
