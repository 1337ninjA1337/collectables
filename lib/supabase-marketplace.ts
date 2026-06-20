import {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
} from "@supabase/realtime-js";

import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import { captureException } from "@/lib/sentry";
import { subscribeShared } from "@/lib/realtime-channel-registry";
import { getSharedRealtimeClient } from "@/lib/supabase-realtime";
import {
  buildMarketplaceReadHeaders,
  buildMarketplaceWriteHeaders,
  claimListingPayload,
  claimListingUrl,
  deleteListingUrl,
  fetchListingByIdUrl,
  fetchListingsUrl,
  insertListingUrl,
  listingToInsertPayload,
  markSoldPayload,
  markSoldUrl,
  MarketplaceRow,
  rowToListing,
} from "@/lib/supabase-marketplace-shapes";
import { MarketplaceListing } from "@/lib/types";

export type FetchFn = typeof fetch;
export type TokenProvider = () => Promise<string | null>;

async function getAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

export async function cloudFetchListings(
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<MarketplaceListing[]> {
  if (!isSupabaseConfigured) return [];
  const token = await tokenProvider();
  const res = await fetcher(fetchListingsUrl(supabaseUrl!), {
    headers: buildMarketplaceReadHeaders(supabasePublishableKey!, token),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as MarketplaceRow[];
  return rows.map(rowToListing);
}

export async function cloudAddListing(
  listing: MarketplaceListing,
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<MarketplaceListing | null> {
  if (!isSupabaseConfigured) return null;
  const token = await tokenProvider();
  const res = await fetcher(insertListingUrl(supabaseUrl!), {
    method: "POST",
    headers: buildMarketplaceWriteHeaders(supabasePublishableKey!, token),
    body: JSON.stringify(listingToInsertPayload(listing)),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as MarketplaceRow[];
  if (!rows.length) return null;
  return rowToListing(rows[0]);
}

export async function cloudRemoveListing(
  id: string,
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const token = await tokenProvider();
  const res = await fetcher(deleteListingUrl(supabaseUrl!, id), {
    method: "DELETE",
    headers: buildMarketplaceReadHeaders(supabasePublishableKey!, token),
  });
  return res.ok;
}

export async function cloudFetchListingById(
  id: string,
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<MarketplaceListing | null> {
  if (!isSupabaseConfigured) return null;
  const token = await tokenProvider();
  const res = await fetcher(fetchListingByIdUrl(supabaseUrl!, id), {
    headers: buildMarketplaceReadHeaders(supabasePublishableKey!, token),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as MarketplaceRow[];
  if (!rows.length) return null;
  return rowToListing(rows[0]);
}

export async function cloudMarkSold(
  id: string,
  soldAt: string,
  buyerUserId: string | null,
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const token = await tokenProvider();
  const res = await fetcher(markSoldUrl(supabaseUrl!, id), {
    method: "PATCH",
    headers: buildMarketplaceWriteHeaders(supabasePublishableKey!, token),
    body: JSON.stringify(markSoldPayload(soldAt, buyerUserId)),
  });
  return res.ok;
}

/**
 * BE-20: atomically claim a listing as buyer via the `claim-listing` Edge
 * Function (server enforces active + buyer≠seller + single-winner). Returns
 * `true` only when the server confirms the claim — a double-claim, an
 * own-listing claim, a missing session, or an offline failure returns
 * `false` so the caller can surface a "no longer available" message. Unlike
 * `cloudMarkSold`, this requires a real user access token (the function calls
 * `auth.getUser()`); the anon apikey fallback cannot satisfy it.
 */
export async function cloudClaimListing(
  id: string,
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const token = await tokenProvider();
  if (!token) return false;
  try {
    const res = await fetcher(claimListingUrl(supabaseUrl!), {
      method: "POST",
      headers: buildMarketplaceWriteHeaders(supabasePublishableKey!, token),
      body: JSON.stringify(claimListingPayload(id)),
    });
    return res.ok;
  } catch (err) {
    captureException(err, { context: "supabase-marketplace.cloudClaimListing" });
    return false;
  }
}

const getMarketplaceRealtimeClient = getSharedRealtimeClient;

export type ListingsSubscription = { unsubscribe: () => void };

export function subscribeToListings(
  onListing: (listing: MarketplaceListing) => void,
): ListingsSubscription {
  const client = getMarketplaceRealtimeClient();
  if (!client) return { unsubscribe: () => undefined };

  return subscribeShared<MarketplaceRow>(
    client,
    "marketplace-listings-changes",
    (channel, emit) => {
      // INSERTs are filtered to fresh (un-sold) rows since that's the only
      // shape `cloudAddListing` writes — keeps the wire chatter tight.
      channel.on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT,
          schema: "public",
          table: "marketplace_listings",
          filter: "sold_at=is.null",
        },
        (payload) => {
          const row = payload.new as MarketplaceRow | undefined;
          if (!row || !row.id) return;
          emit(row);
        },
      );
      // UPDATEs include the `sold_at`/`buyer_user_id` transitions that fire
      // when another device claims a listing. No filter — we want every
      // post-creation state change so consumers can drop or replace the row.
      channel.on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE,
          schema: "public",
          table: "marketplace_listings",
        },
        (payload) => {
          const row = payload.new as MarketplaceRow | undefined;
          if (!row || !row.id) return;
          emit(row);
        },
      );
    },
    (row) => {
      try {
        onListing(rowToListing(row));
      } catch (err) {
        // Ignore handler errors so a buggy listener can't kill the socket.
        captureException(err, { context: "supabase-marketplace.subscribeToListings.handler" });
      }
    },
  );
}
