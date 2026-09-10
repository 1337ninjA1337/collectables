/**
 * The same announcement, on the platform where React Native's version is a
 * no-op.
 *
 * `AccessibilityInfo.announceForAccessibility` in react-native-web is an empty
 * function — `announceForAccessibility: function (announcement) {}`, verbatim.
 * So the reorder announcements worked on iOS and Android and did nothing at all
 * on GitHub Pages, which is the build this repository actually deploys. Metro
 * serves this spelling to the web bundle, the same way it serves
 * `components/DraggableList.web.tsx` in place of the native list.
 *
 * WHAT REPLACES IT: an ARIA live region. A `div` the page keeps, off-screen,
 * whose text a screen reader reads aloud whenever it changes. The mechanics
 * that are not obvious, and that the suite pins:
 *
 *  - The region must be in the document BEFORE its text changes, or the change
 *    is not observed and nothing is read. It is created once and written to
 *    afterwards, never created-and-filled in one go.
 *  - It must be hidden the way `clip` hides things, not with `display: none` or
 *    `visibility: hidden` — both remove the node from the accessibility tree,
 *    and a region outside that tree announces nothing.
 *  - Writing the same string twice is not a change, so the second one is
 *    silent. The write clears the region first, which is also what makes two
 *    announcements in quick succession both land.
 *
 * The decision about WHETHER to speak is not repeated here: it is
 * `announcedPosition` in `lib/drag-reorder.ts`, shared with the native spelling.
 */

import { announcedPosition } from "@/lib/drag-reorder";

export type { ReorderAnnouncement } from "@/lib/reorder-announcement";
import type { ReorderAnnouncement } from "@/lib/reorder-announcement";

type Translate = (
  key: ReorderAnnouncement,
  params?: Record<string, string | number>,
) => string;

/** One region for the app, found by id rather than held in a module variable. */
const REGION_ID = "collectables-reorder-live-region";

/**
 * Off-screen without leaving the accessibility tree.
 *
 * `display: none` and `visibility: hidden` would each hide it from a screen
 * reader too, which is the whole failure mode this file exists to avoid. The
 * clip-rect recipe keeps the node rendered, focusable and readable while
 * occupying one pixel nobody can see.
 */
const HIDDEN_STYLE: Record<string, string> = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: "0",
  border: "0",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

type Region = { textContent: string };

/**
 * The live region, creating it on first use, or nothing where there is no page.
 *
 * Returns null rather than throwing in every environment that is not a browser
 * — a prerender pass, the node suites, anything that imports this module
 * without a DOM. An announcement is not worth a crash inside an event handler.
 */
function liveRegion(): Region | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById?.(REGION_ID);
  if (existing) return existing as unknown as Region;
  if (!document.body || typeof document.createElement !== "function") return null;

  const node = document.createElement("div");
  node.id = REGION_ID;
  // Assertive rather than polite: successive keyboard moves must interrupt one
  // another, or the user hears the position they were at three presses ago.
  node.setAttribute("aria-live", "assertive");
  // The message is one sentence and is only meaningful whole — without this a
  // reader may announce only the words that changed ("4" instead of "moved to
  // position 4 of 7").
  node.setAttribute("aria-atomic", "true");
  for (const [property, value] of Object.entries(HIDDEN_STYLE)) {
    (node.style as unknown as Record<string, string>)[property] = value;
  }
  document.body.appendChild(node);
  return node as unknown as Region;
}

/**
 * Announce a row's new place, or stay quiet.
 *
 * The same signature and the same silences as the native spelling — only the
 * mechanism differs. See `lib/reorder-announcement.ts`.
 */
export function announceReorder(
  t: Translate,
  key: ReorderAnnouncement,
  index: number | undefined,
  total: number,
): void {
  const at = announcedPosition(index, total);
  if (!at) return;
  const region = liveRegion();
  if (!region) return;
  const message = t(key, at);
  // Cleared first, then written in a later task. Both halves earn their place:
  // a region created in this same task has not been observed yet, and an
  // unchanged string is not a change at all — either one is a silent
  // announcement.
  region.textContent = "";
  setTimeout(() => {
    region.textContent = message;
  }, 0);
}
