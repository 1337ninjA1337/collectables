/**
 * Pure, node-testable social-graph derivations shared by analytics call
 * sites (and any future UI that needs the same buckets).
 */

import type { ProfileRelationship, UserProfile } from "@/lib/types";

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
 * all. Two people whose names contain no ASCII letters — a Cyrillic display
 * name, a Cyrillic email local part — would otherwise both slugify to the empty
 * string and collide on one profile ID.
 *
 * Prefer {@link stableSuffix} at every call site that has an account ID to hand.
 * {@link wallClockSuffix} remains the default only for callers that have no
 * seed at all, and it is the weaker of the two in both directions — see below.
 */
export type UniqueSuffix = () => string;

/**
 * The suffix that shipped: 13 digits of wall clock.
 *
 * Two problems, which is why nothing user-facing should reach for it. It is
 * long — `collector-1755823419233` is an identifier the app asks a person to
 * SHARE — and it is not stable: a different value on every call means a profile
 * that has nothing to slugify is handed a NEW public ID every time its slug is
 * recomputed, which for the signed-in user is every recompute of the profile
 * list (a language change, an arriving friend request). The ID on screen is
 * then not the ID anyone else can find them by.
 */
const wallClockSuffix: UniqueSuffix = () => String(Date.now());

/** Length of a seeded suffix, in base-36 characters. */
const SEEDED_SUFFIX_LENGTH = 6;

/**
 * A short, URL-safe token derived from `seed` — same seed, same token, always.
 *
 * FNV-1a over the seed, truncated to 30 bits so the base-36 rendering is always
 * exactly {@link SEEDED_SUFFIX_LENGTH} characters and always inside `[a-z0-9]`,
 * the alphabet {@link slugifyProfileId} would otherwise strip. Not
 * cryptographic and not meant to be: this is a disambiguator appended to a
 * public name, not a secret, and it is a one-way function of an account ID
 * precisely so the account ID cannot be read back out of a shared profile URL.
 *
 * ~1.07e9 tokens, so distinct accounts practically never land on the same one,
 * and {@link ensureUniquePublicId} resolves it when they do.
 */
export function slugSuffixFromSeed(seed: string): string {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 2).toString(36).padStart(SEEDED_SUFFIX_LENGTH, "0");
}

/**
 * A {@link UniqueSuffix} derived from `seed` — pass the account ID.
 *
 * This is what makes an anonymous profile's public ID survive a reload: the
 * same account slugifies to the same `collector-xxxxxx` on every device and on
 * every recompute, while two accounts with equally unslugifiable names still
 * get different IDs, which is the whole job the wall clock was doing.
 */
export function stableSuffix(seed: string): UniqueSuffix {
  return () => slugSuffixFromSeed(seed);
}

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
 * The slugs already spoken for, read once.
 *
 * Both walks used to re-scan the whole profile list on every iteration, so a
 * name shared by k people cost k full passes — quadratic at a busy prefix.
 * Reading the list once is the same answer because neither walk mutates it.
 *
 * `selfId` is excluded here rather than inside the loop so re-saving a profile
 * without changing its ID is not treated as a collision with itself — the case
 * that would otherwise renumber somebody's public ID every time they edited
 * their bio. Empty slugs are skipped: a candidate is never empty, so they could
 * not match anyway, and holding `""` would only make the set look busier.
 */
function takenSlugs(
  profiles: readonly ProfileIdentity[],
  selfId: string | undefined,
  read: (profile: ProfileIdentity) => string | undefined,
): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const profile of profiles) {
    if (profile.id === selfId) continue;
    const slug = read(profile);
    if (slug) taken.add(slug);
  }
  return taken;
}

/**
 * Walk `base`, `base<sep>2`, `base<sep>3`, … until one is free.
 *
 * Stops at the first FREE suffix rather than at the highest one handed out, so
 * a deleted `-2` is reused while `-3` is still taken. That is the shipped
 * behaviour and there is a case pinning it.
 */
function walkToFreeSlug(
  base: string,
  separator: string,
  taken: ReadonlySet<string>,
): string {
  let next = base;
  let counter = 2;
  while (taken.has(next)) {
    next = `${base}${separator}${counter}`;
    counter += 1;
  }
  return next;
}

/** Walk `-2`, `-3`, … until the public ID is free among `profiles`. */
export function ensureUniquePublicId(
  publicId: string,
  profiles: readonly ProfileIdentity[],
  selfId?: string,
  suffix: UniqueSuffix = wallClockSuffix,
): string {
  return walkToFreeSlug(
    slugifyProfileId(publicId, suffix),
    "-",
    takenSlugs(profiles, selfId, (p) => p.publicId),
  );
}

/** {@link ensureUniquePublicId} for usernames, walking `_2`, `_3`, … */
export function ensureUniqueUsername(
  username: string,
  profiles: readonly ProfileIdentity[],
  selfId?: string,
  suffix: UniqueSuffix = wallClockSuffix,
): string {
  return walkToFreeSlug(
    slugifyUsername(username, suffix),
    "_",
    takenSlugs(profiles, selfId, (p) => p.username),
  );
}

/**
 * Settle a profile's two slug fields, wherever the profile came from.
 *
 * Run on every profile the app holds — the signed-in user's, the ones read
 * back from AsyncStorage, and every row fetched from the cloud — because none
 * of those sources guarantees a usable `username` or `publicId`.
 * `coerceProfileRow` turns a NULL column into `""`, so a sparse cloud row
 * arrives with empty strings rather than with something to slugify.
 *
 * The fallback chain for `publicId` deliberately ENDS at the display name.
 * It used to end at `profile.email`, and that was reachable: a row with a NULL
 * `public_id`, `username` and `display_name` but a real address produced
 * `ada-lovelace-example-com` as a public profile ID — an identifier the app
 * invites people to share so others can find them, and which is written back
 * to the cloud row on the next save, so the address would stick. A profile
 * with nothing to name it gets the anonymous seed instead, which is what
 * `slugifyProfileId` already does with an empty string.
 *
 * `username`'s fallback is the bare seed with no suffix, which is NOT a
 * mistake carried over: several nameless profiles sharing the username
 * `collector` is the behaviour that shipped, and changing it would rename
 * profiles already stored under it. `ensureUniqueUsername` is what resolves a
 * clash when somebody actually picks a name.
 *
 * The suffix defaults to one seeded on the profile's OWN id, which is what
 * makes this function deterministic: it runs on every profile the app holds,
 * on every recompute of the profile list, and with the wall clock underneath it
 * a profile with nothing to slugify came out with a different public ID each
 * time. Same profile, same ID, every device — and a caller may still inject its
 * own suffix.
 */
export function normalizeProfile(
  profile: UserProfile,
  suffix: UniqueSuffix = stableSuffix(profile.id),
): UserProfile {
  const username =
    profile.username
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || FALLBACK_SLUG_SEED;

  return {
    ...profile,
    username,
    publicId: slugifyProfileId(
      profile.publicId || profile.username || profile.displayName || "",
      suffix,
    ),
  };
}
