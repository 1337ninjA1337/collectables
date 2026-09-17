/**
 * How long a toast stays on screen.
 *
 * One number until a toast could carry an action. An undo the user cannot
 * reach in time is worse than no undo at all — it shows them the way back and
 * then takes it away — so a toast with an action gets a longer window than one
 * that only reports.
 *
 * Every number, and every decision made from them, lives here rather than in
 * `toast-context.tsx` or in the view, because both pull React Native and
 * cannot be imported under `tsx --test`: a timing rule nothing can assert is a
 * timing rule that drifts. That is why {@link nextToastDeadline} is a function
 * taking `{ held, hasAction, elapsedMs }` rather than four lines inside an
 * effect — the view keeps the effect, the rule stops being pinned by its own
 * source text.
 */

/** A toast that only reports. Long enough to read a sentence, short enough not to sit in the way. */
export const TOAST_DISPLAY_MS = 3200;

/**
 * A toast the user may want to ACT on. Roughly double, which is the span an
 * interruptible-action window is usually given — long enough to notice the
 * toast, read it, decide, and reach the button on a phone held one-handed.
 */
export const TOAST_ACTION_DISPLAY_MS = 6500;

/** The window this toast should get. */
export function toastDisplayMs(hasAction: boolean): number {
  return hasAction ? TOAST_ACTION_DISPLAY_MS : TOAST_DISPLAY_MS;
}

/**
 * How many full windows a HELD toast may stay up before it goes anyway.
 *
 * The hold exists so an undo cannot expire under the cursor reaching for it,
 * and it is driven by a pointer state: `onHoverIn` with no `onHoverOut` to
 * match it. That pairing is not guaranteed. A drag that ends over the toast, a
 * window that loses focus mid-hover, a phone reporting a stuck hover — each
 * leaves `held` true with nobody there, and the overlay sits over the top of
 * every screen for the rest of the session. Four windows is long enough that
 * nobody genuinely reading a toast meets the ceiling, and short enough that a
 * stuck hover is a nuisance rather than a permanent banner.
 */
export const TOAST_HOLD_MAX_WINDOWS = 4;

/** The longest a toast may stay held open, counted from when it appeared. */
export function toastHoldCeilingMs(hasAction: boolean): number {
  return toastDisplayMs(hasAction) * TOAST_HOLD_MAX_WINDOWS;
}

/**
 * How long from NOW until this toast should dismiss itself.
 *
 * The decision the view used to make inline, extracted so it can be tested by
 * being CALLED: the four cases that covered it matched the effect's source
 * text — a `return`, a dep array, the name of a ref — which is green on a
 * cleanup that never runs and on a ceiling off by a factor of a thousand.
 *
 * Two rules, and the interesting part is where they meet:
 *
 *  - **Not held** — the full window, every time. Deliberately not the
 *    remainder: the user has just looked away from something they were
 *    reading, and a 300ms stub would be indistinguishable from a toast that
 *    ignored them.
 *  - **Held** — whatever is left of the ceiling, and `0` once it is spent,
 *    which dismisses on the next tick rather than never.
 *
 * So a toast held to the ceiling and then released gets one more full window:
 * total life is bounded by ceiling + window rather than by the ceiling exactly.
 * That is the intended trade. The failure being fixed is UNBOUNDED life, and a
 * release is a real signal from a real pointer — the one thing a stuck hover
 * never sends.
 */
export function nextToastDeadline({
  held,
  hasAction,
  elapsedMs,
}: {
  held: boolean;
  hasAction: boolean;
  /** Milliseconds since the toast appeared. Negative input is read as zero. */
  elapsedMs: number;
}): number {
  if (!held) return toastDisplayMs(hasAction);
  return Math.max(0, toastHoldCeilingMs(hasAction) - Math.max(0, elapsedMs));
}
