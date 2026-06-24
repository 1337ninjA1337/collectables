/**
 * BE-29: the sliding-window rate limiter, extracted from the inline copies that
 * analytics (`trackEvent`) and Sentry (`captureException`) each grew, so a third
 * caller — app-level write throttling on the mutation paths — can reuse it
 * instead of re-implementing the same windowed counter a third time.
 *
 * The module is pure — no timers, no globals, no Date.now() baked in (every
 * method takes an injectable `now`) — so every branch is unit-testable in plain
 * node. A limiter holds the timestamps of the events admitted in the trailing
 * `windowMs`; `allow` prunes anything older, then admits (and records) the new
 * event only while the window holds fewer than `maxEvents`.
 */
export interface SlidingWindowLimiter {
  /**
   * Admit one event at `now` (defaults to wall-clock). Returns `true` and
   * records the timestamp when the trailing window holds fewer than `maxEvents`;
   * returns `false` without recording once the window is full.
   */
  allow(now?: number): boolean;
  /** Forget every recorded event so the next `allow` starts a fresh window. */
  reset(): void;
}

export function createSlidingWindowLimiter(
  maxEvents: number,
  windowMs: number,
): SlidingWindowLimiter {
  let recent: number[] = [];
  return {
    allow(now: number = Date.now()): boolean {
      const cutoff = now - windowMs;
      recent = recent.filter((ts) => ts > cutoff);
      if (recent.length >= maxEvents) return false;
      recent.push(now);
      return true;
    },
    reset(): void {
      recent = [];
    },
  };
}
