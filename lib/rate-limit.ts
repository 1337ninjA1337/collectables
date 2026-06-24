/**
 * BE-29: a shared sliding-window rate limiter.
 *
 * `lib/sentry.ts` and `lib/analytics.ts` each carried a byte-identical
 * `RATE_LIMIT_WINDOW_MS` / `recentEvents` / `rateLimitAllow` block, and the
 * Supabase write paths had no throttle at all (a script holding the public anon
 * key could hammer inserts/updates and exhaust the free tier — a cheap DoS
 * against our own backend and bill). This factory is the single tested
 * implementation all three reuse.
 *
 * The window is "sliding": each `allow()` prunes timestamps older than
 * `windowMs`, admits the call iff fewer than `max` remain, and records its own
 * timestamp when admitted. No timers, no React, no globals — pure and
 * node-testable; callers inject `now` in tests to drive the clock.
 *
 * NOTE: this is a *client-side first line* only. Real abuse protection must
 * also live server-side (RLS + Edge Function checks); a determined attacker can
 * always bypass an in-process limiter.
 */
export type SlidingWindowLimiter = {
  /**
   * True (and records the call) when fewer than `max` calls have been admitted
   * within the trailing `windowMs`; false (and records nothing) when the window
   * is full, so a rejected call never extends the window.
   */
  allow: (now?: number) => boolean;
  /** Forget every recorded timestamp (used by tests / sign-out resets). */
  reset: () => void;
  /** How many calls have been admitted in the trailing `windowMs` from `now`. */
  count: (now?: number) => number;
};

export function createSlidingWindowLimiter(
  max: number,
  windowMs: number,
): SlidingWindowLimiter {
  let recent: number[] = [];

  function prune(now: number): void {
    const cutoff = now - windowMs;
    recent = recent.filter((ts) => ts > cutoff);
  }

  return {
    allow(now: number = Date.now()): boolean {
      prune(now);
      if (recent.length >= max) return false;
      recent.push(now);
      return true;
    },
    reset(): void {
      recent = [];
    },
    count(now: number = Date.now()): number {
      prune(now);
      return recent.length;
    },
  };
}
