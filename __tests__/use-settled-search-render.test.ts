import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { PROFILE_SEARCH_DEBOUNCE_MS } from "@/lib/debounce-helpers";
import { useSettledSearch } from "@/lib/use-settled-search";

import { withCapturedTimers } from "./helpers/capture-timers";
import { autoUnmount, installNativeModuleStubs, render, type RenderResult } from "./helpers/render";

installNativeModuleStubs();
autoUnmount();

/**
 * The debounced search, RUN.
 *
 * `use-settled-search.test.ts` pins the module's shape and its two adoptions;
 * what it cannot say is the half the hook exists for, because every claim in
 * it would also be true of a hook that fetched per keystroke, never cancelled,
 * or reported `settling: false` through the window where nothing has been sent
 * yet. Those were the three defects the two screens had between them before
 * the state was invented, and all three are invisible to a source read:
 *
 *  - that the FIRST window is covered — `settling` is true from the keystroke,
 *    before any request exists, which is what stops an empty state
 *    contradicting a search that has not been sent;
 *  - that a superseded response cannot overwrite a newer one, which a
 *    `cancelled` flag only does if the cleanup actually returns it;
 *  - that a request is not re-sent per render although `search` is a new
 *    closure every time — the failure mode of the ref being dropped into the
 *    dependency list is an infinite fetch loop, and every regex in the sibling
 *    suite passes on it.
 *
 * Timers are captured rather than run forward; see `helpers/capture-timers.ts`.
 */

type ProbeProps = {
  input: string;
  active: boolean;
  search: (query: string) => Promise<string[]>;
  delayMs?: number;
};

/** A tree whose only job is to call the hook and show the three things it returns. */
function Probe({ input, active, search, delayMs }: ProbeProps) {
  const { results, query, settling } = useSettledSearch({ input, active, search, delayMs });
  return createElement(
    "Text",
    null,
    `${settling ? "settling" : "settled"}|${query}|${results.join(",")}`,
  );
}

const probe = (props: ProbeProps) => createElement(Probe, props);

/**
 * A mounted probe over an EMPTY field, which is how both surfaces open.
 *
 * Mounting with text already in the field searches for it on the first pass —
 * `useDebouncedValue` seeds its state with the incoming value, deliberately,
 * so a search box is never blank for a debounce window. The window these cases
 * are about is the one after a KEYSTROKE, which is what `type()` produces.
 */
const mounted = (search: ProbeProps["search"], delayMs?: number) =>
  render(probe({ input: "", active: false, search, delayMs }));

const type = (result: RenderResult, input: string, search: ProbeProps["search"], delayMs?: number) =>
  result.rerender(probe({ input, active: input.length > 0, search, delayMs }));

/** The pass after an effect's `setState`, which is where that state shows up. */
const committed = (result: RenderResult) => (result.dirty ? result.rerender() : result);

const shown = (result: RenderResult) => {
  const [settling, query, results] = result.texts().join("").split("|");
  return { settling: settling === "settling", query, results };
};

/** Lets the `.then`/`.finally` chain of an already-resolved request run. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** A `search` that records what it was asked and answers on demand. */
function deferredSearch() {
  const asked: string[] = [];
  const answer: ((rows: string[]) => void)[] = [];
  const reject: ((reason: Error) => void)[] = [];
  const search = (query: string) =>
    new Promise<string[]>((resolve, fail) => {
      asked.push(query);
      answer.push(resolve);
      reject.push(fail);
    });
  return { asked, answer, reject, search };
}

describe("the window with no request in it", () => {
  it("settles nothing and sends nothing for the length of the debounce", async () => {
    // The defect this state was invented for, on both surfaces a day apart:
    // "nothing found" rendered for a debounce window plus a round trip under a
    // field whose whole purpose is finding what is not loaded yet. An
    // "is a request in flight" flag cannot see this window at all.
    await withCapturedTimers((timers) => {
      const { asked, search } = deferredSearch();
      const typed = type(mounted(search), "ann", search);
      assert.deepEqual(asked, [], "a request was sent before the debounce settled");
      assert.equal(shown(typed).settling, true, "the empty state would have shown here");
      assert.deepEqual(timers.liveDelays(), [PROFILE_SEARCH_DEBOUNCE_MS]);
    });
  });

  it("stays settling across the round trip, then stops when the answer lands", async () => {
    await withCapturedTimers(async (timers) => {
      const { asked, answer, search } = deferredSearch();
      const typed = type(mounted(search), "ann", search);
      timers.live()[0].run();
      assert.deepEqual(asked, [], "the settle itself does not fetch — the next pass does");
      const sent = typed.rerender();
      assert.deepEqual(asked, ["ann"]);
      // The pass the debounce commits in: the query is the field's and no
      // answer has arrived. An `inFlight` boolean set by the effect reads
      // false here, which is the empty state for one frame mid-search — the
      // gap the answer-shaped state closes by construction.
      assert.equal(shown(sent).settling, true, "the request is still in the air");
      answer[0](["ann-row"]);
      await flush();
      const landed = sent.rerender();
      assert.deepEqual(shown(landed), { settling: false, query: "ann", results: "ann-row" });
    });
  });

  it("stops settling on a rejection, so a failed search cannot hide the empty state forever", async () => {
    await withCapturedTimers(async (timers) => {
      const { reject, search } = deferredSearch();
      const typed = type(mounted(search), "ann", search);
      timers.live()[0].run();
      const sent = typed.rerender();
      reject[0](new Error("offline"));
      await flush();
      const failed = sent.rerender();
      assert.equal(shown(failed).settling, false, "a dropped connection reads as a search still running");
      assert.equal(shown(failed).results, "", "the previous query's rows answered for this one");
    });
  });
});

