import { MarketplaceListing, MarketplaceMode } from "@/lib/types";

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
  };
}

export function markSoldPayload(
  soldAt: string,
  buyerUserId: string | null,
): MarketplaceMarkSoldPayload {
  return { sold_at: soldAt, buyer_user_id: buyerUserId };
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

export function fetchListingsUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings?select=*&order=created_at.desc`;
}

export function fetchListingByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/marketplace_listings?id=eq.${encodeURIComponent(id)}&select=*`;
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
