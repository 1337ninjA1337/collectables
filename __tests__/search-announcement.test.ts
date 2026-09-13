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

describe("when a result count is worth saying", () => {
  it("speaks the first count under a new query", () => {
    const decision = searchAnnouncement(state("ring", 12), null);
    assert.equal(decision.speak, true);
    assert.deepEqual(decision.spoken, state("ring", 12));
  });

  it("says nothing when the number has not moved", () => {
    // The user typed another letter and the count is the same: repeating "12
    // results" answers a question nobody asked and cuts off whatever the
    // reader was saying.
    const decision = searchAnnouncement(state("rings", 12), state("ring", 12));
    assert.equal(decision.speak, false);
  });

  it("still remembers the query on a silent round", () => {
    // The memory tracks the FIELD, not the last thing said: otherwise the
    // count that follows would be compared against a query two keystrokes old.
    const decision = searchAnnouncement(state("rings", 12), state("ring", 12));
    assert.deepEqual(decision.spoken, state("rings", 12));
  });

  it("speaks a count that narrowed and one that widened", () => {
    assert.equal(searchAnnouncement(state("ringo", 3), state("ring", 12)).speak, true);
    assert.equal(searchAnnouncement(state("rin", 40), state("ring", 12)).speak, true);
  });

  it("speaks a search that found nothing", () => {
    // Zero is the most useful number this can say — it is the difference
    // between "no matches" and "the app did not react".
    const decision = searchAnnouncement(state("qqq", 0), state("ring", 12));
    assert.equal(decision.speak, true);
  });

  it("is silent on an empty field, and forgets what it said", () => {
    // With nothing typed the overlay renders no section at all, so an empty
    // field is not "0 results" — it is not a search.
    const decision = searchAnnouncement(state("", 0), state("ring", 12));
    assert.equal(decision.speak, false);
    assert.equal(decision.spoken, null);
  });

  it("treats whitespace as empty, the way the overlay does", () => {
    // `q` is `query.trim().toLowerCase()`, so " " matches everything; a rule
    // that read it as a query would announce the whole collection.
    assert.equal(searchAnnouncement(state("   ", 0), null).speak, false);
  });

  it("announces the same query again after the field was cleared", () => {
    // THE POINT OF FORGETTING. A second search is a new question and deserves
    // the same answer, even though the number has not changed since.
    const first = searchAnnouncement(state("ring", 12), null);
    const cleared = searchAnnouncement(state("", 0), first.spoken);
    const again = searchAnnouncement(state("ring", 12), cleared.spoken);
    assert.equal(again.speak, true);
  });

  it("does not speak twice for one count arriving in two renders", () => {
    // The local matches render immediately and the remote profile search
    // resolves after; when it adds nothing, the second render must be silent.
    const first = searchAnnouncement(state("ring", 12), null);
    assert.equal(searchAnnouncement(state("ring", 12), first.spoken).speak, false);
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
  });

  it("remembers what was spoken in a ref, not in state", () => {
    // State here would re-render on every announcement, and a re-render is
    // what this effect is reacting to.
    assert.match(OVERLAY, /useRef<SearchResultsState \| null>\(null\)/);
  });

  it("asks the shared rule rather than comparing counts inline", () => {
    assert.match(OVERLAY, /searchAnnouncement\(\{ query: q, total: totalResults \}/);
    assert.match(OVERLAY, /announceMessage\(t\("searchResultsAnnouncement", \{ count: totalResults \}\)\)/);
  });

  it("speaks through the shared channel, so two callers are heard in turn", () => {
    // `announceForAccessibility` interrupts; `lib/announce.ts` is the queue
    // that stops a toast cutting this off mid-word.
    assert.match(OVERLAY, /from "@\/lib\/announce"/);
  });
});
