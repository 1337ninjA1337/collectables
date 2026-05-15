import { ChatMessage } from "@/lib/types";

/**
 * Chat id is deterministic from the two participant user ids
 * (sorted + joined with a dash). Both sides can derive the same id
 * without coordination, which lets us persist messages in per-user
 * AsyncStorage yet still address the same conversation on each device.
 */
export function buildChatId(userA: string, userB: string): string {
  if (!userA || !userB) {
    throw new Error("buildChatId requires two non-empty user ids");
  }
  const [a, b] = [userA, userB].sort();
  return `chat-${a}-${b}`;
}

export function getOtherParticipantId(chatId: string, selfId: string): string | null {
  if (!chatId.startsWith("chat-")) return null;
  const rest = chatId.slice("chat-".length);
  if (!rest.includes(selfId)) return null;
  const other = rest.replace(selfId, "").replace(/^-+|-+$/g, "");
  return other || null;
}

/**
 * Hard cap on a single chat message, mirroring the
 * `CHECK (length(text) > 0 AND length(text) <= 4000)` in the
 * chat_messages migration. A longer body is rejected by that DB CHECK on
 * every send retry, so the client must enforce the same bound up front
 * instead of queueing a message that can never flush.
 */
export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/**
 * True when `text` is a non-empty message within the DB length bound,
 * evaluated against its trimmed form (the value actually sent).
 */
export function isSendableMessageText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_CHAT_MESSAGE_LENGTH;
}

export function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((m) => m.id === message.id)) {
    return messages;
  }
  return [...messages, message].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/**
 * Only friends may chat. `isFriend` returns true if the other user id
 * is in the caller's confirmed friends list.
 */
export function canChatWith(otherUserId: string, selfId: string | null | undefined, friendIds: readonly string[]): boolean {
  if (!selfId) return false;
  if (otherUserId === selfId) return false;
  return friendIds.includes(otherUserId);
}

export type ChatPreview = {
  chatId: string;
  otherUserId: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
};

/**
 * Build a sorted list of chat previews (most recent first) from a
 * map of chatId -> messages, given the viewing user's id. Only chats
 * that involve `selfId` are included and empty conversations are
 * dropped.
 */
export function buildChatPreviews(
  messagesByChat: Record<string, ChatMessage[]>,
  selfId: string,
  lastReadByChat: Record<string, string> = {},
): ChatPreview[] {
  const previews: ChatPreview[] = [];

  for (const [chatId, msgs] of Object.entries(messagesByChat)) {
    if (!msgs || msgs.length === 0) continue;
    const other = getOtherParticipantId(chatId, selfId);
    if (!other) continue;

    const sorted = [...msgs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const last = sorted[sorted.length - 1];
    const lastRead = lastReadByChat[chatId] ?? "";
    const unreadCount = sorted.filter((m) => m.fromUserId !== selfId && m.createdAt > lastRead).length;

    previews.push({
      chatId,
      otherUserId: other,
      lastMessage: last.text,
      lastMessageAt: last.createdAt,
      unreadCount,
    });
  }

  previews.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  return previews;
}

export function totalUnread(previews: readonly ChatPreview[]): number {
  return previews.reduce((sum, p) => sum + p.unreadCount, 0);
}

/**
 * Visual state for the bottom-nav friends tab badge. Unread chat messages
 * win over friend-request indicators because they convey a count, while a
 * pending request only needs a dot.
 */
export type FriendsTabBadge =
  | { kind: "none" }
  | { kind: "dot" }
  | { kind: "count"; value: number };

export function chooseFriendsTabBadge(
  unread: number,
  incomingRequests: number,
): FriendsTabBadge {
  if (unread > 0) return { kind: "count", value: unread };
  if (incomingRequests > 0) return { kind: "dot" };
  return { kind: "none" };
}

/**
 * Compact label for a count badge. Caps anything above 99 at "99+" so the
 * pill stays narrow on small screens.
 */
export function formatBadgeCount(value: number): string {
  if (value <= 0) return "";
  if (value > 99) return "99+";
  return String(value);
}
