/**
 * What a swipe between tabs says out loud, and when it says nothing.
 *
 * The pure half of `lib/tab-announcement.ts`, split for the same reason
 * `announcedPosition` lives in `lib/drag-reorder.ts` rather than beside
 * `announceReorder`: the announcing module imports `@/lib/announce`, which is a
 * platform pair and pulls react-native, so nothing a node suite can run may
 * live in it. The interesting cases here are the ones that produce NOTHING,
 * and a function whose only effect is a side effect can be tested only by
 * watching for the absence of one.
 *
 * ## The silence this fills
 *
 * On native the pager's header is a `<Text>` and a row of dots. There are no
 * tab BUTTONS — the gesture is the only way to change tab — so a commit
 * produces no spoken feedback at all: the label changes, the dots move, the
 * panel slides, and a screen-reader user is told none of it.
 *
 * ## Not conditional on reduced motion, though that is what raised it
 *
 * The suggestion that asked for this framed it as a reduced-motion gap — under
 * the setting the commit is instantaneous, so the only sign a swipe did
 * anything is the content changing. True, and the narrower half: a
 * screen-reader user perceives the 220ms slide exactly as well as they perceive
 * its absence, which is not at all. The sentence is owed on every swipe commit,
 * and a version that fired only under the setting would be a feature for the
 * smaller group.
 */

import { announcedPosition } from "@/lib/drag-reorder";

/** The one thing worth announcing here, and the only key this accepts. */
export type TabAnnouncement = "tabChanged";

export type TabTranslate = (
  key: TabAnnouncement,
  params?: Record<string, string | number>,
) => string;

/**
 * The sentence, or `null` when either of its two halves cannot be trusted.
 *
 * Both are required. A blank label with a good position says ", tab 2 of 3",
 * which is a position attached to no subject; a good label with a position out
 * of range says a number that is wrong, which is worse than the silence it
 * replaced — a listener cannot glance at the header to correct either.
 *
 * `announcedPosition` is reused rather than re-derived: "position N of M, or
 * nothing" is one rule, and this is its second caller. The label is trimmed
 * because it arrives from a caller's `tabs[]`, where a padded string is
 * indistinguishable from a real one until it is read aloud.
 *
 * `index` is 0-based, matching that rule and the `findIndex` the pager already
 * runs — `-1` for a key that is not in the list is exactly the untrustworthy
 * case this refuses.
 */
export function tabChangeSentence(
  t: TabTranslate,
  label: string,
  index: number | undefined,
  total: number,
): string | null {
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (trimmed === "") return null;
  const at = announcedPosition(index, total);
  if (!at) return null;
  return t("tabChanged", { label: trimmed, ...at });
}
