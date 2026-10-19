import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { be } from "@/lib/i18n/be";
import { de } from "@/lib/i18n/de";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { pl } from "@/lib/i18n/pl";
import { ru } from "@/lib/i18n/ru";
import type { TranslationValue } from "@/lib/i18n/types";
import { searchAnnouncement, type SearchResultsState } from "@/lib/search-announcement";

import { readRepoFile as read } from "./helpers/repo-file";

/**
 * What the search overlay says out loud, and — mostly — when it says nothing.
 *
 * The three section headings landed this morning, which is what a screen
 * reader navigates to AFTER going looking. This is the other half: the count
 * that says whether the last keystroke helped, spoken when it changes.
 *
 * Every case below is about a silence. An announcement per render would
 * interrupt the reader mid-word on every keystroke, which is a worse overlay
 * than the one with no announcements at all.
 */

const state = (query: string, total: number): SearchResultsState => ({ query, total });

/**
 * The settled call, which is what every case below 2026-10-19 was written for.
 *
 * `searchAnnouncement`'s third argument became REQUIRED that day — the gate
 * that keeps an in-flight total from being spoken moved out of the overlay's
 * effect and into the module with the rest of the policy — and a required
 * option is the point: a caller that forgot it would still work, and would be
 * silently wrong only on the queries the server alone can answer. The cases
 * that are ABOUT readiness pass it explicitly, below.
 */
const decide = (next: SearchResultsState, spoken: SearchResultsState | null) =>
  searchAnnouncement(next, spoken, { settled: true });

describe("when a result count is worth saying", () => {
  it("speaks the first count under a new query", () => {
    const decision = decide(state("ring", 12), null);
    assert.equal(decision.speak, true);
    assert.deepEqual(decision.spoken, state("ring", 12));
  });

  it("says nothing when the number has not moved", () => {
    // The user typed another letter and the count is the same: repeating "12
    // results" answers a question nobody asked and cuts off whatever the
    // reader was saying.
    const decision = decide(state("rings", 12), state("ring", 12));
    assert.equal(decision.speak, false);
  });

  it("still remembers the query on a silent round", () => {
    // The memory tracks the FIELD, not the last thing said: otherwise the
    // count that follows would be compared against a query two keystrokes old.
    const decision = decide(state("rings", 12), state("ring", 12));
    assert.deepEqual(decision.spoken, state("rings", 12));
  });

  it("speaks a count that narrowed and one that widened", () => {
    assert.equal(decide(state("ringo", 3), state("ring", 12)).speak, true);
    assert.equal(decide(state("rin", 40), state("ring", 12)).speak, true);
  });

  it("speaks a search that found nothing", () => {
    // Zero is the most useful number this can say — it is the difference
    // between "no matches" and "the app did not react".
    const decision = decide(state("qqq", 0), state("ring", 12));
    assert.equal(decision.speak, true);
  });

  it("is silent on an empty field, and forgets what it said", () => {
    // With nothing typed the overlay renders no section at all, so an empty
    // field is not "0 results" — it is not a search.
    const decision = decide(state("", 0), state("ring", 12));
    assert.equal(decision.speak, false);
    assert.equal(decision.spoken, null);
  });

  it("treats whitespace as empty, the way the overlay does", () => {
    // `q` is `query.trim().toLowerCase()`, so " " matches everything; a rule
    // that read it as a query would announce the whole collection.
    assert.equal(decide(state("   ", 0), null).speak, false);
  });

  it("announces the same query again after the field was cleared", () => {
    // THE POINT OF FORGETTING. A second search is a new question and deserves
    // the same answer, even though the number has not changed since.
    const first = decide(state("ring", 12), null);
    const cleared = decide(state("", 0), first.spoken);
    const again = decide(state("ring", 12), cleared.spoken);
    assert.equal(again.speak, true);
  });

  it("does not speak twice for one count arriving in two renders", () => {
    // The local matches render immediately and the remote profile search
    // resolves after; when it adds nothing, the second render must be silent.
    const first = decide(state("ring", 12), null);
    assert.equal(decide(state("ring", 12), first.spoken).speak, false);
  });
});

describe("what it says", () => {
  /** The six maps, so the sentence is read rather than the declaration counted. */
  const MAPS: Record<string, Record<string, TranslationValue>> = { en, ru, be, pl, de, es };

  const spoken = (map: Record<string, TranslationValue>, count: number): string => {
    const value = map.searchResultsAnnouncement;
    assert.equal(typeof value, "function", "the announcement must agree with a number");
    return typeof value === "function" ? String(value({ count })) : String(value);
  };

  it("agrees the noun with the number in every locale", () => {
    // One key, six languages, and three of them inflect on the last digit — a
    // flat template would read "1 результатов" on the most ordinary count
    // there is.
    for (const [code, map] of Object.entries(MAPS)) {
      assert.notEqual(spoken(map, 1), spoken(map, 5), `${code} says the same word for 1 and 5`);
    }
    assert.equal(spoken(en, 1), "1 result");
    assert.equal(spoken(en, 12), "12 results");
    assert.equal(spoken(ru, 1), "1 результат");
    assert.equal(spoken(ru, 3), "3 результата");
    assert.equal(spoken(ru, 12), "12 результатов");
    assert.equal(spoken(pl, 3), "3 wyniki");
    assert.equal(spoken(be, 3), "3 вынікі");
  });

  it("translates rather than inheriting the English word", () => {
    // A locale that fell through to the base map would announce results in
    // English under a Polish setting, which every other rule here would pass.
    for (const [code, map] of Object.entries(MAPS)) {
      if (code === "en") continue;
      assert.notEqual(spoken(map, 12), spoken(en, 12), `${code} inherits the English wording`);
    }
  });

  it("says a number and not a sentence about a number", () => {
    // It is read after every narrowing keystroke, so it is as short as it can
    // be while still answering the question.
    for (const [code, map] of Object.entries(MAPS)) {
      const said = spoken(map, 12);
      assert.ok(said.startsWith("12 "), `${code} does not lead with the count: ${said}`);
      assert.ok(said.split(" ").length <= 3, `${code} says too much: ${said}`);
    }
  });
});

