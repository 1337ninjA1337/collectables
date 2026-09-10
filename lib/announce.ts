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

/** Read one sentence aloud, now, interrupting whatever is being read. */
export function announceMessage(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
