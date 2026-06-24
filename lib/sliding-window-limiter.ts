/**
 * BE-29: the sliding-window rate limiter extracted from `lib/sentry.ts` and
 * `lib/analytics.ts` — both held a byte-identical `recentEvents` ring plus a
 * `rateLimitAllow` that pruned anything older than the window and denied once
 * `max` events were already inside it. A third consumer (app-level write rate
 * limiting on the sync flush, below) would have made a fourth copy, so the
 * pattern is promoted to one tested factory instead.
 *
 * Pure and framework-free: it keeps an in-memory list of recent `allow()`
 * timestamps, prunes anything older than `windowMs` on every call, and denies
 * once the window already holds `max` events. `now` is injectable so tests (and
 * the existing `Date.now()` callers) drive the clock explicitly.
 */

export interface SlidingWindowLimiter {
  /**
   * Records the event and returns `true` when the window holds fewer than `max`
   * timestamps; returns `false` (recording nothing) once it is full. Pruning of
   * expired timestamps happens first, so a window that has aged out is reusable.
   */
  allow(now?: number): boolean;
  /** How many events are currently inside the window (prunes as a side effect). */
  count(now?: number): number;
  /** Forget every recorded event (test reset, or a config change rebuilds it). */
  reset(): void;
}

export interface SlidingWindowOptions {
  /** Width of the sliding window in milliseconds. Must be > 0. */
  windowMs: number;
  /** Maximum events permitted within any `windowMs` span. `<= 0` denies all. */
  max: number;
}

export function createSlidingWindowLimiter(
  options: SlidingWindowOptions,
): SlidingWindowLimiter {
  const { windowMs, max } = options;
  let recent: number[] = [];

  const prune = (now: number): void => {
    const cutoff = now - windowMs;
    recent = recent.filter((ts) => ts > cutoff);
  };

  return {
    allow(now = Date.now()) {
      prune(now);
      if (recent.length >= max) return false;
      recent.push(now);
      return true;
    },
    count(now = Date.now()) {
      prune(now);
      return recent.length;
    },
    reset() {
      recent = [];
    },
  };
}
