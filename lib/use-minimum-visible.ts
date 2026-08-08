import { useEffect, useRef, useState } from "react";

import {
  MIN_SPINNER_VISIBLE_MS,
  remainingHold,
  resolveHoldDelay,
} from "@/lib/minimum-visible-helpers";

export { MIN_SPINNER_VISIBLE_MS, remainingHold, resolveHoldDelay };

/**
 * Holds a transient boolean up for at least `minMs` once it goes true.
 *
 * Every screen with pull-to-refresh runs the same handler shape:
 *
 *   setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); }
 *
 * When `refresh()` resolves from cache — offline, or a warm read — that pair
 * runs inside a few milliseconds and the spinner appears and vanishes within
 * one or two frames. It reads as a rendering glitch, not as "we checked".
 * Wrapping the flag here keeps the spinner up long enough to be legible
 * without making a real network round trip any slower: the hold only ever
 * covers the tail, and a refresh that already took longer than `minMs` is
 * released the moment it finishes.
 *
 * Leading edge is deliberately IMMEDIATE. The obvious-looking alternative —
 * `useDebouncedValue(refreshing, 100)` — is the wrong primitive for a
 * `<RefreshControl>`: the control is already on screen from the user's drag,
 * so a delayed `true` lets it retract on release and then re-open 100ms later.
 * That converts one flash into two. See `minimum-visible-helpers.ts`.
 *
 * The `shownAt` timestamp lives in a ref rather than state because it is
 * bookkeeping, not output: writing it through `setState` would re-render on
 * every refresh start for a value nothing renders.
 */
export function useMinimumVisible(active: boolean, minMs: number = MIN_SPINNER_VISIBLE_MS): boolean {
  const hold = resolveHoldDelay(minMs);
  const shownAt = useRef<number | null>(null);
  const [lingering, setLingering] = useState(false);

  useEffect(() => {
    if (active) {
      // Re-arming while already up must NOT restamp: a second refresh started
      // during the first one's hold would otherwise extend the hold forever.
      if (shownAt.current == null) shownAt.current = Date.now();
      setLingering(false);
      return;
    }

    const startedAt = shownAt.current;
    shownAt.current = null;
    // Never went up (first render, or a handler that bailed before setting the
    // flag) — there is nothing to hold, and lingering here would show a
    // spinner the user never triggered.
    if (startedAt == null) return;

    const remaining = remainingHold(startedAt, Date.now(), hold);
    if (remaining <= 0) {
      setLingering(false);
      return;
    }

    setLingering(true);
    const timer = setTimeout(() => setLingering(false), remaining);
    return () => clearTimeout(timer);
  }, [active, hold]);

  return active || lingering;
}
