/**
 * Saying out loud what a reorder just did.
 *
 * Both screens that reorder give the same two moments the same silence: the
 * row is picked up (it dims, and on web a line appears) and the row lands.
 * Both are visual, so a screen-reader user gets a "reorder items" mode whose
 * entire feedback they cannot perceive — and after the keyboard actions landed,
 * a route into that mode they can definitely use.
 *
 * ## What is here, and what is not
 *
 * The MECHANISM is `lib/announce.ts` — a platform pair, because react-native's
 * announcement API is an empty function on web and the web half has to build
 * an ARIA live region instead. This module has no platform spelling of its own
 * and never did have a reason for one: what it holds is the DECISION not to
 * speak. The position has to be trustworthy first, and `announcedPosition` is
 * what says so. A wrong "position 3 of 7" read aloud is worse than nothing,
 * because the listener cannot glance at the list to correct it.
 *
 * `t` is a parameter rather than a hook call so this stays a plain function —
 * it is called from inside render callbacks and event handlers, where a hook
 * would be a rules-of-hooks violation. `lib/drag-reorder.ts` holds the half
 * that a node suite can run.
 */

import { announceMessage } from "@/lib/announce";
import { announcedPosition } from "@/lib/drag-reorder";

/** The two things worth announcing, and the only keys this accepts. */
export type ReorderAnnouncement = "reorderPickedUp" | "reorderMoved";

type Translate = (
  key: ReorderAnnouncement,
  params?: Record<string, string | number>,
) => string;

/**
 * Announce a row's new place, or stay quiet.
 *
 * `index` is 0-based and may be `undefined` — `getIndex()` returns that for a
 * windowed row the list has not placed yet. Every untrustworthy case ends here
 * rather than reaching the user as a number.
 */
export function announceReorder(
  t: Translate,
  key: ReorderAnnouncement,
  index: number | undefined,
  total: number,
): void {
  const at = announcedPosition(index, total);
  if (!at) return;
  announceMessage(t(key, at));
}
