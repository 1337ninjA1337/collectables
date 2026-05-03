import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

/**
 * Runs `refreshFn` immediately on mount then on a recurring interval,
 * pausing when the tab is hidden (web) or the app is backgrounded (native)
 * and firing one immediate refresh on resume.
 */
export function useVisibilityRefresh(refreshFn: () => void, intervalMs: number): void {
  const refreshRef = useRef(refreshFn);
  refreshRef.current = refreshFn;

  useEffect(() => {
    refreshRef.current();

    let handle: ReturnType<typeof setInterval> | null = setInterval(() => {
      refreshRef.current();
    }, intervalMs);

    function pause() {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    }

    function resume() {
      if (handle === null) {
        refreshRef.current();
        handle = setInterval(() => {
          refreshRef.current();
        }, intervalMs);
      }
    }

    if (Platform.OS === "web") {
      if (typeof document === "undefined") return () => {};
      function onVisibilityChange() {
        if (document.hidden) {
          pause();
        } else {
          resume();
        }
      }
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (handle !== null) clearInterval(handle);
      };
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        resume();
      } else {
        pause();
      }
    });

    return () => {
      sub.remove();
      if (handle !== null) clearInterval(handle);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
