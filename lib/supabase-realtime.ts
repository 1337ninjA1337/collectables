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

export function getSharedRealtimeClient(): RealtimeClient | null {
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
