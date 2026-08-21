import type { TranslationKey } from "@/lib/i18n-context";
import type { ProfileRelationship } from "@/lib/types";

/**
 * Which buttons a profile offers, given the viewer's relationship to it.
 *
 * The rule was written out twice — five ternary branches in
 * `app/profile/[id].tsx` and five more in `app/people.tsx` — as sixteen and
 * ten hand-rolled `<Pressable>`s that differ only in their label and handler.
 * Two copies of a decision table with six inputs, and the only way to compare
 * them was to read both.
 *
 * They already disagreed, legitimately: a friend's detail screen offers chat,
 * unfriend and unfollow, while a friend's row in the people list offers only
 * unfriend. That is a real per-surface decision — a list row is not the place
 * for three buttons — and expressing it as `surfaces` makes it a fact with a
 * name instead of a difference nobody had noticed was deliberate.
 *
 * `app/friends.tsx` was a THIRD copy, found later, and it is why `surfaces`
 * earned its third member. It branches on the TAB the user is looking at
 * rather than on a relationship, and shows fewer buttons because the tab has
 * already said what the list is. Every one of its omissions turned out to be
 * defensible; none of them was written down. They are now entries.
 *
 * Pure and node-testable: no React, no navigation, no `t()`. Labels are KEYS
 * and handlers are INTENTS; resolving either is the screen's job. The
 * `TranslationKey` import is type-only and therefore erased — `i18n-context`
 * pulls react-native and cannot be LOADED here, but naming the union is what
 * makes a typo'd key fail in THIS file rather than at every call site.
 */

/** What a button does, named by intent rather than by the function it calls. */
export type RelationshipActionId =
  | "chat"
  | "add_friend"
  | "accept_request"
  | "reject_request"
  | "cancel_request"
  | "remove_friend"
  | "follow"
  | "unfollow";

/**
 * Where a profile is being shown.
 *
 * `detail` is `app/profile/[id].tsx`, `row` is `app/people.tsx`, and `tab` is
 * `app/friends.tsx` — a list the user reached by choosing a relationship, so
 * the buttons that would only restate that choice are dropped. The friends tab
 * offers no unfollow (you are looking at friends) and the following tab offers
 * no add-friend (you chose the people you follow), which is why `tab` is a
 * surface rather than a second name for `row`.
 */
export type ProfileSurface = "detail" | "row" | "tab";

export type RelationshipAction = {
  readonly id: RelationshipActionId;
  /**
   * `badge` is not a button — `request_sent` shows "Request sent" as static
   * text next to its cancel button. It lives in this list rather than beside
   * it because it is part of what the row says about the relationship, and
   * splitting it out is how the two copies of this table drifted in the first
   * place.
   */
  readonly kind: "primary" | "secondary" | "badge";
  readonly labelKey: TranslationKey;
  /** Surfaces that show this action. */
  readonly surfaces: readonly ProfileSurface[];
};

/**
 * The surface sets, named by what they mean rather than by their members.
 *
 * `BROWSING` is the two surfaces a user reaches without having declared
 * anything about the relationship — a profile page and a search result — so
 * they carry the full offer. `tab` joins a set only where the friends screen
 * genuinely shows that button today.
 */
const EVERYWHERE: readonly ProfileSurface[] = ["detail", "row", "tab"];
const BROWSING: readonly ProfileSurface[] = ["detail", "row"];
const DETAIL_ONLY: readonly ProfileSurface[] = ["detail"];
const DETAIL_AND_TAB: readonly ProfileSurface[] = ["detail", "tab"];

/**
 * The full table, before any surface filtering.
 *
 * `self` is deliberately empty: the own-profile branch renders editing
 * controls rather than relationship actions, and returning an empty list is
 * what lets a caller render the block unconditionally.
 */
