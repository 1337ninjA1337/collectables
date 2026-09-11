import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { ReactionToggle } from "@/lib/reaction-toggle";
import {
  createReactionWriteQueue,
  reactionWriteKey,
  REACTION_WRITE_DEBOUNCE_MS,
} from "@/lib/reaction-write-queue";
import type { Reaction, ReactionEmoji } from "@/lib/types";

/**
 * Which writes a sequence of taps actually sends.
 *
 * `use-reactions.test.ts` mounts the hook, which is how the optimistic ORDER
 * is asserted — the row is on screen before the promise settles. What is here
 * is the half a mount makes expensive: the TIMING. Two taps 200ms apart, a
 * third arriving while the second is in flight, an unmount inside the window.
 * Real timers would make each of those a wall-clock cost, and the questions
 * worth asking are about the boundary (399ms against 400) rather than about
 * any duration in particular.
 *
 * The shape is `identify-scheduler.test.ts`'s, because the module's shape is
 * `identify-scheduler.ts`'s: a trailing debounce over a value where only the
 * settled one is worth sending.
 */

const TARGET = { targetType: "collection" as const, targetId: "c1" };

function row(id: string, emoji: ReactionEmoji): Reaction {
  return { id, userId: "me", ...TARGET, emoji, createdAt: "2026-09-11T00:00:00.000Z" };
}

function add(emoji: ReactionEmoji, id = `add-${emoji}`): ReactionToggle {
  return { kind: "add", row: row(id, emoji), rows: [] };
}

function remove(emoji: ReactionEmoji, id = `rm-${emoji}`): ReactionToggle {
  return { kind: "remove", row: row(id, emoji), rows: [] };
}

/** Flushes the microtask queue without advancing the mocked clock. */
async function drain(): Promise<void> {
  for (let pass = 0; pass < 12; pass += 1) await Promise.resolve();
}

function makeHarness(debounceMs?: number) {
  const writes: { kind: string; emoji: string }[] = [];
  const failures: string[] = [];
  /** Set to hold the next write open; resolved by the case. */
  let release: (() => void) | null = null;
  let holdNext = false;
  let reject = false;

  const queue = createReactionWriteQueue({
    write: async (toggle) => {
      writes.push({ kind: toggle.kind, emoji: toggle.row.emoji });
      if (release === null && holdNext) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (reject) throw new Error("rls");
    },
    onFailure: (toggle) => void failures.push(`${toggle.kind}:${toggle.row.emoji}`),
    debounceMs,
  });

  return {
    queue,
    writes,
    failures,
    key: (emoji: ReactionEmoji) => reactionWriteKey(TARGET.targetType, TARGET.targetId, emoji),
    hold: () => {
      holdNext = true;
    },
    release: () => {
      const resolve = release;
      release = null;
      holdNext = false;
      resolve?.();
    },
    failNext: () => {
      reject = true;
    },
  };
}

describe("reactionWriteKey", () => {
  it("separates the same emoji on two different targets", () => {
    assert.notEqual(
      reactionWriteKey("collection", "c1", "heart"),
      reactionWriteKey("collection", "c2", "heart"),
    );
    assert.notEqual(
      reactionWriteKey("collection", "c1", "heart"),
      reactionWriteKey("item", "c1", "heart"),
    );
  });

  it("gives one emoji on one target one key", () => {
    assert.equal(
      reactionWriteKey("collection", "c1", "heart"),
      reactionWriteKey("collection", "c1", "heart"),
    );
  });
});

