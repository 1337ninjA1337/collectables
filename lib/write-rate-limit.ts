import type { DeliverFn } from "@/lib/sync-engine";
import {
  createSlidingWindowLimiter,
  type SlidingWindowLimiter,
} from "@/lib/sliding-window-limiter";

/**
 * BE-29: app-level write rate limiting on every cloud mutation path
 * (collections/items upserts, chat sends, social mutations). A runaway client —
 * a mis-fired effect that enqueues thousands of writes, a retry storm against an
 * intermittently-failing Supabase — would otherwise hammer the project's write
 * quota. One shared sliding window across all mutation paths bounds the burst.
 *
 * Unlike the analytics/Sentry limiters, which DROP the over-quota event (a lost
 * metric is harmless), a throttled write must be PRESERVED: the wrapper returns
 * `false` (delivery did not happen), which the sync engine reads as "leave it
 * queued" — so the entity simply re-delivers on the next flush instead of being
 * lost. The throttle defers writes; it never discards them.
 *
 * 120 writes/minute is far above any real interaction (a fast manual editor
 * commits a handful per minute) yet caps a hot loop at ~173k/day instead of
 * unbounded. Tune via the two constants below.
 */
const WRITE_RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 120;

/** Shared across every mutation path so the cap is app-wide, not per-stream. */
export const appWriteLimiter: SlidingWindowLimiter = createSlidingWindowLimiter(
  MAX_WRITES_PER_WINDOW,
  WRITE_RATE_LIMIT_WINDOW_MS,
);

/**
 * Wrap a {@link DeliverFn} so it only attempts delivery while the limiter has
 * headroom; once the window is full it short-circuits to `false` (stay queued)
 * without touching the network. Defaults to the shared {@link appWriteLimiter}
 * so all mutation paths share one budget; tests pass an isolated limiter.
 */
export function createRateLimitedDeliver<T>(
  deliver: DeliverFn<T>,
  limiter: Pick<SlidingWindowLimiter, "allow"> = appWriteLimiter,
): DeliverFn<T> {
  return async (entity, outId) => {
    if (!limiter.allow()) return false;
    return deliver(entity, outId);
  };
}

/** Test seam: clear the shared window so each case starts from full headroom. */
export function __resetWriteRateLimitForTests(): void {
  appWriteLimiter.reset();
}
