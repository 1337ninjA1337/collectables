import { ChatMessage } from "@/lib/types";
import { byCreatedAtAscThenId, compareIsoDesc, tieBreakById } from "@/lib/sort-helpers";

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
  return [...messages, message].sort(byCreatedAtAscThenId);
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

    // The tiebreak is not cosmetic here: `last` becomes the preview's
    // `lastMessage` text, so two messages sharing a millisecond would otherwise
    // let the chat list show a different one on each device.
    const sorted = [...msgs].sort(byCreatedAtAscThenId);
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

  // `chatId` rather than `id`: a preview has no id of its own, and the chat id
  // is deterministic from the participant pair (`buildChatId`), so the same two
  // chats tie-break identically on both sides of the conversation.
  previews.sort(
    tieBreakById(
      (a: ChatPreview, b: ChatPreview) => compareIsoDesc(a.lastMessageAt, b.lastMessageAt),
      (preview) => preview.chatId,
    ),
  );
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
 * What a nav tab's accessibility label has to say beyond the tab's own name.
 *
 * A badge is drawn INSIDE the `<Pressable>` that carries the label, so a
 * screen reader announces "Chats, button" whether there are zero unread
 * messages or forty: the count is on screen and nowhere in the spoken name.
 * This is the mapping from the badge a tab draws to the thing its label has
 * to add, so the two come from ONE decision rather than from the same
 * counter read twice — the second reader is what drifts.
 *
 * Exhaustive over {@link FriendsTabBadge} on purpose: a fourth badge kind
 * has to answer "and what does this one say out loud?" before it compiles.
 */
export type NavTabLabelSpec =
  /** No badge — the tab's plain name is the whole label. */
  | { readonly kind: "plain" }
  /** A count badge: the label says how many. */
  | { readonly kind: "unread"; readonly count: number }
  /** A dot badge: the label says there is something waiting, without a number. */
  | { readonly kind: "pending" };

/** The label a tab needs, given the badge it draws. */
export function navTabLabelSpec(badge: FriendsTabBadge | undefined): NavTabLabelSpec {
  if (badge === undefined) return { kind: "plain" };
  switch (badge.kind) {
    case "none":
      return { kind: "plain" };
    case "dot":
      return { kind: "pending" };
    case "count":
      // A count of zero draws no pill (formatBadgeCount returns ""), so it
      // must not produce a label claiming unread messages either.
      return badge.value > 0 ? { kind: "unread", count: badge.value } : { kind: "plain" };
  }
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
