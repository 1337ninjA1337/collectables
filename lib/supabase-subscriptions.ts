import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import { captureException } from "@/lib/sentry";
import {
  parseValidation,
  PremiumValidation,
  ValidatePremiumPayload,
  validatePremiumPayload,
  validatePremiumUrl,
} from "@/lib/subscriptions";

/**
 * BE-22b — client wrapper for the `validate-premium` Edge Function.
 *
 * `cloudValidatePremium()` POSTs to the function with the caller's real user
 * access token (the function calls `auth.getUser()`; the anon apikey fallback
 * cannot satisfy it, so an absent token short-circuits to `null`). It returns
 * the server-validated entitlement `{ isPremium, activatedAt, expiresAt }`, or
 * `null` when Supabase is unconfigured / there is no session / the request
 * fails — so the caller (BE-22c) keeps its cached entitlement instead of
 * downgrading a paying user on a transient network blip.
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

export async function cloudValidatePremium(
  action: ValidatePremiumPayload["action"] = "validate",
  {
    fetcher = fetch as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<PremiumValidation | null> {
  if (!isSupabaseConfigured) return null;
  const token = await tokenProvider();
  if (!token) return null;
  try {
    const res = await fetcher(validatePremiumUrl(supabaseUrl!), {
      method: "POST",
      headers: buildHeaders(supabasePublishableKey!, token),
      body: JSON.stringify(validatePremiumPayload(action)),
    });
    if (!res.ok) return null;
    return parseValidation(await res.json());
  } catch (err) {
    captureException(err, { scope: "supabase-subscriptions.cloudValidatePremium" });
    return null;
  }
}
