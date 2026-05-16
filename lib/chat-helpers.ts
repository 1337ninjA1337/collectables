import { ChatMessage } from "@/lib/types";

/**
 * Generate a stable RFC-4122 v4 message id client-side.
 *
 * Best practice for chat storage: the client mints the message id and uses
 * it as an idempotency key so (a) the optimistic local row and the eventual
 * server row share the same primary key (dedupe by id on the realtime echo
 * and on re-fetch) and (b) a retried/duplicated insert is a no-op instead of
 * a duplicate message. The id MUST be a real uuid because `chat_messages.id`
 * is a Postgres `uuid` column — a non-uuid string makes every insert fail
 * with `invalid input syntax for type uuid`, which previously stranded every
 * offline-composed message in the pending queue forever.
 */
export function newMessageId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
