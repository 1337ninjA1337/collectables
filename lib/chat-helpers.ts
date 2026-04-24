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
