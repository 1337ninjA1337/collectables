/**
 * Pure, node-testable social-graph derivations shared by analytics call
 * sites (and any future UI that needs the same buckets).
 */

import type { ProfileRelationship } from "@/lib/types";

/**
 * Canonical 3-way relationship bucket for analytics payloads. Coarser than
 * `ProfileRelationship` on purpose: telemetry wants "friend trade" vs
 * "stranger sale" slices, not the request-handshake micro-states.
 */
export type AnalyticsRelationship = "friend" | "following" | "stranger";

/**
 * Buckets a `ProfileRelationship` for analytics:
 *   - `"friend"`    — mutual follow.
 *   - `"following"` — one-directional follow by the current user.
 *   - `"stranger"`  — everything else. Pending requests (`request_sent` /
 *     `request_received`) count as strangers: the handshake hasn't completed,
 *     so the social graph contributed nothing yet. `"self"` also lands here —
 *     no tracked flow targets the user's own profile (own listings aren't
 *     claimable, self-chat doesn't exist), so a distinct bucket would only
 *     add an always-empty slice to every report.
 */
export function relationshipForAnalytics(
  rel: ProfileRelationship,
): AnalyticsRelationship {
  if (rel === "friend") return "friend";
  if (rel === "following") return "following";
  return "stranger";
}

/**
 * The boolean arm of the same bucket — `chat_opened.withFriend` and
 * `listing_claimed.sellerWasFriend` both read from here so "friend" always
 * means the mutual relationship, never a pending request or a follow.
 */
export function isFriendRelationship(rel: ProfileRelationship): boolean {
  return relationshipForAnalytics(rel) === "friend";
}

/**
 * One direction of a friend-request handshake. Structurally identical to the
 * private `FriendRequest` shape in `lib/social-context.tsx` — declared here so
 * this module stays node-pure (no react-native imports).
 */
export type FriendRequestEdge = {
  fromUserId: string;
  toUserId: string;
};

/**
 * Payload for one `friend_request_accepted` event. `direction` says which side
 * completed the handshake: `accepted_by_me` when this device added the missing
 * outgoing edge (the user tapped accept), `accepted_by_them` when our existing
 * outgoing request converted remotely (the counterpart accepted and the
 * realtime refetch delivered the mutual pair).
 */
export type AcceptedFriendship = {
  targetUserId: string;
  direction: "accepted_by_me" | "accepted_by_them";
};

type HandshakeState = { outgoing: boolean; incoming: boolean };

function collectHandshakes(
  requests: readonly FriendRequestEdge[],
  userId: string,
): Map<string, HandshakeState> {
  const byCounterpart = new Map<string, HandshakeState>();
  const stateFor = (counterpartId: string): HandshakeState => {
    let state = byCounterpart.get(counterpartId);
    if (!state) {
      state = { outgoing: false, incoming: false };
      byCounterpart.set(counterpartId, state);
    }
    return state;
  };
  for (const request of requests) {
    if (request.fromUserId === userId && request.toUserId !== userId) {
      stateFor(request.toUserId).outgoing = true;
    } else if (request.toUserId === userId && request.fromUserId !== userId) {
      stateFor(request.fromUserId).incoming = true;
    }
  }
  return byCounterpart;
}

/**
 * Diffs two `friendRequests` snapshots and returns the friendships that were
 * *accepted* in between: counterparts with exactly one handshake direction in
 * `prev` (a pending request, either way) that are mutual in `next`.
 *
 * Deriving acceptance from the request-list transition (rather than from the
 * `friends` array) makes hydration safe by construction: an already-mutual
 * friendship delivered by the initial fetch has no half state in the previous
 * snapshot, so it can never fire. Same for a sign-in baseline of `[]`.
 */
export function diffAcceptedFriendships(
  prev: readonly FriendRequestEdge[],
  next: readonly FriendRequestEdge[],
  userId: string,
): AcceptedFriendship[] {
  const before = collectHandshakes(prev, userId);
  const after = collectHandshakes(next, userId);
  const accepted: AcceptedFriendship[] = [];
  for (const [targetUserId, nextState] of after) {
    if (!nextState.outgoing || !nextState.incoming) continue;
    const prevState = before.get(targetUserId);
    // Map entries always carry at least one direction, so "present but not
    // mutual" is exactly the pending-handshake state we want.
    if (!prevState || (prevState.outgoing && prevState.incoming)) continue;
    accepted.push({
      targetUserId,
      direction: prevState.outgoing ? "accepted_by_them" : "accepted_by_me",
    });
  }
  return accepted;
}
