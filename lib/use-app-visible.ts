import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

/**
 * Whether the user is currently LOOKING at the app, on either platform.
 *
 * ## The failure it was written for
 *
 * A read receipt that marked itself read while nobody was there. The chat
 * screen called `markRead(chatId)` from an effect keyed on `messages.length`,
 * so a message arriving over the realtime channel — or over the 8s poll —
 * cleared the unread badge for a conversation sitting in a hidden tab or a
 * backgrounded app. `markRead` is not a local flag: it writes `lastReadByChat`
 * AND `upsertChatRead`, so the sender was told their message had been read by
 * somebody who never saw it, and the recipient lost the badge that was going
 * to tell them.
 *
 * ## A boolean, where {@link useAppAway} is a callback
 *
 * `useAppAway` reports a departure and deliberately has no "back" half: every
 * caller of it CANCELS something a departure invalidates, and re-arming on a
 * return would be guessing. This question is the other shape — the caller has
 * to know the state on a render, both ways, because what it gates is a thing
 * it owes the user as soon as they ARE looking. The chat screen's effect reads
 * it as a dependency, so coming back runs the `markRead` the departure held.
 *
 * It returns state and therefore re-renders its caller on every transition.
 * That is the cost of the shape, and the reason `useVisibilityRefresh` keeps
 * its own listeners rather than being rewritten on top of this: a poll that
 * pauses needs no render, and every screen that polls would pay for one.
 *
 * ## Two events on web, because they are two different absences
 *
 * `visibilitychange` reports a hidden tab; `blur`/`focus` report a window that
 * lost focus while still visible, which is the alt-tab-to-another-app case and
 * the one `document.hidden` reports as `false`. Both have to be false for the
 * answer to be `true`, so they are tracked separately and combined — one flag
 * written by two events would have the second one overwrite the first's answer.
 *
 * ## Unknown reads as visible
 *
 * No `document` (the static export, a prerender pass) and a native
 * `AppState.currentState` that is still `null` — Android reports that before
 * the first state is known — both answer `true`. The caller's behaviour then
 * matches what it did before the gate existed, which is the safe direction for
 * a gate: a receipt sent a moment early is the bug we had, a badge that never
 * clears at all would be a worse one.
 *
 * The web branch does NOT consult `document.hasFocus()` for the initial value
 * for the same reason: a context that reports `false` at mount — an iframe, a
 * window opened behind another — would leave the gate shut until a `focus`
 * event that may never arrive. The initial answer is the tab's visibility, and
 * focus only ever moves it from an event we saw.
 */
export function useAppVisible(): boolean {
  const [visible, setVisible] = useState(currentlyVisible);

  useEffect(() => {
    if (Platform.OS === "web") {
      // A web bundle evaluated outside a browser has neither global. There is
      // nothing to listen to, nothing to clean up, and the `true` from
      // `currentlyVisible` is the answer for the life of the mount.
      const doc = typeof document === "undefined" ? null : document;
      const win = typeof window === "undefined" ? null : window;
      if (!doc && !win) return;

      // The two absences, kept apart. `hidden` starts from the live flag
      // rather than from the render that produced the initial state, because
      // the tab can have gone away between that render and this commit.
      let hidden = doc?.hidden === true;
      let blurred = false;
      const publish = () => setVisible(!hidden && !blurred);

      const onVisibilityChange = () => {
        hidden = doc?.hidden === true;
        publish();
      };
      const onBlur = () => {
        blurred = true;
        publish();
      };
      const onFocus = () => {
        blurred = false;
        publish();
      };

      doc?.addEventListener("visibilitychange", onVisibilityChange);
      win?.addEventListener?.("blur", onBlur);
      win?.addEventListener?.("focus", onFocus);
      // Re-sync once the listeners are on, so a transition in the gap between
      // the render and this commit is not missed. A `setVisible` with the
      // value already in state re-renders nothing.
      publish();
      return () => {
        doc?.removeEventListener("visibilitychange", onVisibilityChange);
        win?.removeEventListener?.("blur", onBlur);
        win?.removeEventListener?.("focus", onFocus);
      };
    }

    const sub = AppState.addEventListener("change", (state) => {
      // Everything that is not `active` is "not looking", including iOS's
      // `inactive` — a notification shade, an incoming call — for the same
      // reason `useAppAway` reads it that way: a list of state names is a list
      // somebody has to keep.
      setVisible(state === "active");
    });
    return () => sub.remove();
  }, []);

  return visible;
}

/** The answer before any event has arrived. See "Unknown reads as visible". */
function currentlyVisible(): boolean {
  if (Platform.OS !== "web") {
    const state = AppState.currentState;
    return state ? state === "active" : true;
  }
  if (typeof document === "undefined") return true;
  return document.hidden !== true;
}
