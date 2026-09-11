import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  ANNOUNCEMENT_HOLD_MS,
  createAnnouncementQueue,
} from "@/lib/announce-queue";

/**
 * The order two callers are heard in, when they speak at once.
 *
 * `announce-web.test.ts` owns the region — that a node is in the document
 * before its text changes, that it is hidden in a way a reader can still see,
 * that a repeat is a mutation. What is here is the part that has nothing to do
 * with a DOM: WHICH sentences reach the channel, and in what order, when more
 * arrive than one channel can carry. Under mock timers, because every question
 * worth asking is about the boundary of the hold rather than about any
 * duration.
 *
 * The rule it pins is one held message and one pending slot. Both halves are
 * deliberate and they point in opposite directions: nothing is lost to a
 * second caller, and nothing waits behind four positions the user has already
 * moved past.
 */

function makeHarness(holdMs?: number) {
  const said: string[] = [];
  const queue = createAnnouncementQueue({
    speak: (message) => void said.push(message),
    holdMs,
  });
  return { queue, said };
}

describe("createAnnouncementQueue", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it("says the first sentence synchronously", () => {
    // It is about something the user just did. A screen reader that answers a
    // keypress a tick late is worse than one that answers it now, which is why
    // this is a hold and not a debounce.
    const { queue, said } = makeHarness();

    queue.push("Picked up Alpha");

    assert.deepEqual(said, ["Picked up Alpha"]);
  });

  it("holds the channel for the documented window", () => {
    assert.equal(ANNOUNCEMENT_HOLD_MS, 150);
    const { queue, said } = makeHarness();

    queue.push("first");
    queue.push("second");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS - 1);
    assert.deepEqual(said, ["first"], "the second must not overwrite the first early");

    mock.timers.tick(1);
    assert.deepEqual(said, ["first", "second"]);
  });

  it("lets two callers in one tick both be heard, in order", () => {
    // The failure this exists for: a toast and a keyboard move in the same
    // tick, one of them silently lost.
    const { queue, said } = makeHarness();

    queue.push("Moved to position 3 of 7");
    queue.push("Sort cleared");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);

    assert.deepEqual(said, ["Moved to position 3 of 7", "Sort cleared"]);
  });

  it("keeps only the newest of the sentences waiting", () => {
    const { queue, said } = makeHarness();

    queue.push("position 1 of 5");
    queue.push("position 2 of 5");
    queue.push("position 3 of 5");
    queue.push("position 4 of 5");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);

    assert.deepEqual(said, ["position 1 of 5", "position 4 of 5"]);
  });

  it("holds again after the waiting sentence is said", () => {
    // Or a burst would drain one per tick after the first hold, which is the
    // interruption this replaces.
    const { queue, said } = makeHarness();

    queue.push("a");
    queue.push("b");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);
    assert.deepEqual(said, ["a", "b"]);

    queue.push("c");
    assert.deepEqual(said, ["a", "b"], "b still holds the channel");

    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);
    assert.deepEqual(said, ["a", "b", "c"]);
  });

  it("speaks immediately again once the channel has gone quiet", () => {
    const { queue, said } = makeHarness();

    queue.push("a");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);
    queue.push("b");

    assert.deepEqual(said, ["a", "b"], "a lone sentence never waits");
  });

  it("says the same sentence twice when it is pushed twice", () => {
    // A drag that ends where it started and the user pressing the same key
    // again: the sentence is identical and it is a new fact.
    const { queue, said } = makeHarness();

    queue.push("Moved to position 3 of 7");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);
    queue.push("Moved to position 3 of 7");

    assert.deepEqual(said, ["Moved to position 3 of 7", "Moved to position 3 of 7"]);
  });

  it("is not an announcement when there is nothing to say", () => {
    // The web region would write an empty string, which is a mutation to
    // nothing; native would read a blank sentence out loud.
    const { queue, said } = makeHarness();

    queue.push("");
    assert.deepEqual(said, []);
    assert.equal(queue.speaking(), false, "an empty push must not take the channel");

    queue.push("real");
    queue.push("");
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);
    assert.deepEqual(said, ["real"], "and must not displace what is waiting either");
  });

  it("reports what is holding the channel and what is waiting on it", () => {
    const { queue } = makeHarness();

    assert.equal(queue.speaking(), false);
    assert.equal(queue.pending(), null);

    queue.push("first");
    assert.equal(queue.speaking(), true);
    assert.equal(queue.pending(), null, "the first is said, not queued");

    queue.push("second");
    assert.equal(queue.pending(), "second");

    mock.timers.tick(ANNOUNCEMENT_HOLD_MS);
    assert.equal(queue.pending(), null);
    assert.equal(queue.speaking(), true, "the second holds it now");
  });

  it("drops the waiting sentence and the hold on reset", () => {
    // The channel is module state in both spellings of `lib/announce`, so a
    // suite that announces would otherwise arm a timer for the one after it.
    const { queue, said } = makeHarness();

    queue.push("first");
    queue.push("second");
    queue.reset();
    mock.timers.tick(ANNOUNCEMENT_HOLD_MS * 4);

    assert.deepEqual(said, ["first"]);
    assert.equal(queue.speaking(), false);
    assert.equal(queue.pending(), null);
  });

  it("speaks immediately after a reset", () => {
    const { queue, said } = makeHarness();

    queue.push("first");
    queue.reset();
    queue.push("second");

    assert.deepEqual(said, ["first", "second"]);
  });

  it("honours a caller's own hold", () => {
    const { queue, said } = makeHarness(20);

    queue.push("a");
    queue.push("b");
    mock.timers.tick(19);
    assert.deepEqual(said, ["a"]);

    mock.timers.tick(1);
    assert.deepEqual(said, ["a", "b"]);
  });

  it("keeps one queue's channel out of another's", () => {
    // Two instances exist in the tree — the native spelling and the web one —
    // and Metro serves one per platform. A shared module-level timer would
    // make them one channel with two doors.
    const first = makeHarness();
    const second = makeHarness();

    first.queue.push("a");
    second.queue.push("b");

    assert.deepEqual(first.said, ["a"]);
    assert.deepEqual(second.said, ["b"], "the second queue was not holding anything");
  });
});
