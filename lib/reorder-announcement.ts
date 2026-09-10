/**
 * Saying out loud what a reorder just did.
 *
 * Both screens that reorder give the same two moments the same silence: the
 * row is picked up (it dims, and on web a line appears) and the row lands.
 * Both are visual, so a screen-reader user gets a "reorder items" mode whose
 * entire feedback they cannot perceive — and after the keyboard actions landed,
 * a route into that mode they can definitely use.
 *
 * `AccessibilityInfo.announceForAccessibility` is the whole mechanism. What is
 * here instead of inline in each screen is the DECISION not to speak: the
 * position has to be trustworthy first, and `announcedPosition` is the one that
 * says so. A wrong "position 3 of 7" read aloud is worse than nothing, because
 * the listener cannot glance at the list to correct it.
 *
 * `t` is a parameter rather than a hook call so this stays a plain function —
 * it is called from inside render callbacks and event handlers, where a hook
 * would be a rules-of-hooks violation. `lib/drag-reorder.ts` holds the half
 * that a node suite can run.
 */

import { AccessibilityInfo } from "react-native";

import { announcedPosition } from "@/lib/drag-reorder";

/** The two things worth announcing, and the only keys this accepts. */
export type ReorderAnnouncement = "reorderPickedUp" | "reorderMoved";

type Translate = (
  key: ReorderAnnouncement,
  params?: Record<string, string | number>,
) => string;

/**
 * Nothing to mount here — the counterpart of the web spelling's live region.
 *
 * `AccessibilityInfo.announceForAccessibility` speaks through the platform's
 * own screen-reader channel, which is always there; the web half has to build
 * the thing it speaks through, and a node created at the moment of the first
 * announcement can be missed by a reader that has not scanned that subtree yet.
 * So `app/_layout.tsx` mounts it at startup, and on native that call has to
 * resolve to something — this.
 *
 * A no-op rather than an absent export: Metro resolves the import per platform,
 * so a name the web half has and this one does not is a native crash at
 * startup. `lint:platform-pairs` is the rule that says so.
 */
export function ensureReorderLiveRegion(): void {
  // Deliberately empty. See above.
}

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
  AccessibilityInfo.announceForAccessibility(t(key, at));
}
