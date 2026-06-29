import { MarketplaceListing, MarketplaceMode } from "@/lib/types";
import { withPageLimit } from "@/lib/supabase-pagination";

/**
 * Pure request/response shape helpers for the `marketplace_listings` cloud table.
 * No react-native imports — unit tests can assert URL/body shape in isolation.
 * `lib/supabase-marketplace.ts` wires these up to fetch.
 */

export type MarketplaceRow = {
  id: string;
  item_id: string;
  owner_user_id: string;
  mode: MarketplaceMode;
  asking_price: number | null;
  currency: string;
  notes: string;
  created_at: string;
  sold_at: string | null;
  buyer_user_id?: string | null;
  arrived_at?: string | null;
};

export type MarketplaceInsertPayload = {
  id: string;
  item_id: string;
  owner_user_id: string;
  mode: MarketplaceMode;
  asking_price: number | null;
  currency: string;
  notes: string;
  created_at: string;
};

export type MarketplaceMarkSoldPayload = {
  sold_at: string;
  buyer_user_id: string | null;
};

/**
 * Backwards-compatible alias kept for the original PR's import path.
 */
export type MarkSoldPayload = MarketplaceMarkSoldPayload;

export type MarketplaceMarkReceivedPayload = {
  arrived_at: string;
};

export function rowToListing(row: MarketplaceRow): MarketplaceListing {
  return {
    id: row.id,
    itemId: row.item_id,
    ownerUserId: row.owner_user_id,
    mode: row.mode,
    askingPrice: row.asking_price,
    currency: row.currency,
    notes: row.notes,
    createdAt: row.created_at,
    soldAt: row.sold_at,
    buyerUserId: row.buyer_user_id ?? null,
    arrivedAt: row.arrived_at ?? null,
  };
}

export function markSoldPayload(
  soldAt: string,
  buyerUserId: string | null,
): MarketplaceMarkSoldPayload {
  return { sold_at: soldAt, buyer_user_id: buyerUserId };
}

/**
 * The PATCH body that stamps a buyer's receipt-confirmation timestamp onto a
 * sold listing so "mark received" round-trips through the cloud (and via the
 * realtime UPDATE path to the seller's device) instead of staying local-only.
 */
export function markReceivedPayload(arrivedAt: string): MarketplaceMarkReceivedPayload {
  return { arrived_at: arrivedAt };
}

export function listingToInsertPayload(listing: MarketplaceListing): MarketplaceInsertPayload {
  return {
    id: listing.id,
    item_id: listing.itemId,
    owner_user_id: listing.ownerUserId,
    mode: listing.mode,
    asking_price: listing.askingPrice,
    currency: listing.currency,
    notes: listing.notes,
    created_at: listing.createdAt,
  };
}

export function buildMarkSoldPayload(soldAt: string, buyerUserId: string | null): MarkSoldPayload {
  return {
    sold_at: soldAt,
    buyer_user_id: buyerUserId,
  };
}

/**
 * BE-28c — explicit projection matching every field `rowToListing` reads, plus
 * no extra columns. Replaces `select=*` for narrower payloads + schema-drift
 * safety.
 */
export const MARKETPLACE_COLUMNS =
  "id,item_id,owner_user_id,mode,asking_price,currency,notes,created_at,sold_at,buyer_user_id,arrived_at";

export function fetchListingsUrl(baseUrl: string): string {
  return withPageLimit(
    `${baseUrl}/rest/v1/marketplace_listings?select=${MARKETPLACE_COLUMNS}&order=created_at.desc`,
  );
}

export function fetchListingByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings?id=eq.${encodeURIComponent(id)}&select=${MARKETPLACE_COLUMNS}`;
}

export function insertListingUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings`;
}

export function deleteListingUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings?id=eq.${encodeURIComponent(id)}`;
}

export function markSoldUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings?id=eq.${encodeURIComponent(id)}`;
}

/**
 * The buyer-receipt PATCH endpoint. Scoped by id AND `arrived_at=is.null` so
 * the server only stamps the *first* confirmation — a retried/duplicate or a
 * racing double-tap matches zero rows and can't move the receipt timestamp
 * forward (mirrors the local `target.arrivedAt` idempotency guard in
 * marketplace-context).
 */
export function markReceivedUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings?id=eq.${encodeURIComponent(id)}&arrived_at=is.null`;
}

/** BE-20: the `claim-listing` Edge Function endpoint (atomic buyer claim). */
export function claimListingUrl(baseUrl: string): string {
  return `${baseUrl}/functions/v1/claim-listing`;
}

export type ClaimListingPayload = {
  id: string;
};

export function claimListingPayload(id: string): ClaimListingPayload {
  return { id };
}

export function buildMarketplaceReadHeaders(
  apiKey: string,
  token: string | null,
): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${token ?? apiKey}`,
    "Content-Type": "application/json",
  };
}

export function buildMarketplaceWriteHeaders(
  apiKey: string,
  token: string | null,
): Record<string, string> {
  return {
    ...buildMarketplaceReadHeaders(apiKey, token),
    Prefer: "return=representation",
  };
}
