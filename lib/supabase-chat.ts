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
import {
  buildAuthHeaders,
  buildSendMessageHeaders,
  ChatRow,
  chatRowToMessage,
  fetchMessagesUrl,
  friendCheckUrl,
  inboxChannelTopic,
  inboxFilter,
  isMutualFriendFromResponses,
  messageToInsertPayload,
  realtimeEndpoint,
  sendMessageUrl,
  SendMessageInput,
} from "@/lib/supabase-chat-shapes";
import { ChatMessage } from "@/lib/types";

/**
 * Cloud REST wrappers for the `chat_messages` table introduced in
 * `supabase/migrations/20260424_chat_messages.sql`. All functions resolve to
 * an empty/no-op result when supabase is not configured so the local-only
 * code paths in chat-context keep working unchanged.
 */

async function getAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

export async function fetchMessagesForChat(chatId: string): Promise<ChatMessage[]> {
  if (!isSupabaseConfigured) return [];

  const token = await getAccessToken();
  const res = await fetch(fetchMessagesUrl(supabaseUrl!, chatId), {
    headers: buildAuthHeaders(supabasePublishableKey!, token),
  });
  if (!res.ok) return [];

  const rows = (await res.json()) as ChatRow[];
  return rows.map(chatRowToMessage);
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<ChatMessage | null> {
  if (!isSupabaseConfigured) return null;

  const token = await getAccessToken();
  const res = await fetch(sendMessageUrl(supabaseUrl!), {
    method: "POST",
    headers: buildSendMessageHeaders(supabasePublishableKey!, token),
    body: JSON.stringify(messageToInsertPayload(input)),
  });
  if (!res.ok) return null;

  const rows = (await res.json()) as ChatRow[];
  if (!rows.length) return null;
  return chatRowToMessage(rows[0]);
}

/**
 * No-op for now: the `chat_messages` migration does not include a
 * server-side last-seen column. chat-cloud-6 will introduce one and update
 * this helper. Kept as a stable export so chat-context can call it
 * unconditionally today.
 */
export async function markRead(
  _chatId: string,
  _userId: string,
  _lastReadAt: string,
): Promise<void> {
  return;
}

let realtimeClient: RealtimeClient | null = null;

function getRealtimeClient(): RealtimeClient | null {
  if (!isSupabaseConfigured) return null;
  if (realtimeClient) return realtimeClient;
  realtimeClient = new RealtimeClient(realtimeEndpoint(supabaseUrl!), {
    params: { apikey: supabasePublishableKey! },
    accessToken: () => getAccessToken(),
  });
  return realtimeClient;
}

export type InboxSubscription = {
  unsubscribe: () => void;
};

/**
 * Subscribes to a Supabase realtime channel that streams INSERTs on
 * `chat_messages` addressed to `userId`. The callback is invoked once per
 * incoming message, already converted to the app's `ChatMessage` shape.
 *
 * Returns an `InboxSubscription` whose `unsubscribe()` removes the channel
 * and is safe to call multiple times. When supabase is not configured the
 * function is a no-op and returns a stub subscription so callers can wire
 * it up unconditionally.
 */
export function subscribeToInbox(
  userId: string,
  onMessage: (message: ChatMessage) => void,
): InboxSubscription {
  const client = getRealtimeClient();
  if (!client || !userId) {
    return { unsubscribe: () => undefined };
  }

  let channel: RealtimeChannel | null = client.channel(inboxChannelTopic(userId));
  channel
    .on(
      REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
      {
        event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT,
        schema: "public",
        table: "chat_messages",
        filter: inboxFilter(userId),
      },
      (payload) => {
        const row = payload.new as ChatRow | undefined;
        if (!row || !row.id) return;
        try {
          onMessage(chatRowToMessage(row));
        } catch {
          // Ignore handler errors so a buggy listener can't kill the socket.
        }
      },
    )
    .subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        // Leave the channel attached so realtime-js can auto-reconnect.
      }
    });

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

export async function isMutualFriend(
  userA: string,
  userB: string,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  if (!userA || !userB || userA === userB) return false;

  const token = await getAccessToken();
  const headers = buildAuthHeaders(supabasePublishableKey!, token);
  const [r1, r2] = await Promise.all([
    fetch(friendCheckUrl(supabaseUrl!, userA, userB), { headers }),
    fetch(friendCheckUrl(supabaseUrl!, userB, userA), { headers }),
  ]);
  if (!r1.ok || !r2.ok) return false;

  const [a, b] = await Promise.all([r1.json(), r2.json()]);
  return isMutualFriendFromResponses(a, b);
}
