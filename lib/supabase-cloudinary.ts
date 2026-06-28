import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import { captureException } from "@/lib/sentry";
import {
  parseSignedUpload,
  SignedUploadParams,
  signUploadUrl,
} from "@/lib/cloudinary-signed-upload";

/**
 * SEC-5a — client wrapper for the `sign-upload` Edge Function.
 *
 * `cloudSignUpload()` POSTs to the function with the caller's real user access
 * token (the function calls `auth.getUser()`; the anon apikey fallback cannot
 * satisfy it, so an absent token short-circuits to `null`). It returns the
 * server-signed `{ cloudName, apiKey, timestamp, signature, folder }` the
 * client echoes back to Cloudinary for a signed upload, or `null` when Supabase
 * is unconfigured / there is no session / the request fails — letting the
 * caller (SEC-5b) fall back to the unsigned `upload_preset` path instead of
 * blocking image uploads.
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

export async function cloudSignUpload({
  fetcher = fetch as FetchFn,
  tokenProvider = getAccessToken,
}: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {}): Promise<SignedUploadParams | null> {
  if (!isSupabaseConfigured) return null;
  const token = await tokenProvider();
  if (!token) return null;
  try {
    const res = await fetcher(signUploadUrl(supabaseUrl!), {
      method: "POST",
      headers: buildHeaders(supabasePublishableKey!, token),
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    return parseSignedUpload(await res.json());
  } catch (err) {
    captureException(err, { context: "supabase-cloudinary.cloudSignUpload" });
    return null;
  }
}
