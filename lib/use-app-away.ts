import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

/**
 * Calls back when the user goes away from the app, on either platform.
 *
 * ## The failure it was written for
 *
 * A pointer-driven hold with no matching release. The toast overlay stops its
 * dismissal timer on `onHoverIn` and restarts it on `onHoverOut`, and a browser
 * does not promise the second one: alt-tab away mid-hover, switch tabs, drag
 * something and drop it over the toast, and the pointer never "leaves" any
 * element. The hold stays on with nobody there.
 *
 * `toastHoldCeilingMs` bounds that — an overlay stuck for four windows rather
 * than forever — but a ceiling is a backstop, and the tab switched away from
 * mid-hover is common enough that it would become the ordinary path. This is
 * the signal the browser DOES send in that case, and with it the ceiling goes
 * back to being the thing nobody meets.
 *
 * ## Two events on web, because they are two different absences
 *
 * `visibilitychange` fires when the tab is hidden — another tab, a minimised
 * window, a phone locked. `blur` fires when the window loses focus while still
 * visible, which is the alt-tab-to-another-app case and the one
 * `document.hidden` reports as `false`. A hook that listened for only the first
 * would miss the commonest way a desktop user leaves.
 *
 * Away only. There is deliberately no "back" callback: every caller so far
 * wants to CANCEL something a departure invalidates, and a return that
 * re-armed it would be guessing that the user is once again doing whatever
 * they were doing before — which, for a hover, they are not.
 *
 * ## Why the native branch is `AppState` and not a no-op
 *
 * Backgrounding an app is the same departure, and native surfaces hold things
 * too. `AppState` reports every state that is not `"active"`, including iOS's
 * `"inactive"` — a notification shade, an incoming call — which is the right
 * reading here: those are all "the user is not looking".
 */
export function useAppAway(onAway: () => void): void {
  // The callback is almost always an inline arrow that changes identity every
  // render; the listener must not be torn down and re-registered for that, so
  // the effect reads a ref and depends on nothing.
  const awayRef = useRef(onAway);
  awayRef.current = onAway;

  useEffect(() => {
    if (Platform.OS === "web") {
      // A web bundle evaluated outside a browser — the static export, a
      // prerender pass — has neither global. There is nothing to listen to
      // and nothing to clean up.
      const doc = typeof document === "undefined" ? null : document;
      const win = typeof window === "undefined" ? null : window;
      if (!doc && !win) return;

      const onHidden = () => {
        // Only the hiding half: `visibilitychange` also fires on the way BACK,
        // and reporting a return as a departure is worse than missing one.
        if (doc?.hidden) awayRef.current();
      };
      const onBlur = () => awayRef.current();

      doc?.addEventListener("visibilitychange", onHidden);
      win?.addEventListener?.("blur", onBlur);
      return () => {
        doc?.removeEventListener("visibilitychange", onHidden);
        win?.removeEventListener?.("blur", onBlur);
      };
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") awayRef.current();
    });
    return () => sub.remove();
  }, []);
}
