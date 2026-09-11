/**
 * The connection notice as a hook, so two surfaces spell the transition once.
 *
 * `components/realtime-status-pill.tsx` reads the shared registry and
 * `app/chat/[id].tsx` reads its own chat socket — two different sources for
 * the same boolean, and the same three-state answer on top of it. The rules
 * live in `lib/connection-notice.ts`; what is here is the two timers and the
 * React state, which is the part a pure function cannot own.
 *
 * The timers point in opposite directions and that is the design. Going down
 * WAITS — a drop is not news until it has lasted, or a flapping socket writes
 * two sentences per cycle into a region that queues them. Coming back is
 * IMMEDIATE, because by then the user has already been told something is
 * wrong and is waiting to hear it is not.
 */

import { useEffect, useRef, useState } from "react";

import {
  clearedReconnectedNotice,
  nextConnectionNotice,
  OFFLINE_GRACE_MS,
  RECONNECTED_NOTICE_MS,
  type ConnectionNotice,
} from "@/lib/connection-notice";

export function useConnectionNotice(
  online: boolean,
  holdMs: number = RECONNECTED_NOTICE_MS,
  graceMs: number = OFFLINE_GRACE_MS,
): ConnectionNotice {
  // Starts quiet even on a screen that mounts disconnected: the grace effect
  // below decides, and a mount during a 200ms blip should flash nothing.
  const [notice, setNotice] = useState<ConnectionNotice>(null);

  useEffect(() => {
    // The updater form rather than `notice` in the deps: the decision reads
    // the previous notice, and depending on it would re-run this effect on
    // every transition it makes and re-arm the grace from the top.
    if (online) {
      setNotice((previous) => nextConnectionNotice(previous, true));
      return;
    }
    const timer = setTimeout(() => {
      setNotice((previous) => nextConnectionNotice(previous, false));
    }, graceMs);
    // Recovering inside the window cancels the drop before it was ever said,
    // which is also what keeps `"reconnected"` from firing for a blip: it can
    // only follow an `"offline"` that was actually reached.
    return () => clearTimeout(timer);
  }, [online, graceMs]);

  /**
   * The reconnected window's own timer, cleared by the next state change
   * rather than by the render that started it: a socket that drops again
   * inside the window must not leave a pending clear armed against the
   * `"offline"` that replaced the notice it was started for.
   * `clearedReconnectedNotice` refuses that write as well — the two halves are
   * belt and braces because the failure is silent.
   */
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (notice !== "reconnected") return;
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null;
      setNotice(clearedReconnectedNotice);
    }, holdMs);
    return () => {
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
      clearTimer.current = null;
    };
  }, [notice, holdMs]);

  return notice;
}
