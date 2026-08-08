/**
 * Pure half of `useMinimumVisible` — kept out of the hook file so it stays
 * node-importable under `tsx --test`, exactly like `debounce-helpers.ts`.
 *
 * The problem these solve is the mirror image of a debounce, and the
 * distinction matters enough to state plainly:
 *
 *   - a DEBOUNCE delays the leading edge — the value only becomes true after
 *     it has been true for `delayMs`;
 *   - a MINIMUM-VISIBLE hold delays the trailing edge — the value becomes true
 *     immediately and stays true for at least `minMs`.
 *
 * A pull-to-refresh spinner needs the second one. `<RefreshControl>` is
 * already visible while the user is dragging it; if `refreshing` never goes
 * true, the control retracts the instant they let go. So debouncing the
 * leading edge does not suppress the flash — it adds one, by letting the
 * control snap shut and then re-open `delayMs` later.
 */

/**
 * How long a refresh spinner must stay up once shown. 400ms is roughly one
 * full rotation of the platform indicators, which is the point: below that the
 * spinner reads as a glitch rather than as feedback.
 */
export const MIN_SPINNER_VISIBLE_MS = 400;

/**
 * Clamp a caller-supplied hold to something a `setTimeout` can honour.
 *
 * `Infinity` would pin the spinner up forever and `NaN` degrades to `0` inside
 * `setTimeout` silently, so both are folded to `0` ("no hold") rather than
 * left to surface as a hung UI. Mirrors `resolveDebounceDelay`.
 */
export function resolveHoldDelay(minMs: number): number {
  if (!Number.isFinite(minMs) || minMs <= 0) return 0;
  return minMs;
}

/**
 * Milliseconds of hold still owed, given when the flag went up.
 *
 * `now < shownAt` means the clock moved backwards (NTP correction, a device
 * time change mid-refresh). Treating that as "already elapsed" would drop the
 * hold entirely, so it yields the full hold instead — an extra 400ms of
 * spinner is a strictly better failure than the flash this exists to prevent.
 */
export function remainingHold(shownAt: number, now: number, minMs: number): number {
  const hold = resolveHoldDelay(minMs);
  if (hold === 0) return 0;
  if (now < shownAt) return hold;
  return Math.max(0, hold - (now - shownAt));
}
