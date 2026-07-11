/**
 * Pure, node-testable derivations shared by analytics call sites, so each
 * event payload's logic lives in one tested place instead of being re-rolled
 * per screen.
 */

import type { CollectionVisibility, MarketplaceMode } from "@/lib/types";

/** True for a string that carries visible content once trimmed. */
function isNonBlank(value: string | null | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

/**
 * Canonical "does the record carry X" booleans for analytics payloads.
 * `item_added.hasPhoto` and `collection_created.hasCover` both read from
 * here so every event derives the flags the same way (blank/whitespace
 * strings never count) instead of re-rolling `x.length > 0` per screen.
 *
 * Callers pick the keys their event's registry entry allows —
 * `hasDescription` is derived for future item events but is not yet a
 * registered prop anywhere (note: the PII key guard rejects the token
 * "description", so a future event must widen that rule deliberately
 * before registering the key).
 */
export function summarisePayload(item: {
  photos?: readonly string[] | null;
  coverPhoto?: string | null;
  description?: string | null;
}): { hasPhoto: boolean; hasCover: boolean; hasDescription: boolean } {
  return {
    hasPhoto: (item.photos ?? []).some((uri) => isNonBlank(uri)),
    hasCover: isNonBlank(item.coverPhoto),
    hasDescription: isNonBlank(item.description),
  };
}

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
    hasCover: summarisePayload({ coverPhoto: collection.coverPhoto }).hasCover,
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
/**
 * The listing sheet's just-opened baseline (`openListingSheet` resets to
 * this). Shared with `isListingDraftDirty` so the "did the user actually
 * fill in fields" gate can never drift from the reset values.
 */
export const LISTING_DRAFT_DEFAULTS = {
  mode: "trade",
  currency: "USD",
} as const satisfies { mode: MarketplaceMode; currency: string };

export type ListingDraft = {
  mode: MarketplaceMode;
  price: string;
  currency: string;
  notes: string;
};

/**
 * True when the user actually filled in the listing sheet — any deviation
 * from the just-opened defaults. Gates `listing_dropped` so merely opening
 * and closing the sheet doesn't count as an abandoned listing.
 */
export function isListingDraftDirty(draft: ListingDraft): boolean {
  return (
    draft.mode !== LISTING_DRAFT_DEFAULTS.mode ||
    isNonBlank(draft.price) ||
    isNonBlank(draft.notes) ||
    draft.currency !== LISTING_DRAFT_DEFAULTS.currency
  );
}

/**
 * Canonical `listing_dropped` payload — mirrors `listing_created`'s
 * `{ mode, hasPrice }` shape so the two funnel arms slice identically.
 * `hasPrice` is "a price had been typed", not "the price parsed" — an
 * invalid price the user gave up on still counts as price intent.
 */
export function buildListingDroppedProps(draft: ListingDraft): {
  mode: MarketplaceMode;
  hasPrice: boolean;
} {
  return { mode: draft.mode, hasPrice: isNonBlank(draft.price) };
}

export function hasReplacedPhotoSet(
  prev: readonly string[],
  next: readonly string[],
): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  if (prev.length !== next.length) return true;
  const prevSet = new Set(prev);
  return next.some((uri) => !prevSet.has(uri));
}
