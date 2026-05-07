import {
  RealtimeChannel,
  RealtimeClient,
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  REALTIME_SUBSCRIBE_STATES,
} from "@supabase/realtime-js";

import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import { realtimeEndpoint } from "@/lib/supabase-chat-shapes";
import {
  buildMarketplaceReadHeaders,
  buildMarketplaceWriteHeaders,
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

let marketplaceRealtimeClient: RealtimeClient | null = null;

function getMarketplaceRealtimeClient(): RealtimeClient | null {
  if (!isSupabaseConfigured) return null;
  if (marketplaceRealtimeClient) return marketplaceRealtimeClient;
  marketplaceRealtimeClient = new RealtimeClient(realtimeEndpoint(supabaseUrl!), {
    params: { apikey: supabasePublishableKey! },
    accessToken: () => getAccessToken(),
  });
  return marketplaceRealtimeClient;
}

export type ListingsSubscription = { unsubscribe: () => void };

export function subscribeToListings(
  onListing: (listing: MarketplaceListing) => void,
): ListingsSubscription {
  const client = getMarketplaceRealtimeClient();
  if (!client) return { unsubscribe: () => undefined };

  let channel: RealtimeChannel | null = client.channel("marketplace-listings-inserts");
  channel
    .on(
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
        try {
          onListing(rowToListing(row));
        } catch {
          // Ignore handler errors so a buggy listener can't kill the socket.
        }
      },
    )
    .subscribe((_status) => undefined);

  return {
    unsubscribe: () => {
      if (!channel) return;
      const ch = channel;
      channel = null;
      try {
        void client.removeChannel(ch);
      } catch {
        // Best-effort cleanup; the socket may already be closed.
      }
    },
  };
}
