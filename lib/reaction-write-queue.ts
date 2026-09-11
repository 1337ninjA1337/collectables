/**
 * The network half of a tap on an emoji: which writes are actually sent, and
 * which two cancel each other out before anything leaves the device.
 *
 * `lib/reaction-toggle.ts` decides what the LIST looks like after a tap.
 * Nothing decided what the NETWORK sees, so every tap sent its own call:
 * on-then-off in one gesture was an INSERT and a DELETE for a row the server
 * created and dropped microseconds apart. The state was right either way —
 * what was wasted is two round trips, a row written to satisfy a user who had
 * already changed their mind, and, on a flaky connection, two chances for a
 * rollback to fire for a tap the user has already undone.
 *
 * ## A trailing debounce, keyed on (target, emoji)
 *
 * The same shape `lib/identify-scheduler.ts` uses for the analytics identify,
 * and for the same reason: only the SETTLED value is worth sending. The key is
 * the whole triple rather than the emoji alone, because two reaction bars can
 * be mounted at once (a collection and an item behind it) and one emoji's
 * settled direction says nothing about the other's.
 *
 * ## The collapse is by direction, not by counting taps
 *
 * A pending "add" meeting a "remove" drops BOTH: the list is back where the
 * server already has it, so the correct number of writes is zero. Counting
 * taps and taking the parity would give the same answer only while taps
 * strictly alternate, which is true of a finger on one emoji and not true of a
 * re-read landing in the middle of the window. Comparing the two directions
 * is right in both.
 *
 * ## One write per key at a time
 *
 * A tap arriving while that key's write is in flight cannot cancel it — it has
 * already gone — so it waits, and the window re-arms when the write lands.
 * Sending the second one concurrently would let an INSERT and a DELETE for one
 * row reach the server in either order, which is the one way this module could
 * leave the cloud disagreeing with the screen.
 *
 * ## `submit` resolves when the tap's fate is decided
 *
 * Written, refused and rolled back, or collapsed away. The reaction bar does
 * not await it — `onPress` is fire-and-forget — but the hook's own suite does,
 * and a promise that resolved when the tap was merely QUEUED would be asserting
 * against a queue rather than against the cloud.
 */

import type { ReactionToggle } from "@/lib/reaction-toggle";
import type { ReactionEmoji, ReactionTargetType } from "@/lib/types";

/**
 * How long a key's direction is allowed to keep changing before it is sent.
 *
 * Longer than the ~300ms a platform calls a double tap, so the ordinary "I
 * meant to un-react" gesture collapses; short enough that a reaction is
 * durable well inside the time it takes to leave the screen. The unmount
 * flushes anything still waiting, so the window is a batching delay and never
 * a way to lose a tap.
 */
export const REACTION_WRITE_DEBOUNCE_MS = 400;

export type ReactionWriteQueue = {
  /** Records a tap and resolves once its fate is decided. */
  readonly submit: (key: string, toggle: ReactionToggle) => Promise<void>;
  /** Sends everything still waiting, now; resolves when the queue is empty. */
  readonly flush: () => Promise<void>;
  /** How many keys still hold an unsent or unsettled write. */
  readonly pending: () => number;
};

/**
 * The queue key for one emoji on one target.
 *
 * Two bars mounted at once share this module's timers, so the target has to be
 * part of the key or a tap on one screen would collapse a tap on the other.
 */
export function reactionWriteKey(
  targetType: ReactionTargetType,
  targetId: string,
  emoji: ReactionEmoji,
): string {
  return `${targetType}:${targetId}:${emoji}`;
}

type Entry = {
  pending: ReactionToggle | null;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: (() => void)[];
};

export function createReactionWriteQueue(options: {
  /** Performs one write; rejecting means the cloud refused it. */
  readonly write: (toggle: ReactionToggle) => Promise<void>;
  /** Called with the refused toggle so the caller can put the row back. */
  readonly onFailure?: (toggle: ReactionToggle) => void;
  readonly debounceMs?: number;
}): ReactionWriteQueue {
  const { write, onFailure } = options;
  const debounceMs = options.debounceMs ?? REACTION_WRITE_DEBOUNCE_MS;

  const entries = new Map<string, Entry>();
  const idle: (() => void)[] = [];
  // Set by `flush` and never cleared: the queue is flushed when its owner is
  // going away, so there is nothing left to batch for.
  let immediate = false;

  const clearTimer = (entry: Entry) => {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  };

  const finish = (key: string, entry: Entry) => {
    clearTimer(entry);
    entries.delete(key);
    for (const done of entry.waiters.splice(0)) done();
    if (entries.size === 0) {
      for (const done of idle.splice(0)) done();
    }
  };

  const arm = (key: string, entry: Entry) => {
    clearTimer(entry);
    entry.timer = setTimeout(
      () => {
        entry.timer = null;
        run(key, entry);
      },
      immediate ? 0 : debounceMs,
    );
  };

  const run = (key: string, entry: Entry) => {
    // The settle handler below re-arms, so a timer that fires mid-write is not
    // a dropped tap — it is the one case where waiting is the whole point.
    if (entry.inFlight) return;
    const toggle = entry.pending;
    if (!toggle) {
      finish(key, entry);
      return;
    }
    entry.pending = null;
    entry.inFlight = true;
    // An async IIFE rather than a `.then` chain, so `write` is called on the
    // timer's own turn: a queue that only reached the network a microtask
    // later would be asserted through a drain in every case that looks at it,
    // and a `write` that threw synchronously would escape as an unhandled
    // rejection instead of a rollback.
    void (async () => {
      try {
        await write(toggle);
      } catch {
        onFailure?.(toggle);
      }
      entry.inFlight = false;
      if (entry.pending) arm(key, entry);
      else finish(key, entry);
    })();
  };

  return {
    submit(key, toggle) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { pending: null, inFlight: false, timer: null, waiters: [] };
        entries.set(key, entry);
      }
      const held = entry;
      // The collapse: a pending write in the other direction and this one end
      // where the server already is, so neither is sent. Same direction twice
      // is not a sequence a correct list can produce, and keeping the newer
      // row is the answer that survives it — the older one is no longer in the
      // list the rollback would be written against.
      held.pending =
        held.pending && held.pending.kind !== toggle.kind ? null : toggle;

      const waited = new Promise<void>((resolve) => held.waiters.push(resolve));
      if (held.pending === null) {
        clearTimer(held);
        // While a write is in flight the collapse has nothing left to cancel —
        // that write already carries the settled state — so the waiters ride
        // out with it rather than resolving before the cloud has answered.
        if (!held.inFlight) finish(key, held);
      } else {
        arm(key, held);
      }
      return waited;
    },

    flush() {
      immediate = true;
      for (const [key, entry] of [...entries]) {
        clearTimer(entry);
        run(key, entry);
      }
      if (entries.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idle.push(resolve));
    },

    pending: () => entries.size,
  };
}
