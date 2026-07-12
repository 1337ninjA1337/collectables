import { useEffect, useRef } from "react";

/**
 * Default dwell gate shared by "user actually engaged with X" analytics
 * events (`chat_opened`, `listing_view`, future `profile_view` /
 * `collection_view`). 500ms is long enough that a back/forth navigation
 * flicker or a pagination scroll-past never counts, short enough that any
 * real look at the screen does.
 */
export const DWELL_TIME_DEFAULT_MS = 500;

/**
 * Fires `fire()` after the component has stayed mounted for `ms` with the
 * same `deps` — a dwell-time gate for engagement analytics. Navigating away
 * (unmount) or switching subject (a `deps` change) before the gate elapses
 * cancels the pending fire and, on a deps change, re-arms it for the new
 * subject.
 *
 * `deps` should identify WHAT is being viewed (a chat id, a listing id) —
 * not the callbacks the payload needs. `fire` is kept in a ref so an inline
 * `() => trackEvent(...)` closure never re-arms the timer; it always sees
 * the latest render's values when it finally runs. Callers gate not-ready
 * states inside `fire` (e.g. `if (!chatId) return;`) — a no-op fire is
 * indistinguishable from not scheduling.
 */
export function useDwellTimeEffect(
  deps: readonly unknown[],
  ms: number,
  fire: () => void,
): void {
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    const timer = setTimeout(() => fireRef.current(), ms);
    return () => clearTimeout(timer);
    // The subject identity (spread below) and the gate duration are the only
    // things that should re-arm the timer — `fire` deliberately isn't a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
