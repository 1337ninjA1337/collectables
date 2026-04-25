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
