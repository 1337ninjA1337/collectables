/**
 * How two things that happen at once are said one after the other.
 *
 * The app has ONE assertive announcement channel — `lib/announce.ts` and its
 * web spelling — and it now has several callers: the keyboard reorder, the
 * reorder-blocked notice, the sort restore, and every toast. Two of them can
 * speak in the same tick, and until this existed the second simply overwrote
 * the first: on web both writes landed on one node inside one task, so a
 * reader observed a single mutation and read a single sentence; on native the
 * second `announceForAccessibility` interrupted the first mid-word.
 *
 * `lib/announce.web.ts`'s own header claimed the opposite — "the write clears
 * the region first, which is also what makes two announcements in quick
 * succession both land" — and the case beside it, "keeps the last message when
 * two announcements race", pinned the losing. One of the two was wrong about
 * what this app wants, and it was the case.
 *
 * ## The rule is one held message and one pending slot
 *
 * The first message is spoken SYNCHRONOUSLY: it is about something the user
 * just did, and a screen reader that answers a keypress a tick late is worse
 * than one that answers it now. It then holds the channel for {@link
 * ANNOUNCEMENT_HOLD_MS}, which is what makes the next sentence a separate
 * mutation rather than a correction to this one.
 *
 * A message arriving inside that window goes into a slot that holds exactly
 * one, and a third replaces the second. That single slot is the whole design:
 *
 *  - Two different callers in one tick are both heard, in order. Neither can
 *    silence the other any more.
 *  - Five keyboard moves in a second are heard as the first and the fifth —
 *    which is what an assertive region does when it interrupts itself, minus
 *    the part where the user is told a position they have already left. The
 *    three in the middle were stale before they could be read aloud, and a
 *    queue that spoke them all would put the user a second behind their own
 *    hands.
 *
 * Held rather than debounced, for the first half of that: a trailing debounce
 * would delay the announcement of a single keypress, which is the common case
 * and the one that must not wait.
 */

export type AnnouncementQueue = {
  /** Say this, now or as soon as the channel is free. */
  readonly push: (message: string) => void;
  /** The message waiting for the channel, or nothing. */
  readonly pending: () => string | null;
  /** Whether the channel is still held by something already said. */
  readonly speaking: () => boolean;
  /** Drop the pending message and the hold — an unmount, or a test. */
  readonly reset: () => void;
};

/**
 * How long one sentence keeps the channel to itself.
 *
 * Long enough that the next write is a separate mutation a screen reader
 * observes rather than a correction it collapses into the first, and short
 * enough that a second caller in the same tick is not left waiting past the
 * moment its news is about. The number is a staging delay for assistive
 * technology, not a rate limit: nothing is dropped for being too fast, only
 * superseded by something newer.
 */
export const ANNOUNCEMENT_HOLD_MS = 150;

export function createAnnouncementQueue(options: {
  /** Puts one sentence on the platform's channel. */
  readonly speak: (message: string) => void;
  readonly holdMs?: number;
}): AnnouncementQueue {
  const { speak } = options;
  const holdMs = options.holdMs ?? ANNOUNCEMENT_HOLD_MS;

  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const say = (message: string) => {
    speak(message);
    timer = setTimeout(() => {
      timer = null;
      const next = pending;
      pending = null;
      if (next !== null) say(next);
    }, holdMs);
  };

  return {
    push(message) {
      // Not an announcement. The web region would write an empty string, which
      // is a mutation to nothing, and native would read a blank sentence.
      if (!message) return;
      if (timer === null) {
        say(message);
        return;
      }
      pending = message;
    },
    pending: () => pending,
    speaking: () => timer !== null,
    reset() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
