import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The half of `app/people.tsx` that had never been read.
 *
 * Its search half went through `lib/profile-search.ts` four times in a week
 * and gave up a real defect each time. The rest of the screen — the paging
 * effect, the refresh, the pager and the empty state — was named as unread in
 * the 2026-10-13, 2026-10-15 and 2026-10-17 suggestion rounds and nothing had
 * touched it. Reading it on 2026-10-19 found three defects, and this is what
 * holds the fixes.
 *
 * Source reads rather than a render: this is a screen that reaches
 * expo-router, the social context and `fetchProfiles`, and nothing in this
 * tree mounts it. Each case names the behaviour it is standing in for.
 */
const CODE = stripComments(readRepoFile("app/people.tsx"));

describe("the pager cannot race itself", () => {
  // Two taps on Next fired two `fetchProfiles` calls and whichever answered
  // LAST wrote the list — so it could settle on page 2 while the pager read
  // "Page 3 of 12", with nothing to correct it until the next tap. The search
  // effect in the same file has carried a `cancelled` flag since it was
  // written; the pager never did.
  it("stamps each page request and ignores a stale response", () => {
    assert.match(CODE, /const pageRequestRef = useRef\(0\);/);
    assert.match(CODE, /const request = pageRequestRef\.current \+ 1;\s*pageRequestRef\.current = request;/);
    assert.match(
      CODE,
      /const result = await fetchProfiles\(pageNum, PAGE_SIZE\);\s*if \(request !== pageRequestRef\.current\) return;/,
      "a stale page response must not overwrite a newer one",
    );
  });

  it("lets only the newest request stop the skeleton", () => {
    // An older request finishing afterwards would show the list as settled
    // while a page is still in flight.
    assert.match(CODE, /if \(request === pageRequestRef\.current\) setLoading\(false\);/);
  });

  it("uses a token rather than a per-call flag, because refresh calls it too", () => {
    // `handleRefresh` calls `loadPage` as well, and a refresh has to lose to
    // a page change started after it — which a `cancelled` boolean scoped to
    // one call cannot express.
    assert.match(CODE, /const handleRefresh = useCallback\([\s\S]*?loadPage\(page\)/);
  });
});

describe("the empty state waits for the search it is contradicting", () => {
  // Typing a profile ID that only the server knows matched nothing on the
  // loaded page, so "no people found" rendered for the debounce window plus a
  // round trip and then flipped to the answer — under a field whose whole
  // purpose is finding somebody who is NOT on this page. `loading` could not
  // cover it: that flag is about `fetchProfiles`, which is not running.
  it("knows when a search has been asked for and has not answered", () => {
    assert.match(CODE, /const \[searchInFlight, setSearchInFlight\] = useState\(false\);/);
    assert.match(
      CODE,
      /const searchSettling = searching && \(debouncedQuery !== query\.trim\(\) \|\| searchInFlight\);/,
      "both windows: the debounce that has not caught up, and the request in flight",
    );
  });

  it("covers the window where nothing has been requested yet", () => {
    // The debounce means `debouncedQuery` lags the field, so for
    // PROFILE_SEARCH_DEBOUNCE_MS after a keystroke there is no request at all
    // — the half an "is a request in flight" flag cannot see.
    assert.match(CODE, /debouncedQuery !== query\.trim\(\)/);
  });

  it("clears the flag on success, on failure and on an emptied field", () => {
    assert.match(CODE, /\.finally\(\(\) => \{\s*if \(!cancelled\) setSearchInFlight\(false\);\s*\}\)/);
    assert.match(CODE, /if \(!debouncedQuery\) \{\s*setSearchResults\(\[\]\);\s*setSearchInFlight\(false\);/);
  });

  it("renders rows over the skeleton and the skeleton over the empty state", () => {
    // The order is the fix. Rows first, so a keystroke that narrows a search
    // does not replace rows that still answer with a skeleton — that is the
    // responsiveness `profileSearchUnion` keeps stale-but-matching rows for.
    // Empty last, so it cannot contradict a search still in the air.
    assert.match(
      CODE,
      /\{loading \? \([\s\S]*?SkeletonProfileList[\s\S]*?\) : filteredPeople\.length > 0 \? \([\s\S]*?filteredPeople\.map\(renderProfileCard\)[\s\S]*?\) : searchSettling \? \([\s\S]*?SkeletonProfileList[\s\S]*?\) : \([\s\S]*?EmptyState/,
    );
  });
});

describe("the pager is hidden while a search is running", () => {
  // `totalPages` comes from `totalCount`, which is every profile in the table
  // and not the rows a search answered. So a query matching three people
  // rendered three cards under "Page 1 of 12", and Next fetched page 2 of the
  // UNFILTERED table — replacing `others` and changing the result list
  // underneath the user for a reason the label does not describe.
  it("gates the pagination block on not searching", () => {
    assert.match(CODE, /\{!loading && !searching && totalPages > 1 && \(/);
  });

  it("decides 'searching' from the needle the result list is filtered by", () => {
    // The screen had `profileSearchNeedle(query)` twice and `query.trim()`
    // twice — four reductions of one input and three spellings of "is a
    // search active". They disagree on a query of only metacharacters: `"%"`
    // trims to `"%"` and reduces to `""`, so the trimmed reading calls that a
    // search with no matches and the needle calls it no search at all.
    assert.match(CODE, /const needle = useMemo\(\(\) => profileSearchNeedle\(query\), \[query\]\);/);
    assert.match(CODE, /const searching = needle\.length > 0;/);
    assert.equal(
      CODE.split("profileSearchNeedle(").length - 1,
      1,
      "the needle is reduced more than once again",
    );
  });

  it("keeps query.trim() for the one thing that is about the field", () => {
    // What `useDebouncedValue` holds is what `searchProfiles` is asked for,
    // and `use-debounced-value.test.ts` pins it. `searchSettling` compares
    // against the same string because the question there is whether the
    // debounce has caught up with the FIELD.
    assert.match(CODE, /useDebouncedValue\(query\.trim\(\), PROFILE_SEARCH_DEBOUNCE_MS\)/);
    assert.equal(
      CODE.split("query.trim()").length - 1,
      2,
      "query.trim() is the debounce input and the comparison against it, and nothing else",
    );
  });

  it("filters the result list by the shared needle rather than re-reducing", () => {
    assert.match(CODE, /if \(!searching\) return others;/);
    assert.match(CODE, /\}, \[others, needle, searching, searchResults, myProfile\]\);/);
  });
});
