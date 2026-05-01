import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import {
  buildMarketplaceReadHeaders,
  buildMarketplaceWriteHeaders,
  deleteListingUrl,
  fetchListingsUrl,
  insertListingUrl,
  listingToInsertPayload,
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

export async function cloudMarkSold(
  id: string,
  soldAt: string,
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
    body: JSON.stringify({ sold_at: soldAt }),
  });
  return res.ok;
}