const TABLE: Readonly<Record<ProfileRelationship, readonly RelationshipAction[]>> = {
  self: [],
  friend: [
    // Chat is offered wherever the user came to see this person specifically —
    // a profile page, or the friends tab — but not in a search result, where a
    // list row is not the place for three buttons.
    { id: "chat", kind: "primary", labelKey: "chatSend", surfaces: DETAIL_AND_TAB },
    { id: "remove_friend", kind: "secondary", labelKey: "removeFriend", surfaces: EVERYWHERE },
    // Detail only. The friends tab does not offer it because a friend listed
    // under "Friends" is not there to be unfollowed, and the people row does
    // not because unfriending is the one removal that row is for.
    { id: "unfollow", kind: "secondary", labelKey: "unfollow", surfaces: DETAIL_ONLY },
  ],
  request_sent: [
    // No `tab`: the friends screen has no outgoing-requests list, so this
    // relationship never reaches it. An entry that named `tab` here would be
    // a button nobody can see rather than a decision anybody made.
    { id: "cancel_request", kind: "badge", labelKey: "requestSent", surfaces: BROWSING },
    { id: "cancel_request", kind: "secondary", labelKey: "cancelInvitation", surfaces: BROWSING },
  ],
  request_received: [
    { id: "accept_request", kind: "primary", labelKey: "acceptRequest", surfaces: EVERYWHERE },
    { id: "reject_request", kind: "secondary", labelKey: "rejectRequest", surfaces: EVERYWHERE },
  ],
  following: [
    // Not on the tab: the following list is where you go to stop following,
    // and offering to friend everyone in it turns a tidying screen into a
    // prompt. Reachable one tap away on the profile itself.
    { id: "add_friend", kind: "primary", labelKey: "addFriend", surfaces: BROWSING },
    { id: "unfollow", kind: "secondary", labelKey: "unfollow", surfaces: EVERYWHERE },
  ],
  none: [
    // No `tab`: a stranger appears in no list on the friends screen.
    { id: "add_friend", kind: "primary", labelKey: "addFriend", surfaces: BROWSING },
    { id: "follow", kind: "secondary", labelKey: "follow", surfaces: BROWSING },
  ],
};

/**
 * The relationships a surface is ever asked about.
 *
 * `tab` sees three, because the friends screen's three lists ARE three
 * relationships — that is what makes its shorter button sets defensible rather
 * than missing. Stated here so that a fourth list, or a relationship quietly
 * dropped from one, is a change to this record instead of a surface that
 * silently renders an empty row.
 */
export const SURFACE_RELATIONSHIPS: Readonly<
  Record<ProfileSurface, readonly ProfileRelationship[]>
> = {
  detail: ["friend", "request_sent", "request_received", "following", "none"],
  row: ["friend", "request_sent", "request_received", "following", "none"],
  tab: ["friend", "request_received", "following"],
};

/** The actions one surface shows for one relationship, in render order. */
export function relationshipActions(
  relationship: ProfileRelationship,
  surface: ProfileSurface,
): readonly RelationshipAction[] {
  return TABLE[relationship].filter((action) => action.surfaces.includes(surface));
}

/**
 * Which context method an intent calls.
 *
 * Three intents map onto `removeFriend` — rejecting an incoming request,
 * cancelling an outgoing one, and unfriending — because the social graph has
 * one edge-removal operation and three things a person can mean by it. Naming
 * them separately is what lets the labels differ ("Reject" / "Cancel
 * invitation" / "Remove friend") without three call sites deciding
 * independently which function that implies; keeping the mapping here is what
 * stops a fourth surface guessing.
 */
export const ACTION_METHOD: Readonly<
  Record<RelationshipActionId, "chat" | "addFriend" | "removeFriend" | "followProfile" | "unfollowProfile">
> = {
  chat: "chat",
  add_friend: "addFriend",
  accept_request: "addFriend",
  reject_request: "removeFriend",
  cancel_request: "removeFriend",
  remove_friend: "removeFriend",
  follow: "followProfile",
  unfollow: "unfollowProfile",
};
