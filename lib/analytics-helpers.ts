/**
 * Pure, node-testable derivations shared by analytics call sites, so each
 * event payload's logic lives in one tested place instead of being re-rolled
 * per screen.
 */

import type { CollectionVisibility } from "@/lib/types";

/**
 * Canonical payload for `collection_*` events. `collection_created` today;
 * future events (`collection_shared`, `collection_archived`) should build
 * their props here too so they automatically carry the same shape instead of
 * hand-rolling the literal per call site (and drifting — e.g. omitting
 * `isPremium`). `isPremium` is the *user's* entitlement, not a collection
 * field, so it's a separate argument.
 */
export function buildCollectionAnalyticsProps(
  collection: {
    visibility: CollectionVisibility;
    coverPhoto?: string | null;
  },
  isPremium: boolean,
): {
  visibility: CollectionVisibility;
  isPremium: boolean;
  hasCover: boolean;
} {
  return {
    visibility: collection.visibility,
    isPremium,
    hasCover: (collection.coverPhoto ?? "").trim().length > 0,
  };
}

/**
 * True when a save REPLACED an existing photo set: both sides non-empty and
 * the membership differs (a URI was added, removed, or swapped). Drives
 * `item_photos_replaced` — gallery rotation on an already-photo'd item.
 *
 * Deliberately order-insensitive: reordering the same URIs is not a
 * replacement. The two edges this helper excludes belong to other signals —
 * none → some is the `item_photo_attached` rising edge (`isRisingEdge`), and
 * some → none is a removal, not a replacement.
 */
export function hasReplacedPhotoSet(
  prev: readonly string[],
  next: readonly string[],
): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  if (prev.length !== next.length) return true;
  const prevSet = new Set(prev);
  return next.some((uri) => !prevSet.has(uri));
}
