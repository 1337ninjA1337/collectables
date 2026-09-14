import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { DEFAULT_DEBOUNCE_MS, useDebouncedValue } from "@/lib/use-debounced-value";

import { withCapturedTimers } from "./helpers/capture-timers";
import { autoUnmount, installNativeModuleStubs, render } from "./helpers/render";

installNativeModuleStubs();
autoUnmount();

/**
 * The debounce, RUN.
 *
 * `use-debounced-value.test.ts` exercises the pure half directly and pins the
 * hook itself structurally, with a header that explains why: "the repo has no
 * React mounting harness". That sentence was true when it was written and
 * stopped being true the day `helpers/render.ts` landed — and the timer half,
 * which is the whole point of a debounce, was still being asserted by
 * `assert.doesNotMatch(code, /setTimeout/)` in the files that no longer own one.
 *
 * What a source match cannot say, and what these say instead:
 *
 *  - that a burst leaves exactly ONE timer standing rather than one per
 *    keystroke, which is the behaviour the hook exists for;
 *  - that the previous timer is CLEARED rather than merely superseded — a
 *    cleanup returning the wrong handle, or none, matches every regex in that
 *    file and leaks a settle per keystroke;
 *  - that unmount clears it, so nothing fires into a torn-down tree. The hook's
 *    own doc claims this ("the timer is cleared on unmount") and nothing
 *    checked it;
 *  - that a zero delay takes the no-timer path and commits in the same pass,
 *    rather than scheduling a `setTimeout(fn, 0)` that settles a tick late;
 *  - and that a nonsense delay reaches `setTimeout` as the default, which is
 *    the pure helper's job done where it actually matters.
 *
 * The timers are captured, not run forward: see `helpers/capture-timers.ts` for
 * why this is not a fake clock.
 */

/** A tree whose only job is to call the hook and show what it settled on. */
function Probe({ value, delayMs }: { value: string; delayMs?: number }) {
  const settled = useDebouncedValue(value, delayMs);
  return createElement("Text", null, settled);
}

const probe = (value: string, delayMs?: number) =>
  createElement(Probe, { value, delayMs });

/** The one string the probe rendered. */
const shown = (result: { texts: () => string[] }) => result.texts().join("");

describe("the debounce hook, mounted", () => {
  it("shows the first value immediately and arms one timer at the default delay", async () => {
    // A debounce that lagged its FIRST value would leave a search box empty
    // for 150ms on every mount.
    await withCapturedTimers((timers) => {
      const result = render(probe("penny"));
      assert.equal(shown(result), "penny");
      assert.deepEqual(timers.liveDelays(), [DEFAULT_DEBOUNCE_MS]);
    });
  });

  it("leaves exactly one timer standing through a burst of keystrokes", async () => {
    // The whole point of the hook: five keystrokes are one downstream update,
    // not five. A cleanup that returned the wrong handle would leave five
    // armed here and match every source regex in the sibling suite.
    await withCapturedTimers((timers) => {
      const result = render(probe("p"));
      for (const value of ["pe", "pen", "penn", "penny"]) result.rerender(probe(value));
      assert.equal(timers.scheduled.length, 5, "one timer per keystroke was armed");
      assert.deepEqual(timers.liveDelays(), [DEFAULT_DEBOUNCE_MS], "the earlier four were not cleared");
    });
  });

  it("settles on the LAST value of the burst when the timer runs", async () => {
    await withCapturedTimers((timers) => {
      const result = render(probe("p"));
      result.rerender(probe("penny"));
      assert.equal(shown(result), "p", "it settled before the window ran out");
      timers.live()[0].run();
      assert.equal(shown(result.rerender()), "penny");
    });
  });

  it("does not re-arm for a value that did not change", async () => {
    // The no-op keystroke guard — a re-render for an unrelated reason must not
    // push the settle further away.
    await withCapturedTimers((timers) => {
      const result = render(probe("penny"));
      result.rerender(probe("penny"));
      result.rerender(probe("penny"));
      assert.equal(timers.scheduled.length, 1);
      assert.deepEqual(timers.liveDelays(), [DEFAULT_DEBOUNCE_MS]);
    });
  });

  it("clears the pending settle on unmount, so nothing fires into a dead tree", async () => {
    // The hook's doc comment has claimed this since it was written; this is
    // the first thing to check it.
    await withCapturedTimers((timers) => {
      const result = render(probe("penny"));
      assert.equal(timers.live().length, 1);
      result.unmount();
      assert.deepEqual(timers.live(), [], "the settle outlived the tree that asked for it");
    });
  });

  it("takes the no-timer path for a zero delay instead of setTimeout(fn, 0)", async () => {
    // `setTimeout(fn, 0)` would settle a tick late, which is a re-render an
    // explicit opt-out of debouncing did not ask for.
    await withCapturedTimers((timers) => {
      const result = render(probe("penny", 0));
      result.rerender(probe("nickel", 0));
      assert.deepEqual(timers.scheduled, [], "a zero delay still reached setTimeout");
      // The commit landed while the effects were flushing, which is why the
      // value is there with no timer to run: the harness only rebuilds the
      // tree on the next pass, so `dirty` is where the settle shows up first.
      assert.equal(result.dirty, true, "nothing was committed at all");
      assert.equal(shown(result.rerender()), "nickel");
    });
  });

  it("hands setTimeout the default rather than a nonsense delay", async () => {
    // Infinity would stall the settle forever and a negative would fire before
    // the value is read. `resolveDebounceDelay` folds both; this is that fold
    // observed at the timer rather than in isolation.
    for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      await withCapturedTimers((timers) => {
        render(probe("penny", nonsense));
        assert.deepEqual(
          timers.liveDelays(),
          [DEFAULT_DEBOUNCE_MS],
          `a delay of ${String(nonsense)} reached setTimeout unfolded`,
        );
      });
    }
  });

  it("re-arms at the new delay when the delay itself changes", async () => {
    // `delay` is in the dependency list beside `value`; a hook that listed only
    // `value` would keep the first delay forever and nothing else would say so.
    await withCapturedTimers((timers) => {
      const result = render(probe("penny", 300));
      result.rerender(probe("penny", 900));
      assert.deepEqual(timers.liveDelays(), [900]);
      assert.equal(timers.scheduled.length, 2);
    });
  });
});
