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
  client_message_id?: string | null;
};

export type SendMessageInput = {
  chatId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  id?: string;
  createdAt?: string;
  /**
   * Client-generated uuid that survives retries — the server enforces
   * uniqueness via a partial UNIQUE index on `(from_user_id, client_message_id)`,
   * so re-posting the same logical message returns a 23505 conflict instead
   * of inserting a duplicate row.
   */
  clientMessageId?: string;
};

export type ChatInsertPayload = {
  chat_id: string;
  from_user_id: string;
  to_user_id: string;
  text: string;
  id?: string;
  created_at?: string;
  client_message_id?: string;
};

export function chatRowToMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    text: row.text,
    createdAt: row.created_at,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {}),
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
  if (input.clientMessageId) payload.client_message_id = input.clientMessageId;
  return payload;
}

/**
 * REST URL that fetches the *existing* row for an idempotent retry. When a
 * POST returns 23505 (or an empty representation because the server resolved
 * the conflict silently), the client can hit this endpoint to retrieve the
 * canonical row and merge it into local state without inserting a duplicate.
 */
export function fetchMessageByClientIdUrl(
  baseUrl: string,
  fromUserId: string,
  clientMessageId: string,
): string {
  return (
    `${baseUrl}/rest/v1/chat_messages?from_user_id=eq.${encodeURIComponent(fromUserId)}` +
    `&client_message_id=eq.${encodeURIComponent(clientMessageId)}&select=*&limit=1`
  );
}

/**
 * RFC 4122 v4 uuid generator. Uses `crypto.randomUUID` when available
 * (modern browsers, Node 14.17+, Hermes ≥0.74). Falls back to `crypto.getRandomValues`
 * for older runtimes (e.g. React Native Hermes on legacy iOS without the
 * `react-native-get-random-values` polyfill — the polyfill exposes it).
 *
 * Kept in this pure-shapes module so generation is testable without pulling
 * in the supabase client or React Native peers.
 */
export function generateClientMessageId(
  cryptoLike: { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T } | undefined =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T } | undefined)
      : undefined,
): string {
  if (cryptoLike?.randomUUID) {
    return cryptoLike.randomUUID();
  }
  if (cryptoLike?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoLike.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  // Last-resort pseudo-random uuid — non-cryptographic, but every supported
  // runtime ships crypto so this branch is documentation more than a real path.
  let id = "";
  for (let i = 0; i < 32; i++) {
    const r = Math.floor(Math.random() * 16);
    if (i === 12) id += "4";
    else if (i === 16) id += ((r & 0x3) | 0x8).toString(16);
    else id += r.toString(16);
    if (i === 7 || i === 11 || i === 15 || i === 19) id += "-";
  }
  return id;
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
