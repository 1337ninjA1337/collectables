/**
 * How long a toast stays on screen.
 *
 * One number until a toast could carry an action. An undo the user cannot
 * reach in time is worse than no undo at all — it shows them the way back and
 * then takes it away — so a toast with an action gets a longer window than one
 * that only reports.
 *
 * Both numbers, and the choice between them, live here rather than in
 * `toast-context.tsx` because that module pulls React Native and cannot be
 * imported under `tsx --test`: a timing rule nothing can assert is a timing
 * rule that drifts.
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
