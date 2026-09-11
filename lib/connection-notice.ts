/**
 * What a connection surface should be saying, given what it was saying before.
 *
 * The offline pill told the user the socket had dropped and then went quiet
 * when it came back, which is the half of the story that is not news. On
 * screen that reads as a pill vanishing, which a sighted user correctly takes
 * as "fixed"; in a live region it is text becoming empty, which is announced
 * by nothing at all. So the user who most needed telling — the one who cannot
 * see the pill — was told the connection broke and was never told it worked
 * again, and had no way to know whether the message they just sent had gone.
 *
 * ## Three states, and the middle one is the whole point
 *
 * `"offline"` while it is down, `"reconnected"` for a few seconds after it
 * comes back, and nothing the rest of the time. The reconnection is a
 * TRANSITION rather than a state, which is why it needs a decision function
 * and a timer rather than a boolean read off the socket.
 *
 * ## A session that starts online has not reconnected
 *
 * The first render is not a transition, and announcing one would greet every
 * user with news about a connection that was never broken. So the notice only
 * becomes `"reconnected"` from `"offline"`, and a mount at `online` goes
 * straight to nothing.
 */

export type ConnectionNotice = "offline" | "reconnected" | null;

/**
 * The sentence each notice renders, as a table rather than a ternary.
 *
 * Two surfaces show this — the shared pill and the chat screen's own — and a
 * ternary written twice is the shape that drifts, the way the two hand-written
 * `addTag()`s did. It is also the form `lib/i18n-key-usage.ts` can see: a key
 * in a record VALUE is a key position, and the consequent of a `?:` is not, so
 * a ternary here would have orphaned `chatOfflinePill` the moment it stopped
 * being written as a direct `t("…")` argument.
 */
export const CONNECTION_NOTICE_KEYS = {
  offline: "chatOfflinePill",
  reconnected: "chatBackOnlinePill",
} as const;

/**
 * How long "back online" stays up before the surface goes quiet again.
 *
 * Long enough for a screen reader to reach it politely — the region waits for
 * a pause, and the sentence it is holding has to still be there when the pause
 * comes — and short enough that a healthy connection is not decorated with a
 * badge about something that happened ten seconds ago.
 */
export const RECONNECTED_NOTICE_MS = 4000;

/**
 * The notice after one change of connection state.
 *
 * Pure and total: every (previous, online) pair has an answer, which is what
 * makes the transition testable without a socket or a clock. The caller owns
 * the timer that turns `"reconnected"` back into nothing — {@link
 * clearedReconnectedNotice} is the same decision for that half.
 */
export function nextConnectionNotice(
  previous: ConnectionNotice,
  online: boolean,
): ConnectionNotice {
  if (!online) return "offline";
  // Only a connection that was DOWN can come back. A mount at online, and a
  // re-render while online, are both "nothing to say".
  if (previous === "offline") return "reconnected";
  return previous === "reconnected" ? "reconnected" : null;
}

/**
 * The notice once the "back online" window has elapsed.
 *
 * A separate function because the timer can outlive the state it was started
 * for: the socket can drop again inside those four seconds, and a timer that
 * blindly wrote `null` would clear an `"offline"` the user is currently
 * experiencing. The newer fact wins.
 */
export function clearedReconnectedNotice(current: ConnectionNotice): ConnectionNotice {
  return current === "reconnected" ? null : current;
}