describe("the overlay around it", () => {
  const OVERLAY = read("components/search-overlay.tsx");

  it("waits for typing to settle before speaking", () => {
    // An announcement per keystroke interrupts the reader mid-word, which is
    // the failure this feature exists to prevent rather than cause.
    assert.match(OVERLAY, /if \(debouncedQuery !== q\) return;/);
    // And the readiness the module now decides on, rather than a second
    // `return` here: not while the people request for that settled query is
    // still in flight. `totalResults` is then the catalogue halves plus
    // whatever the PREVIOUS query's rows still answer, so speaking it meant
    // "0 results" and then "1 result" for the commonest use of this box —
    // pasting a profile ID only the server knows.
    assert.match(OVERLAY, /\{ settled: !peopleSearchSettling \}/);
    assert.ok(
      !/if \(peopleSearchSettling\) return;/.test(OVERLAY),
      "half the announcement policy is back at the call site",
    );
  });

  it("remembers what was spoken in a ref, not in state", () => {
    // State here would re-render on every announcement, and a re-render is
    // what this effect is reacting to.
    assert.match(OVERLAY, /useRef<SearchResultsState \| null>\(null\)/);
  });

  it("asks the shared rule rather than comparing counts inline", () => {
    assert.match(
      OVERLAY,
      /searchAnnouncement\(\s*\{ query: q, total: totalResults \},\s*spokenResults\.current,\s*\{ settled: !peopleSearchSettling \},\s*\)/,
    );
    assert.match(OVERLAY, /announceMessage\(t\("searchResultsAnnouncement", \{ count: totalResults \}\)\)/);
  });

  it("speaks through the shared channel, so two callers are heard in turn", () => {
    // `announceForAccessibility` interrupts; `lib/announce.ts` is the queue
    // that stops a toast cutting this off mid-word.
    assert.match(OVERLAY, /from "@\/lib\/announce"/);
  });
});

describe("an unsettled count is not a count", () => {
  // The rule that moved out of `components/search-overlay.tsx` on 2026-10-19.
  // The sheet's people section is a 100-row snapshot PLUS a debounced server
  // query, so between a settled keystroke and its answer the total is the
  // catalogue halves plus whatever the previous query's rows still match.
  // Speaking it meant "0 results" and then, a round trip later, "1 result".
  it("says nothing while a request the total depends on is in flight", () => {
    const decision = searchAnnouncement(state("juno", 0), null, { settled: false });
    assert.equal(decision.speak, false);
  });

  it("does not remember a total it never said", () => {
    // The half a call-site `return` could not express. Recording the
    // in-flight zero would make the real announcement a repeat — and
    // `spoken.total === next.total` is silence — so the user would hear
    // nothing at all for the one query only the server can answer.
    const first = searchAnnouncement(state("juno", 0), null, { settled: false });
    assert.equal(first.spoken, null, "the memory must be returned unchanged");
    const landed = decide(state("juno", 1), first.spoken);
    assert.equal(landed.speak, true);
    assert.deepEqual(landed.spoken, state("juno", 1));
  });

  it("keeps an existing memory rather than clearing it", () => {
    // Unsettled is not "no search": the previous query's count is still the
    // last thing the user was told, and forgetting it would re-announce an
    // unchanged number when the request lands.
    const spoken = state("ring", 12);
    const decision = searchAnnouncement(state("ringo", 12), spoken, { settled: false });
    assert.equal(decision.speak, false);
    assert.deepEqual(decision.spoken, spoken);
  });

  it("forgets an emptied field even mid-flight", () => {
    // The whitespace/empty reset is answered BEFORE readiness: clearing the
    // field is not a search in any state, and the forget is what makes typing
    // the same query again audible.
    const decision = searchAnnouncement(state("", 0), state("ring", 12), { settled: false });
    assert.equal(decision.speak, false);
    assert.equal(decision.spoken, null);
  });

  it("speaks the same count once settled", () => {
    // The symmetry that makes the gate a DELAY rather than a suppression.
    assert.equal(searchAnnouncement(state("juno", 1), null, { settled: false }).speak, false);
    assert.equal(searchAnnouncement(state("juno", 1), null, { settled: true }).speak, true);
  });
});
