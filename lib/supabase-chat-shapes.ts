import { ChatMessage } from "@/lib/types";

/**
 * Pure request/response shape helpers for the `chat_messages` cloud table.
 *
 * These live in their own module (no react-native imports) so that unit tests
 * can verify URL/body shape without pulling in the supabase auth client or
 * the rest of the runtime. `lib/supabase-chat.ts` wires them up to fetch.
 */

export type ChatRow = {
  id: string;
  chat_id: string;
  from_user_id: string;
  to_user_id: string;
  text: string;
  created_at: string;
};

export type SendMessageInput = {
  chatId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  id?: string;
  createdAt?: string;
};

export type ChatInsertPayload = {
  chat_id: string;
  from_user_id: string;
  to_user_id: string;
  text: string;
  id?: string;
  created_at?: string;
};

export function chatRowToMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function messageToInsertPayload(input: SendMessageInput): ChatInsertPayload {
  const payload: ChatInsertPayload = {
    chat_id: input.chatId,
    from_user_id: input.fromUserId,
    to_user_id: input.toUserId,
    text: input.text,
  };
  if (input.id) payload.id = input.id;
  if (input.createdAt) payload.created_at = input.createdAt;
  return payload;
}

/**
 * Reconstruct the stored ChatMessage from the input that produced it. Used
 * for idempotent sends: when a retried offline flush hits a duplicate primary
 * key (HTTP 409) the row is already in the DB with exactly these fields, so
 * the send succeeded — we just rebuild the message instead of re-fetching.
 *
 * Returns null when the input carries no client id. Online sends let the
 * server mint the uuid, so a 409 is impossible there and there is no stable
 * id to reconstruct from.
 */
export function inputToSentMessage(input: SendMessageInput): ChatMessage | null {
  if (!input.id) return null;
  return {
    id: input.id,
    chatId: input.chatId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    text: input.text,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function fetchMessagesUrl(baseUrl: string, chatId: string): string {
  return `${baseUrl}/rest/v1/chat_messages?chat_id=eq.${encodeURIComponent(chatId)}&select=*&order=created_at.asc`;
}

export function sendMessageUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/chat_messages`;
}

export function friendCheckUrl(baseUrl: string, fromId: string, toId: string): string {
  return (
    `${baseUrl}/rest/v1/friend_requests?from_user_id=eq.${encodeURIComponent(fromId)}` +
    `&to_user_id=eq.${encodeURIComponent(toId)}&select=from_user_id`
  );
}

export function buildAuthHeaders(
  apiKey: string,
  token: string | null,
): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${token ?? apiKey}`,
    "Content-Type": "application/json",
  };
}

export function buildSendMessageHeaders(
  apiKey: string,
  token: string | null,
): Record<string, string> {
  return {
    ...buildAuthHeaders(apiKey, token),
    Prefer: "return=representation",
  };
}

export function isMutualFriendFromResponses(
  meToThem: unknown,
  themToMe: unknown,
): boolean {
  return (
    Array.isArray(meToThem) &&
    meToThem.length > 0 &&
    Array.isArray(themToMe) &&
    themToMe.length > 0
  );
}

/**
 * Cloud-side unread selector: count messages addressed to `selfId` that
 * arrived strictly after `lastReadAt`. `lastReadAt` may be empty (= never
 * read), which is treated as "everything counts".
 */
export function unreadCountForChat(
  messages: readonly ChatMessage[],
  selfId: string,
  lastReadAt: string,
): number {
  const cutoff = lastReadAt ?? "";
  return messages.filter(
    (m) => m.toUserId === selfId && m.createdAt > cutoff,
  ).length;
}

/**
 * Postgres-changes filter string for the realtime subscription. Restricts
 * incoming inserts to rows where `to_user_id = userId`, which is the only
 * shape RLS allows the current user to read anyway, but keeps the channel
 * traffic narrow.
 */
export function inboxFilter(userId: string): string {
  return `to_user_id=eq.${userId}`;
}

/**
 * Deterministic per-user channel topic so re-subscribing produces the same
 * channel name and supabase reuses it instead of opening a second one.
 */
export function inboxChannelTopic(userId: string): string {
  return `chat-inbox-${userId}`;
}

/**
 * Realtime endpoint for the supabase project. Mirrors the `wss://<host>/realtime/v1`
 * shape that `@supabase/realtime-js` expects.
 */
export function realtimeEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, "ws")}/realtime/v1`;
}

/**
 * Presence-channel topic for the typing indicator. Keyed by chatId so both
 * participants subscribe to the same channel and see each other's
 * presence sync events.
 */
export function typingChannelTopic(chatId: string): string {
  return `chat-typing-${chatId}`;
}

/**
 * Extract the list of "currently typing" user ids from a Supabase presence
 * state, excluding `selfId`. Each presence key is a user id whose latest
 * tracked metadata may include `{ typing: true }`. Used by the runtime
 * subscriber to fan out a clean list to React state.
 */
export function extractTypingUserIds(
  state: Record<string, { typing?: boolean }[]>,
  selfId: string,
): string[] {
  const out: string[] = [];
  for (const [userId, entries] of Object.entries(state)) {
    if (userId === selfId) continue;
    if (!Array.isArray(entries) || entries.length === 0) continue;
    if (entries.some((e) => e && e.typing === true)) {
      out.push(userId);
    }
  }
  return out.sort();
}

// --- chat_reads (cross-device last-read sync) ---

export type ChatReadRow = {
  user_id: string;
  chat_id: string;
  last_read_at: string;
};

export function chatReadsUrl(baseUrl: string, userId: string): string {
  return `${baseUrl}/rest/v1/chat_reads?user_id=eq.${encodeURIComponent(userId)}&select=chat_id,last_read_at`;
}

export function chatReadsUpsertUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/chat_reads`;
}

export function buildChatReadUpsertHeaders(
  apiKey: string,
  token: string | null,
): Record<string, string> {
  return {
    ...buildAuthHeaders(apiKey, token),
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
}

export function chatReadUpsertBody(
  userId: string,
  chatId: string,
  lastReadAt: string,
): Record<string, string> {
  return { user_id: userId, chat_id: chatId, last_read_at: lastReadAt };
}
