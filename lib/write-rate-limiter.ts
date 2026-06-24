import { resolveNumericEnv } from "@/lib/env";
import {
  createSlidingWindowLimiter,
  type SlidingWindowLimiter,
} from "@/lib/sliding-window-limiter";

/**
 * BE-29: one app-wide sliding-window limiter shared by every cloud mutation
 * path (collection/item upserts, queued social writes, chat sends) so a runaway
 * client — an effect loop that re-enqueues on every render, a paste of 10k rows,
 * a reconnect storm replaying a huge offline queue — cannot fire thousands of
 * writes a minute at Supabase and blow the free-tier quota.
 *
 * It is intentionally a single shared budget rather than one limiter per stream:
 * the quota we are protecting is per-project, not per-table, so collections,
 * items and chat draw from the same window. When the window is full the sync
 * flush simply stops for that pass and leaves the rest queued — the same
 * back-pressure shape an offline failure already produces — so nothing is
 * dropped; delivery just resumes on the next flush once the window ages out.
 *
 * The cap is tunable for incident response without a redeploy via
 * `EXPO_PUBLIC_WRITE_RATE_LIMIT_PER_MIN` (BE-30-style env knob). 600/min is
 * generous for real interaction yet caps a hot loop at ~864k/day instead of
 * unbounded. The env access is a *literal* member read so Metro/babel inlines
 * it into the web bundle.
 */
export const WRITE_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_WRITE_RATE_LIMIT_PER_MIN = 600;

export const writeRateLimitPerMinute = resolveNumericEnv(
  process.env.EXPO_PUBLIC_WRITE_RATE_LIMIT_PER_MIN,
  DEFAULT_WRITE_RATE_LIMIT_PER_MIN,
);

/** The process-wide write limiter every mutation flush passes to the engine. */
export const writeRateLimiter: SlidingWindowLimiter = createSlidingWindowLimiter({
  windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
  max: writeRateLimitPerMinute,
});

/** Test reset so a saturated window from one case doesn't leak into the next. */
export function __resetWriteRateLimiterForTests(): void {
  writeRateLimiter.reset();
}
