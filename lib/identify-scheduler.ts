import type { AnalyticsTraits } from "@/lib/analytics";

/**
 * Pure, React-free core of the `<AnalyticsProvider>` identify edge:
 * debounced identify on sign-in / trait changes, synchronous reset on the
 * signed-in→signed-out transition. Extracted so the Strict-Mode double-mount
 * invariant ("two rapid schedules collapse into one identify") is testable
 * with node mock timers, without mounting React.
 *
 * Semantics:
 *   - `update(userId, traits)` arms (re-arms) the debounce timer, cancelling
 *     any pending identify — only the settled call within the window fires.
 *   - `update(null)` cancels any pending identify and calls `reset()`
 *     synchronously, but only if an identify previously *fired* — a cancelled
 *     identify leaves no phantom identity to reset.
 *   - `dispose()` cancels the pending timer (unmount cleanup).
 */
export type IdentifyScheduler = {
  update: (userId: string | null, traits?: AnalyticsTraits) => void;
  dispose: () => void;
};

export const DEFAULT_IDENTIFY_DEBOUNCE_MS = 500;

export function createIdentifyScheduler(options: {
  identify: (userId: string, traits?: AnalyticsTraits) => void;
  reset: () => void;
  debounceMs?: number;
}): IdentifyScheduler {
  const { identify, reset } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_IDENTIFY_DEBOUNCE_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let identifiedUserId: string | null = null;

  const cancelPending = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    update(userId, traits) {
      cancelPending();
      if (userId) {
        timer = setTimeout(() => {
          timer = null;
          identify(userId, traits);
          identifiedUserId = userId;
        }, debounceMs);
        return;
      }
      if (identifiedUserId !== null) {
        // Intentionally NOT debounced: a stale identity must not outlive
        // the session.
        reset();
        identifiedUserId = null;
      }
    },
    dispose: cancelPending,
  };
}
