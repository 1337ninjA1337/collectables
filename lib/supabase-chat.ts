import {
  RealtimeChannel,
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
import { captureException } from "@/lib/sentry";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSharedRealtimeClient } from "@/lib/supabase-realtime";
import {
  buildAuthHeaders,
  buildChatReadUpsertHeaders,
  buildSendMessageHeaders,
  chatReadUpsertBody,
  ChatReadRow,
  chatReadsUrl,
  chatReadsUpsertUrl,
  ChatRow,
  chatRowToMessage,
  extractTypingUserIds,
  fetchMessagesUrl,
  friendCheckUrl,
  inboxChannelTopic,
  inboxFilter,
  isMutualFriendFromResponses,
  messageToInsertPayload,
  sendMessageUrl,
  SendMessageInput,
  synthesizeMessageFromInput,
  typingChannelTopic,
} from "@/lib/supabase-chat-shapes";
import { ChatMessage } from "@/lib/types";

/**
 * Cloud REST wrappers for the `chat_messages` table introduced in
 * `supabase/migrations/20260424_chat_messages.sql`. All functions resolve to
 * an empty/no-op result when supabase is not configured so the local-only
 * code paths in chat-context keep working unchanged.
 */

export type TokenProvider = () => Promise<string | null>;
export type FetchFn = typeof fetch;

async function getAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

export async function fetchMessagesForChat(
  chatId: string,
  {
    fetcher = fetchWithRetry as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<ChatMessage[]> {
  if (!isSupabaseConfigured) return [];

  const token = await tokenProvider();
  const res = await fetcher(fetchMessagesUrl(supabaseUrl!, chatId), {
    headers: buildAuthHeaders(supabasePublishableKey!, token),
  });
  if (!res.ok) return [];

  const rows = (await res.json()) as ChatRow[];
  return rows.map(chatRowToMessage);
}

export async function sendMessage(
  input: SendMessageInput,
  {
    fetcher = fetchWithRetry as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<ChatMessage | null> {
  if (!isSupabaseConfigured) return null;

  const token = await tokenProvider();
  const res = await fetcher(sendMessageUrl(supabaseUrl!), {
    method: "POST",
    headers: buildSendMessageHeaders(supabasePublishableKey!, token),
    body: JSON.stringify(messageToInsertPayload(input)),
  });
  if (!res.ok) return null;

  const rows = (await res.json()) as ChatRow[];
  if (!rows.length) {
    // Idempotent insert (resolution=ignore-duplicates) returns an empty body
    // when the row already existed. The send still succeeded — the message is
    // on the server under this id — so reconstruct it from the input instead
    // of reporting failure (which would re-queue it as pending forever).
    if (input.id) return synthesizeMessageFromInput(input);
    return null;
  }
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

const getRealtimeClient = getSharedRealtimeClient;

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
  onStatusChange?: (connected: boolean) => void,
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
        } catch (err) {
          // Ignore handler errors so a buggy listener can't kill the socket.
          captureException(err, { context: "supabase-chat.subscribeToInbox.handler" });
        }
      },
    )
    .subscribe((status) => {
      const connected = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
      onStatusChange?.(connected);
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

export type TypingSubscription = {
  setTyping: (isTyping: boolean) => void;
  unsubscribe: () => void;
};

/**
 * Subscribes to a per-chat presence channel that signals which other
 * participant is currently typing. The returned `setTyping` toggles the
 * local presence payload; `onTypingUsersChange` receives the list of
 * remote user ids whose latest payload had `typing: true`.
 *
 * No-op when supabase is not configured so the chat UI keeps working
 * locally without a typing indicator.
 */
export function subscribeToTyping(
  chatId: string,
  selfId: string,
  onTypingUsersChange: (userIds: string[]) => void,
): TypingSubscription {
  const client = getRealtimeClient();
  if (!client || !chatId || !selfId) {
    return { setTyping: () => undefined, unsubscribe: () => undefined };
  }

  let channel: RealtimeChannel | null = client.channel(
    typingChannelTopic(chatId),
    { config: { presence: { key: selfId } } },
  );
  let subscribed = false;
  let pendingTyping = false;

  const handleSync = () => {
    if (!channel) return;
    const state = channel.presenceState() as Record<
      string,
      { typing?: boolean }[]
    >;
    onTypingUsersChange(extractTypingUserIds(state, selfId));
  };

  channel
    .on(REALTIME_LISTEN_TYPES.PRESENCE, { event: "sync" }, handleSync)
    .on(REALTIME_LISTEN_TYPES.PRESENCE, { event: "join" }, handleSync)
    .on(REALTIME_LISTEN_TYPES.PRESENCE, { event: "leave" }, handleSync)
    .subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        subscribed = true;
        // Track immediately so the other side sees us as a participant
        // even before we start typing. Pushes the current pending state.
        void channel?.track({ typing: pendingTyping });
      }
    });

  return {
    setTyping: (isTyping: boolean) => {
      pendingTyping = isTyping;
      if (!channel || !subscribed) return;
      void channel.track({ typing: isTyping });
    },
    unsubscribe: () => {
      if (!channel) return;
      const ch = channel;
      channel = null;
      try {
        if (subscribed) void ch.untrack();
      } catch {
        // Ignore: channel may already be torn down.
      }
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
  {
    fetcher = fetchWithRetry as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  if (!userA || !userB || userA === userB) return false;

  const token = await tokenProvider();
  const headers = buildAuthHeaders(supabasePublishableKey!, token);
  const [r1, r2] = await Promise.all([
    fetcher(friendCheckUrl(supabaseUrl!, userA, userB), { headers }),
    fetcher(friendCheckUrl(supabaseUrl!, userB, userA), { headers }),
  ]);
  if (!r1.ok || !r2.ok) return false;

  const [a, b] = await Promise.all([r1.json(), r2.json()]);
  return isMutualFriendFromResponses(a, b);
}

/**
 * Fetch the server-side last-read timestamps for all chats belonging to
 * `userId`. Returns a Record<chatId, lastReadAt> or empty when unconfigured.
 */
export async function fetchChatReads(
  userId: string,
  {
    fetcher = fetchWithRetry as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<Record<string, string>> {
  if (!isSupabaseConfigured || !userId) return {};

  const token = await tokenProvider();
  const res = await fetcher(chatReadsUrl(supabaseUrl!, userId), {
    headers: buildAuthHeaders(supabasePublishableKey!, token),
  });
  if (!res.ok) return {};

  const rows = (await res.json()) as ChatReadRow[];
  return Object.fromEntries(rows.map((r) => [r.chat_id, r.last_read_at]));
}

/**
 * Persist the last-read timestamp for a single chat to the server so other
 * devices can pick it up on next hydration. No-op when unconfigured.
 */
export async function upsertChatRead(
  userId: string,
  chatId: string,
  lastReadAt: string,
  {
    fetcher = fetchWithRetry as FetchFn,
    tokenProvider = getAccessToken,
  }: { fetcher?: FetchFn; tokenProvider?: TokenProvider } = {},
): Promise<void> {
  if (!isSupabaseConfigured || !userId || !chatId || !lastReadAt) return;

  const token = await tokenProvider();
  await fetcher(chatReadsUpsertUrl(supabaseUrl!), {
    method: "POST",
    headers: buildChatReadUpsertHeaders(supabasePublishableKey!, token),
    body: JSON.stringify(chatReadUpsertBody(userId, chatId, lastReadAt)),
  });
}
