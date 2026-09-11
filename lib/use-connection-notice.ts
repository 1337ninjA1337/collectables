/**
 * The connection notice as a hook, so two surfaces spell the transition once.
 *
 * `components/realtime-status-pill.tsx` reads the shared registry and
 * `app/chat/[id].tsx` reads its own chat socket — two different sources for
 * the same boolean, and the same three-state answer on top of it. The rules
 * live in `lib/connection-notice.ts`; what is here is the timer and the
 * React state, which is the part a pure function cannot own.
 */

import { useEffect, useRef, useState } from "react";

import {
  clearedReconnectedNotice,
  nextConnectionNotice,
  RECONNECTED_NOTICE_MS,
  type ConnectionNotice,
} from "@/lib/connection-notice";

export function useConnectionNotice(
  online: boolean,
  holdMs: number = RECONNECTED_NOTICE_MS,
): ConnectionNotice {
  const [notice, setNotice] = useState<ConnectionNotice>(() => (online ? null : "offline"));
  /**
   * The timer is cleared by the next state change, not by the render that
   * started it: a socket that drops again inside the window must not leave a
   * pending clear armed against the `"offline"` that replaced the notice it
   * was started for. `clearedReconnectedNotice` refuses that write as well —
   * the two halves are belt and braces because the failure is silent.
   */
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The updater form rather than `notice` in the deps: the decision reads
    // the previous notice, and depending on it would re-run this effect on
    // every transition it makes and re-arm the timer from the top.
    setNotice((previous) => nextConnectionNotice(previous, online));
  }, [online]);

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
