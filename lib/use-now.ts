import { useEffect, useState } from "react";

/**
 * Returns a `Date.now()` snapshot that re-emits every `intervalMs` (default
 * 60_000 = once a minute). Pair it with `formatRelativeDate(iso)` so a "1
 * minute ago" label rolls over to "2 minutes ago" without requiring the
 * parent context to re-render.
 *
 * The hook is intentionally module-local state-free: every screen that
 * consumes it owns its own setInterval, but the timer is cheap (one tick per
 * minute) and the `useEffect` cleanup releases it on unmount so a tab with
 * 0 open chat previews carries 0 active intervals. If we ever fan-out to
 * dozens of screens at once, the next step is a singleton ticker subscribed
 * to via `useSyncExternalStore` — but until then the per-mount interval is
 * the simpler shape.
 *
 * `intervalMs` is clamped to a non-negative finite number so a caller
 * passing `Infinity`, `NaN`, or a negative value falls back to the 60s
 * default rather than crashing `setInterval` or spinning the event loop.
 */
const DEFAULT_TICK_MS = 60_000;

export function useNow(intervalMs: number = DEFAULT_TICK_MS): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const safeInterval = resolveInterval(intervalMs);
    const handle = setInterval(() => {
      setNow(Date.now());
    }, safeInterval);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}

/**
 * Pure helper exposed for testing — clamps `intervalMs` to a safe positive
 * finite number. A non-finite or non-positive override falls back to the
 * default tick so a caller can't accidentally stall the event loop or spin
 * a zero-interval timer.
 */
export function resolveInterval(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return DEFAULT_TICK_MS;
  return intervalMs;
}

export const USE_NOW_DEFAULT_TICK_MS = DEFAULT_TICK_MS;
