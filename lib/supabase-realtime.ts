import { RealtimeClient } from "@supabase/realtime-js";

import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import { realtimeEndpoint } from "@/lib/supabase-chat-shapes";

/**
 * A single shared `RealtimeClient` for the whole app. Before this module
 * existed, `lib/supabase-chat.ts` and `lib/supabase-marketplace.ts` each
 * constructed their own client, which doubled the WebSocket connection
 * overhead to the same endpoint. Reusing one client lets every channel
 * (inbox, marketplace listings, future cloud-backed screens) share the
 * same socket.
 */

let sharedRealtimeClient: RealtimeClient | null = null;

async function defaultGetAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

// Incident-response kill-switch: when EXPO_PUBLIC_REALTIME_DISABLED is set to
// a truthy literal ("1", "true", "yes"), getSharedRealtimeClient returns null
// regardless of whether Supabase is otherwise configured. Lets operators drop
// all WebSocket traffic without redeploying and makes offline-only QA possible.
// The literal `process.env.EXPO_PUBLIC_REALTIME_DISABLED` access is required for
// Metro/babel to inline the value into the web bundle — a dynamic env-name
// lookup would read undefined in production (same foot-gun guarded for
// resolveNumericEnv).
export function isRealtimeDisabledByEnv(rawValue: string | undefined): boolean {
  if (!rawValue) return false;
  const normalised = rawValue.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

const REALTIME_DISABLED = isRealtimeDisabledByEnv(process.env.EXPO_PUBLIC_REALTIME_DISABLED);

export function getSharedRealtimeClient(): RealtimeClient | null {
  if (REALTIME_DISABLED) return null;
  if (!isSupabaseConfigured) return null;
  if (sharedRealtimeClient) return sharedRealtimeClient;
  sharedRealtimeClient = new RealtimeClient(realtimeEndpoint(supabaseUrl!), {
    params: { apikey: supabasePublishableKey! },
    accessToken: () => defaultGetAccessToken(),
  });
  return sharedRealtimeClient;
}

/** Test-only: drop the cached client so the next call constructs a fresh one. */
export function __resetSharedRealtimeClientForTests(): void {
  sharedRealtimeClient = null;
}

/**
 * Release the shared WebSocket promptly on sign-out so a logged-out client
 * doesn't keep an authenticated socket open for the rest of the JS realm's
 * lifetime. Without this, the socket lingers until the page unloads / the
 * process exits — wasting battery on mobile and leaking the previous user's
 * authenticated channel after they leave the device.
 *
 * Mirrors `clearRuntimeSupabaseConfig`'s "reset local state on auth change"
 * stance. Best-effort: any error from `disconnect()` is swallowed so the
 * sign-out flow can never be blocked by a flaky network teardown.
 */
export async function closeSharedRealtimeClient(): Promise<void> {
  const client = sharedRealtimeClient;
  if (!client) return;
  sharedRealtimeClient = null;
  try {
    await client.disconnect();
  } catch {
    // Best-effort: a failed disconnect must not break sign-out.
  }
}