describe("nothing is asked for when nobody is asking", () => {
  it("sends no request while `active` is false, even for a settled query", async () => {
    // The sheet sent a people request under a `collections` filter that would
    // never render a profile. `active` gates the request and the state with
    // one sentence, which is why it is one parameter.
    await withCapturedTimers((timers) => {
      const { asked, search } = deferredSearch();
      const result = render(probe({ input: "ann", active: false, search }));
      timers.live()[0].run();
      const settled = committed(result.rerender());
      assert.deepEqual(asked, []);
      assert.equal(shown(settled).settling, false, "a surface that is not searching is not settling");
    });
  });

  it("drops the rows AT ONCE when the field is cleared, not a debounce window later", async () => {
    await withCapturedTimers(async (timers) => {
      const { answer, search } = deferredSearch();
      const typed = type(mounted(search), "ann", search);
      timers.live()[0].run();
      const sent = typed.rerender();
      answer[0](["ann-row"]);
      await flush();
      const landed = sent.rerender();
      assert.equal(shown(landed).results, "ann-row");
      // `active` goes false with the keystroke; the debounce still holds "ann",
      // so the old gate (a non-empty settled query) would have kept the rows.
      const cleared = committed(type(landed, "", search));
      assert.equal(shown(cleared).query, "ann", "the debounce has not caught up yet");
      assert.equal(shown(cleared).results, "", "stale rows survived the clear");
      assert.equal(shown(cleared).settling, false);
    });
  });
});

describe("a late response cannot overwrite a newer one", () => {
  it("ignores the superseded request when both resolve out of order", async () => {
    // The cleanup has to RETURN the flag, which every source regex for
    // `cancelled = true` passes without.
    await withCapturedTimers(async (timers) => {
      const { asked, answer, search } = deferredSearch();
      const first = type(mounted(search), "an", search).rerender();
      timers.live()[0].run();
      const sent = first.rerender();
      assert.deepEqual(asked, ["an"]);

      const narrowed = type(sent, "ann", search);
      timers.live()[0].run();
      const second = narrowed.rerender();
      assert.deepEqual(asked, ["an", "ann"]);

      answer[1](["ann-row"]);
      await flush();
      answer[0](["an-row"]);
      await flush();

      const final = second.rerender();
      assert.equal(shown(final).results, "ann-row", "the stale response won");
      assert.equal(shown(final).settling, false, "the stale `.finally` cleared the newer flag");
    });
  });
});

describe("the request is not re-sent per render", () => {
  it("survives a `search` whose identity changes every render", async () => {
    // Both call sites close over a per-surface row limit, so the function is a
    // new closure every render. In the dependency list that is an infinite
    // fetch loop — each response is a `setState`, which is another render —
    // and this is the case that would catch the ref being dropped.
    await withCapturedTimers(async (timers) => {
      const asked: string[] = [];
      const fresh = () => async (query: string) => {
        asked.push(query);
        return [query];
      };
      let pass = type(mounted(fresh()), "ann", fresh());
      timers.live()[0].run();
      pass = pass.rerender();
      await flush();
      for (let i = 0; i < 4; i += 1) {
        pass = type(pass, "ann", fresh());
        await flush();
      }
      assert.deepEqual(asked, ["ann"], "the request re-fired on a render that changed nothing");
    });
  });

  it("re-arms the debounce at a caller's delay rather than the default", async () => {
    await withCapturedTimers((timers) => {
      const { search } = deferredSearch();
      type(mounted(search, 900), "ann", search, 900);
      assert.deepEqual(timers.liveDelays(), [900]);
    });
  });
});

describe("the pending request is dropped with the tree", () => {
  it("clears the debounce on unmount, so no settle fires into a dead tree", async () => {
    await withCapturedTimers((timers) => {
      const { search } = deferredSearch();
      const typed = type(mounted(search), "ann", search);
      assert.equal(timers.live().length, 1);
      typed.unmount();
      assert.deepEqual(timers.live(), [], "the settle outlived the tree that asked for it");
    });
  });

  it("marks an in-flight response cancelled on unmount", async () => {
    await withCapturedTimers(async (timers) => {
      const { answer, search } = deferredSearch();
      const typed = type(mounted(search), "ann", search);
      timers.live()[0].run();
      const sent = typed.rerender();
      sent.unmount();
      answer[0](["ann-row"]);
      // The assertion is that nothing throws: a `setState` on an unmounted
      // tree is what the `cancelled` flag is standing in front of.
      await flush();
    });
  });
});