describe("createReactionWriteQueue", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it("waits the whole window before it sends anything", async () => {
    assert.equal(REACTION_WRITE_DEBOUNCE_MS, 400);
    const h = makeHarness();

    void h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS - 1);
    await drain();
    assert.deepEqual(h.writes, [], "must not fire before the window");

    mock.timers.tick(1);
    await drain();
    assert.deepEqual(h.writes, [{ kind: "add", emoji: "heart" }]);
  });

  it("sends nothing at all when a tap is undone inside the window", async () => {
    // The gesture this module exists for: on then off is one INSERT and one
    // DELETE for a row that lived microseconds, and the settled state is the
    // one the server already has.
    const h = makeHarness();

    const first = h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(200);
    const second = h.queue.submit(h.key("heart"), remove("heart"));

    await first;
    await second;
    assert.deepEqual(h.writes, []);
    assert.equal(h.queue.pending(), 0, "a collapsed pair leaves nothing behind");

    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS * 2);
    await drain();
    assert.deepEqual(h.writes, [], "and no timer is left to fire it later");
  });

  it("resolves a collapsed pair without waiting for the window", async () => {
    // Nothing is going to happen to either tap, so a promise that waited out
    // the debounce would be waiting for a write that was already cancelled.
    const h = makeHarness();

    const both = Promise.all([
      h.queue.submit(h.key("star"), add("star")),
      h.queue.submit(h.key("star"), remove("star")),
    ]);

    await both;
    assert.deepEqual(h.writes, []);
  });

  it("sends the settled direction when the taps are odd", async () => {
    const h = makeHarness();

    void h.queue.submit(h.key("fire"), add("fire"));
    void h.queue.submit(h.key("fire"), remove("fire"));
    void h.queue.submit(h.key("fire"), add("fire", "add-2"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    assert.deepEqual(h.writes, [{ kind: "add", emoji: "fire" }], "three taps, one write");
  });

  it("re-arms the window on every tap rather than counting from the first", async () => {
    const h = makeHarness();

    void h.queue.submit(h.key("eyes"), add("eyes"));
    mock.timers.tick(300);
    void h.queue.submit(h.key("eyes"), remove("eyes"));
    void h.queue.submit(h.key("eyes"), add("eyes", "add-2"));
    mock.timers.tick(300);
    await drain();
    assert.deepEqual(h.writes, [], "the last tap restarts the window");

    mock.timers.tick(100);
    await drain();
    assert.deepEqual(h.writes, [{ kind: "add", emoji: "eyes" }]);
  });

  it("keeps two emoji on one target apart", async () => {
    // One key's settled direction says nothing about another's, and a queue
    // that shared a slot would have the second tap cancel the first.
    const h = makeHarness();

    void h.queue.submit(h.key("heart"), add("heart"));
    void h.queue.submit(h.key("clap"), add("clap"));
    assert.equal(h.queue.pending(), 2);

    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    assert.deepEqual(h.writes, [
      { kind: "add", emoji: "heart" },
      { kind: "add", emoji: "clap" },
    ]);
  });

  it("keeps the same emoji on two targets apart", async () => {
    // Two reaction bars can be mounted at once — an item over the collection
    // it belongs to — and they share this module's timers.
    const h = makeHarness();

    void h.queue.submit(reactionWriteKey("collection", "c1", "heart"), add("heart"));
    void h.queue.submit(reactionWriteKey("item", "i1", "heart"), remove("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    assert.equal(h.writes.length, 2, "one target's tap must not cancel another's");
  });

  it("rolls back the toggle the cloud refused", async () => {
    const h = makeHarness();
    h.failNext();

    const tap = h.queue.submit(h.key("star"), add("star"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await tap;

    assert.deepEqual(h.failures, ["add:star"]);
    assert.equal(h.queue.pending(), 0);
  });

  it("rolls back nothing for a tap that was never sent", async () => {
    const h = makeHarness();
    h.failNext();

    await Promise.all([
      h.queue.submit(h.key("star"), add("star")),
      h.queue.submit(h.key("star"), remove("star")),
    ]);

    assert.deepEqual(h.failures, [], "a collapsed tap cannot be refused");
  });

  it("holds a second write until the first has landed", async () => {
    // An INSERT and a DELETE for one row reaching the server concurrently can
    // arrive in either order, which is the one way this module could leave the
    // cloud disagreeing with the screen.
    const h = makeHarness();
    h.hold();

    void h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();
    assert.deepEqual(h.writes, [{ kind: "add", emoji: "heart" }]);

    void h.queue.submit(h.key("heart"), remove("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS * 3);
    await drain();
    assert.equal(h.writes.length, 1, "the in-flight write is not overtaken");

    h.release();
    await drain();
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    assert.deepEqual(h.writes, [
      { kind: "add", emoji: "heart" },
      { kind: "remove", emoji: "heart" },
    ]);
  });

  it("lets two taps behind an in-flight write collapse each other", async () => {
    const h = makeHarness();
    h.hold();

    void h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    void h.queue.submit(h.key("heart"), remove("heart"));
    void h.queue.submit(h.key("heart"), add("heart", "add-2"));

    h.release();
    await drain();
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS * 2);
    await drain();

    assert.equal(h.writes.length, 1, "the pair behind the write nets to nothing");
    assert.equal(h.queue.pending(), 0);
  });

  it("holds the waiters of a collapse behind an in-flight write", async () => {
    // The write is already gone and it carries the state those two taps
    // settled on, so their fate is its fate — resolving them early would say
    // the cloud had answered when it had not.
    const h = makeHarness();
    h.hold();

    void h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    let settled = false;
    const pair = Promise.all([
      h.queue.submit(h.key("heart"), remove("heart")),
      h.queue.submit(h.key("heart"), add("heart", "add-2")),
    ]).then(() => {
      settled = true;
    });

    await drain();
    assert.equal(settled, false, "the in-flight write has not answered yet");

    h.release();
    await pair;
    assert.equal(settled, true);
  });

  it("sends what is waiting when the owner goes away", async () => {
    // A tap and then a back-swipe. The window is a batching delay, never a way
    // to lose a reaction.
    const h = makeHarness();

    void h.queue.submit(h.key("clap"), add("clap"));
    assert.deepEqual(h.writes, []);

    const flushed = h.queue.flush();
    mock.timers.tick(0);
    await flushed;

    assert.deepEqual(h.writes, [{ kind: "add", emoji: "clap" }]);
    assert.equal(h.queue.pending(), 0);
  });

  it("flushes every key, not just the first", async () => {
    const h = makeHarness();

    void h.queue.submit(h.key("heart"), add("heart"));
    void h.queue.submit(h.key("fire"), add("fire"));
    void h.queue.submit(h.key("star"), remove("star"));

    const flushed = h.queue.flush();
    mock.timers.tick(0);
    await flushed;

    assert.equal(h.writes.length, 3);
    assert.equal(h.queue.pending(), 0);
  });

  it("flushes an empty queue without waiting for anything", async () => {
    const h = makeHarness();

    await h.queue.flush();

    assert.deepEqual(h.writes, []);
  });

  it("waits for an in-flight write before a flush resolves", async () => {
    const h = makeHarness();
    h.hold();

    void h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await drain();

    let done = false;
    const flushed = h.queue.flush().then(() => {
      done = true;
    });
    await drain();
    assert.equal(done, false, "the write has not landed");

    h.release();
    await drain();
    mock.timers.tick(0);
    await flushed;
    assert.equal(done, true);
  });

  it("honours a caller's own window", async () => {
    const h = makeHarness(50);

    void h.queue.submit(h.key("heart"), add("heart"));
    mock.timers.tick(49);
    await drain();
    assert.deepEqual(h.writes, []);

    mock.timers.tick(1);
    await drain();
    assert.equal(h.writes.length, 1);
  });

  it("counts a key once however many taps it has taken", async () => {
    const h = makeHarness();

    void h.queue.submit(h.key("heart"), add("heart"));
    void h.queue.submit(h.key("heart"), remove("heart"));
    void h.queue.submit(h.key("heart"), add("heart", "add-2"));

    assert.equal(h.queue.pending(), 1);
  });

  it("survives a write that throws before it returns a promise", async () => {
    // `write` is a caller's function and a synchronous throw from it would
    // otherwise escape as an unhandled rejection, taking the rollback with it.
    const failures: string[] = [];
    const queue = createReactionWriteQueue({
      write: () => {
        throw new Error("no network");
      },
      onFailure: (toggle) => void failures.push(toggle.kind),
    });

    const tap = queue.submit("k", add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await tap;

    assert.deepEqual(failures, ["add"]);
    assert.equal(queue.pending(), 0);
  });

  it("works with no failure handler at all", async () => {
    const queue = createReactionWriteQueue({
      write: async () => {
        throw new Error("rls");
      },
    });

    const tap = queue.submit("k", add("heart"));
    mock.timers.tick(REACTION_WRITE_DEBOUNCE_MS);
    await tap;

    assert.equal(queue.pending(), 0);
  });
});
