import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import { captureException } from "@/lib/sentry";
import {
  DataExportDocument,
  dataExportUrl,
  parseDataExport,
} from "@/lib/data-export";

/**
 * BE-26 — client wrapper for the GDPR `export-data` Edge Function.
 *
 * `cloudExportData()` POSTs to the function with the caller's real user access
 * token (the function calls `auth.getUser()`; the anon apikey fallback cannot
 * satisfy it, so an absent token short-circuits to `null`). It returns the
 * server-assembled `DataExportDocument`, or `null` when Supabase is unconfigured
 * / there is no session / the request fails — the caller surfaces that as a
 * "couldn't export, try again" rather than handing the user a malformed file.
 */

export type FetchFn = typeof fetch;
export type TokenProvider = () => Promise<string | null>;

async function getAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

function buildHeaders(apiKey: string, token: string): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function cloudExportData({
  fetcher = fetch as FetchFn,
  tokenProvider = getAccessToken,
}: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {}): Promise<DataExportDocument | null> {
  if (!isSupabaseConfigured) return null;
  const token = await tokenProvider();
  if (!token) return null;
  try {
    const res = await fetcher(dataExportUrl(supabaseUrl!), {
      method: "POST",
      headers: buildHeaders(supabasePublishableKey!, token),
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    return parseDataExport(await res.json());
  } catch (err) {
    captureException(err, { context: "supabase-data-export.cloudExportData" });
    return null;
  }
}
