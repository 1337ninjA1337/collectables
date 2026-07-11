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
