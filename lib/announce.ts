/**
 * Saying something out loud to a screen reader — the platform channel, and
 * nothing else.
 *
 * This is the whole native mechanism: `AccessibilityInfo.announceForAccessibility`
 * is always available on iOS and Android, so a message goes straight to it.
 * The web spelling in `lib/announce.web.ts` has to BUILD the channel it speaks
 * through, which is why the two halves are a Metro platform pair and why this
 * one has a mount function that does nothing.
 *
 * What is deliberately NOT here is any decision about what to say or whether
 * to say it. `lib/reorder-announcement.ts` is the first caller and holds the
 * one decision it needs (a position has to be trustworthy before it is read
 * aloud); a second caller brings its own. This module is the door.
 */

import { AccessibilityInfo } from "react-native";

import { createAnnouncementQueue } from "@/lib/announce-queue";

/**
 * One channel, so two callers speaking at once are heard one after the other.
 *
 * `announceForAccessibility` interrupts whatever is being read, which is right
 * for a second position in a reorder and wrong for a second CALLER — a toast
 * landing in the same tick as a keyboard move used to cut the move off
 * mid-word. See `lib/announce-queue.ts` for why the rule is one held message
 * and one pending slot rather than a queue of everything.
 */
const channel = createAnnouncementQueue({
  speak: (message) => AccessibilityInfo.announceForAccessibility(message),
});

/**
 * Nothing to mount here — the counterpart of the web spelling's live region.
 *
 * The platform's own screen-reader channel is always there; the web half has
 * to build the thing it speaks through, and a node created at the moment of
 * the first announcement can be missed by a reader that has not scanned that
 * subtree yet. So `app/_layout.tsx` mounts it at startup, and on native that
 * call has to resolve to something — this.
 *
 * A no-op rather than an absent export: Metro resolves the import per
 * platform, so a name the web half has and this one does not is a native crash
 * at startup. `lint:platform-pairs` is the rule that says so.
 */
export function ensureLiveRegion(): void {
  // Deliberately empty. See above.
}

/** Read one sentence aloud, now — or next, if something else just was. */
export function announceMessage(message: string): void {
  channel.push(message);
}

/**
 * Forget a pending sentence and release the hold.
 *
 * The channel is module state, so a suite that announces leaves a timer armed
 * for the one that runs next. Exported from both spellings of the pair because
 * Metro resolves the import per platform and `lint:platform-pairs` is the rule
 * that says a name on one half and not the other is a crash on the other.
 */
export function __resetAnnouncementsForTests(): void {
  channel.reset();
}
