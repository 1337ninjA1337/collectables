/**
 * The same door, on the platform where React Native's version is a no-op.
 *
 * `AccessibilityInfo.announceForAccessibility` in react-native-web is an empty
 * function — `announceForAccessibility: function (announcement) {}`, verbatim.
 * So an announcement worked on iOS and Android and did nothing at all on
 * GitHub Pages, which is the build this repository actually deploys. Metro
 * serves this spelling to the web bundle, the same way it serves
 * `components/DraggableList.web.tsx` in place of the native list.
 *
 * WHAT REPLACES IT: an ARIA live region. A `div` the page keeps, off-screen,
 * whose text a screen reader reads aloud whenever it changes. The mechanics
 * that are not obvious, and that the suite pins:
 *
 *  - The region must be in the document BEFORE its text changes, or the change
 *    is not observed and nothing is read. It is created once and written to
 *    afterwards, never created-and-filled in one go — and `ensureLiveRegion`
 *    puts it there at startup, because even that staging cannot help a reader
 *    that has not yet scanned the subtree a brand-new node sits in.
 *  - It must be hidden the way `clip` hides things, not with `display: none` or
 *    `visibility: hidden` — both remove the node from the accessibility tree,
 *    and a region outside that tree announces nothing.
 *  - Writing the same string twice is not a change, so the second one is
 *    silent. The write clears the region first, which is also what makes two
 *    announcements in quick succession both land.
 *
 * ONE region for the whole app, not one per caller: two assertive regions
 * interrupt each other, and the user hears half of each.
 */

import { createAnnouncementQueue } from "@/lib/announce-queue";

/** One region for the app, found by id rather than held in a module variable. */
const REGION_ID = "collectables-live-region";

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
 * Put the region in the document now, before anything has to be announced.
 *
 * The clear-then-write below covers the common case, and it cannot cover the
 * FIRST announcement of a session: a screen reader that has not yet scanned the
 * subtree a brand-new node sits in can miss the change entirely, however the
 * write is staged. The only reliable fix is for the region to have been there
 * first, which means mounting it from somewhere that runs once at startup.
 *
 * Idempotent, because that is what makes it safe to call from an effect: the
 * lookup by id is the same one `liveRegion` does, so a second call finds the
 * node instead of appending a second one. Called by `app/_layout.tsx`, whose
 * native build gets the no-op spelling in `lib/announce.ts`.
 */
export function ensureLiveRegion(): void {
  liveRegion();
}

/**
 * One channel, so two callers speaking at once are heard one after the other.
 *
 * Both writes used to land on one node inside one task, so a reader observed a
 * single mutation and read a single sentence — the first caller was silently
 * lost. See `lib/announce-queue.ts` for why the rule is one held message and
 * one pending slot rather than a queue of everything.
 */
const channel = createAnnouncementQueue({
  speak: (message) => {
    const region = liveRegion();
    if (!region) return;
    // Cleared first, then written in a later task. Both halves earn their
    // place: a region created in this same task has not been observed yet, and
    // an unchanged string is not a change at all — either one is a silent
    // announcement.
    region.textContent = "";
    setTimeout(() => {
      region.textContent = message;
    }, 0);
  },
});

/**
 * Read one sentence aloud, now — or next, if something else just was, or not
 * at all where there is no page to read it from.
 */
export function announceMessage(message: string): void {
  channel.push(message);
}

/**
 * Forget a pending sentence and release the hold.
 *
 * The channel is module state, so a suite that announces leaves a timer armed
 * for the one that runs next — and on this half it would write into whatever
 * fake document that suite has installed since. Exported from both spellings
 * of the pair because Metro resolves the import per platform and
 * `lint:platform-pairs` is the rule that says a name on one half and not the
 * other is a crash on the other.
 */
export function __resetAnnouncementsForTests(): void {
  channel.reset();
}
