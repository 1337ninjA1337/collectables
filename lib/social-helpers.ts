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
 * What removing both handshake directions with a counterpart actually was,
 * given which directions existed beforehand. `removeFriend` in
 * `lib/social-context.tsx` serves all three flows with one mutation, but the
 * funnel events must not conflate them:
 *   - `"cancelled_request"` — my pending outgoing request withdrawn before the
 *     counterpart accepted (fires `friend_request_cancelled`).
 *   - `"declined_request"`  — their incoming request dismissed (silent today).
 *   - `"unfriended"`        — a mutual friendship dissolved (silent today).
 *   - `"none"`              — nothing existed; a stale-UI no-op.
 */
export type RequestRemovalKind =
  | "cancelled_request"
  | "declined_request"
  | "unfriended"
  | "none";

export function classifyRequestRemoval(
  hadOutgoing: boolean,
  hadIncoming: boolean,
): RequestRemovalKind {
  if (hadOutgoing && hadIncoming) return "unfriended";
  if (hadOutgoing) return "cancelled_request";
  if (hadIncoming) return "declined_request";
  return "none";
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

/**
 * The seed for `username` and `publicId` when nothing better is available.
 *
 * ASCII on purpose, and deliberately NOT the translated display name: both
 * fields are slugs, and the slugifier strips everything outside `[a-z0-9]`.
 * Seeding them from a translated word would leave a Russian or Belarusian user
 * with an empty slug rescued by a timestamp — a worse profile ID than the one
 * they get now. Matches the `"collector"` that `normalizeProfile` and
 * `ensureUniqueUsername` already fall back to, so the three agree on one word.
 */
export const FALLBACK_SLUG_SEED = "collector";

/** The placeholder address for a session that carries no email at all. */
export const FALLBACK_PROFILE_EMAIL = "collector@collectables.app";

/** What a session can tell us about who somebody is. */
export type FallbackIdentityInput = {
  readonly email?: string | null;
  readonly fullName?: string;
  readonly userName?: string;
};

/** The identity fields of the profile shown before a cloud row exists. */
export type FallbackIdentity = {
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
  /** Seed for the public-ID slug — ASCII, never the translated name. */
  readonly slugSeed: string;
};

/**
 * Resolve the four identity fields of the fallback profile, given whatever the
 * session carries and the localised default display name.
 *
 * Extracted from `buildFallbackProfile` in `lib/social-context.tsx` so the
 * fallback CHAIN can be tested by calling it. That file pulls React Native
 * peers, which `tsx --test` cannot transform, so everything about this logic
 * used to be asserted by matching the source text — which passes on a refactor
 * that keeps the text and breaks the behaviour.
 *
 * The one thing to understand before changing it: the display name and the two
 * slug seeds fall back to DIFFERENT things on purpose. `displayName` is prose
 * a person reads, so its last resort is translated. `username` and `slugSeed`
 * become slugs, so theirs is {@link FALLBACK_SLUG_SEED} — passing the
 * translated name here is the mistake this split exists to prevent.
 *
 * Deliberately does not slugify `slugSeed` itself: the slugifier's own
 * last-resort branch stamps a timestamp for uniqueness, which would make this
 * function non-deterministic and untestable for exactly the inputs (a
 * non-ASCII email local part) that reach it.
 */
export function resolveFallbackIdentity(
  input: FallbackIdentityInput,
  defaultDisplayName: string,
): FallbackIdentity {
  // An empty local part (`"@example.com"`) is not a name, so it is treated the
  // same as no address at all rather than becoming an empty display name.
  const emailName = input.email?.split("@")[0]?.trim() || undefined;
  const slugSeed = emailName ?? FALLBACK_SLUG_SEED;
  return {
    displayName: input.fullName ?? emailName ?? defaultDisplayName,
    username:
      input.userName ?? slugSeed.toLowerCase().replace(/[^a-z0-9_]+/g, ""),
    email: input.email ?? FALLBACK_PROFILE_EMAIL,
    slugSeed,
  };
}

/**
 * The last-resort unique suffix for a name that slugifies to nothing.
 *
 * Injected rather than read from the clock so the slug functions are pure
 * given their arguments, and so the branch that produces it can be asserted at
 * all. The default is the wall clock, which is what shipped: two people whose
 * names contain no ASCII letters — a Cyrillic display name, a Cyrillic email
 * local part — would otherwise both slugify to the empty string and collide on
 * one profile ID.
 */
export type UniqueSuffix = () => string;

const wallClockSuffix: UniqueSuffix = () => String(Date.now());

/**
 * The minimum a profile has to be for the uniqueness walks to read it.
 *
 * Structural rather than `UserProfile` so a test fixture is three fields
 * instead of eight, and so the walks cannot quietly start depending on
 * something else about a profile.
 */
export type ProfileIdentity = {
  readonly id: string;
  readonly publicId?: string;
  readonly username?: string;
};

/**
 * A public profile ID: lower-case, `[a-z0-9]` separated by single hyphens.
 *
 * The separator differs from {@link slugifyUsername}'s on purpose — a public
 * ID appears in a URL and a username does not — which is why the two are not
 * one function with a parameter.
 */
export function slugifyProfileId(
  value: string,
  suffix: UniqueSuffix = wallClockSuffix,
): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `${FALLBACK_SLUG_SEED}-${suffix()}`
  );
}

/** A username: lower-case, `[a-z0-9_]` separated by single underscores. */
export function slugifyUsername(
  value: string,
  suffix: UniqueSuffix = wallClockSuffix,
): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || `${FALLBACK_SLUG_SEED}_${suffix()}`
  );
}

/**
 * Walk `-2`, `-3`, … until the slug is free among `profiles`.
 *
 * `selfId` is excluded so re-saving a profile without changing its ID is not
 * treated as a collision with itself — the case that would otherwise renumber
 * somebody's public ID every time they edited their bio.
 */
export function ensureUniquePublicId(
  publicId: string,
  profiles: readonly ProfileIdentity[],
  selfId?: string,
  suffix: UniqueSuffix = wallClockSuffix,
): string {
  const base = slugifyProfileId(publicId, suffix);
  let next = base;
  let counter = 2;
  while (profiles.some((p) => p.id !== selfId && p.publicId === next)) {
    next = `${base}-${counter}`;
    counter += 1;
  }
  return next;
}

/** {@link ensureUniquePublicId} for usernames, walking `_2`, `_3`, … */
export function ensureUniqueUsername(
  username: string,
  profiles: readonly ProfileIdentity[],
  selfId?: string,
  suffix: UniqueSuffix = wallClockSuffix,
): string {
  const base = slugifyUsername(username, suffix);
  let next = base;
  let counter = 2;
  while (profiles.some((p) => p.id !== selfId && p.username === next)) {
    next = `${base}_${counter}`;
    counter += 1;
  }
  return next;
}
