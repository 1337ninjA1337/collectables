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

/** Where a profile is being shown. */
export type ProfileSurface = "detail" | "row";

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

const BOTH: readonly ProfileSurface[] = ["detail", "row"];
const DETAIL_ONLY: readonly ProfileSurface[] = ["detail"];

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
    // Detail-only, both of them: a friend's row in the people list offers
    // unfriend alone, which is the one place the two screens genuinely differ.
    { id: "chat", kind: "primary", labelKey: "chatSend", surfaces: DETAIL_ONLY },
    { id: "remove_friend", kind: "secondary", labelKey: "removeFriend", surfaces: BOTH },
    { id: "unfollow", kind: "secondary", labelKey: "unfollow", surfaces: DETAIL_ONLY },
  ],
  request_sent: [
    { id: "cancel_request", kind: "badge", labelKey: "requestSent", surfaces: BOTH },
    { id: "cancel_request", kind: "secondary", labelKey: "cancelInvitation", surfaces: BOTH },
  ],
  request_received: [
    { id: "accept_request", kind: "primary", labelKey: "acceptRequest", surfaces: BOTH },
    { id: "reject_request", kind: "secondary", labelKey: "rejectRequest", surfaces: BOTH },
  ],
  following: [
    { id: "add_friend", kind: "primary", labelKey: "addFriend", surfaces: BOTH },
    { id: "unfollow", kind: "secondary", labelKey: "unfollow", surfaces: BOTH },
  ],
  none: [
    { id: "add_friend", kind: "primary", labelKey: "addFriend", surfaces: BOTH },
    { id: "follow", kind: "secondary", labelKey: "follow", surfaces: BOTH },
  ],
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
