/**
 * Saying out loud that a swipe changed the tab.
 *
 * The MECHANISM half. `lib/announce.ts` is a platform pair — react-native's
 * announcement API is an empty function on web, so the web half builds an ARIA
 * live region — which is why importing it here keeps this module out of reach
 * of the node suites, and why the decision about WHAT to say lives next door in
 * `lib/tab-sentence.ts` where a suite can run it. `lib/reorder-announcement.ts`
 * and `lib/drag-reorder.ts` are the same split for the same reason.
 *
 * Why the sentence belongs to the GESTURE rather than to the pager's
 * `commitTo`: on web the same component renders `<Pressable>`s carrying
 * `accessibilityState={{ selected }}`, which the platform announces on press.
 * A version wired into the commit would say the same thing twice there and
 * nowhere at all on the native route that has no buttons.
 *
 * `t` is a parameter rather than a hook call so this stays a plain function —
 * it is called from inside a `PanResponder` handler, where a hook would be a
 * rules-of-hooks violation.
 */

import { announceMessage } from "@/lib/announce";
import { tabChangeSentence, type TabTranslate } from "@/lib/tab-sentence";

export type { TabAnnouncement, TabTranslate } from "@/lib/tab-sentence";

/** Announce the tab a swipe just committed to, or stay quiet. */
export function announceTabChange(
  t: TabTranslate,
  label: string,
  index: number | undefined,
  total: number,
): void {
  const sentence = tabChangeSentence(t, label, index, total);
  if (sentence) announceMessage(sentence);
}
