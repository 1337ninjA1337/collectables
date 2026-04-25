import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  appendMessage,
  buildChatId,
  buildChatPreviews,
  canChatWith,
  chooseFriendsTabBadge,
  formatBadgeCount,
  getOtherParticipantId,
  totalUnread,
} from "@/lib/chat-helpers";
import { ChatMessage } from "@/lib/types";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m-" + Math.random().toString(36).slice(2, 8),
    chatId: "chat-a-b",
    fromUserId: "a",
    toUserId: "b",
    text: "hi",
    createdAt: "2026-04-24T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildChatId", () => {
  it("returns the same id regardless of argument order", () => {
    assert.equal(buildChatId("alice", "bob"), buildChatId("bob", "alice"));
  });

  it("prefixes with chat- and sorts the participants", () => {
    assert.equal(buildChatId("bob", "alice"), "chat-alice-bob");
  });

  it("throws when either id is empty", () => {
    assert.throws(() => buildChatId("", "bob"));
    assert.throws(() => buildChatId("alice", ""));
  });
});

describe("getOtherParticipantId", () => {
  it("returns the other id when self is in the chat", () => {
    const id = buildChatId("alice", "bob");
    assert.equal(getOtherParticipantId(id, "alice"), "bob");
    assert.equal(getOtherParticipantId(id, "bob"), "alice");
  });

  it("returns null for a chat the user is not part of", () => {
    const id = buildChatId("alice", "bob");
    assert.equal(getOtherParticipantId(id, "carol"), null);
  });

  it("returns null for non-chat ids", () => {
    assert.equal(getOtherParticipantId("not-a-chat", "alice"), null);
  });
});

describe("canChatWith", () => {
  const friends = ["bob", "carol"];

  it("allows chatting with a confirmed friend", () => {
    assert.equal(canChatWith("bob", "alice", friends), true);
  });

  it("refuses chatting with a non-friend", () => {
    assert.equal(canChatWith("dave", "alice", friends), false);
  });

  it("refuses chatting with yourself", () => {
    assert.equal(canChatWith("alice", "alice", ["alice"]), false);
  });

  it("refuses chatting when no user is signed in", () => {
    assert.equal(canChatWith("bob", null, friends), false);
    assert.equal(canChatWith("bob", undefined, friends), false);
  });
});

describe("appendMessage", () => {
  it("adds a message to the list", () => {
    const m = makeMessage({ id: "m1" });
    const result = appendMessage([], m);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "m1");
  });

  it("deduplicates messages by id", () => {
    const m = makeMessage({ id: "m1" });
    const result = appendMessage([m], m);
    assert.equal(result.length, 1);
  });

  it("keeps messages sorted by createdAt ascending", () => {
    const earlier = makeMessage({ id: "m-early", createdAt: "2026-04-24T09:00:00.000Z" });
    const later = makeMessage({ id: "m-late", createdAt: "2026-04-24T12:00:00.000Z" });
    const result = appendMessage([later], earlier);
    assert.deepEqual(
      result.map((m) => m.id),
      ["m-early", "m-late"],
    );
  });
});

describe("buildChatPreviews", () => {
  const chatAB = buildChatId("alice", "bob");
  const chatAC = buildChatId("alice", "carol");

  const messages = {
    [chatAB]: [
      makeMessage({
        id: "1",
        chatId: chatAB,
        fromUserId: "bob",
        toUserId: "alice",
        text: "hey there",
        createdAt: "2026-04-24T09:00:00.000Z",
      }),
      makeMessage({
        id: "2",
        chatId: chatAB,
        fromUserId: "alice",
        toUserId: "bob",
        text: "yo",
        createdAt: "2026-04-24T10:30:00.000Z",
      }),
    ],
    [chatAC]: [
      makeMessage({
        id: "3",
        chatId: chatAC,
        fromUserId: "carol",
        toUserId: "alice",
        text: "look at this",
        createdAt: "2026-04-24T12:00:00.000Z",
      }),
    ],
  };

  it("returns a preview per chat sorted by most recent message", () => {
    const previews = buildChatPreviews(messages, "alice");
    assert.equal(previews.length, 2);
    assert.equal(previews[0].otherUserId, "carol");
    assert.equal(previews[0].lastMessage, "look at this");
    assert.equal(previews[1].otherUserId, "bob");
    assert.equal(previews[1].lastMessage, "yo");
  });

  it("counts unread messages from the other participant after lastRead", () => {
    const previews = buildChatPreviews(messages, "alice", { [chatAB]: "2026-04-24T08:00:00.000Z" });
    const bobChat = previews.find((p) => p.otherUserId === "bob")!;
    assert.equal(bobChat.unreadCount, 1);
  });

  it("does not count your own messages as unread", () => {
    // From bob's perspective: the only unread message is the one alice sent.
    // Bob's own message "hey there" must not be counted.
    const previews = buildChatPreviews(messages, "bob", { [chatAB]: "" });
    const aliceChat = previews.find((p) => p.otherUserId === "alice")!;
    assert.equal(aliceChat.unreadCount, 1);
  });

  it("respects lastRead to clear previously-seen messages", () => {
    // After bob reads up to alice's message, nothing is unread anymore.
    const previews = buildChatPreviews(messages, "bob", {
      [chatAB]: "2026-04-24T11:00:00.000Z",
    });
    const aliceChat = previews.find((p) => p.otherUserId === "alice")!;
    assert.equal(aliceChat.unreadCount, 0);
  });

  it("skips empty conversations", () => {
    const previews = buildChatPreviews({ [chatAB]: [] }, "alice");
    assert.equal(previews.length, 0);
  });

  it("skips chats the viewer is not part of", () => {
    const foreignChatId = buildChatId("carol", "dave");
    const foreign = {
      [foreignChatId]: [
        makeMessage({
          id: "f",
          chatId: foreignChatId,
          fromUserId: "carol",
          toUserId: "dave",
          createdAt: "2026-04-24T10:00:00.000Z",
        }),
      ],
    };
    const previews = buildChatPreviews(foreign, "alice");
    assert.equal(previews.length, 0);
  });
});

describe("totalUnread", () => {
  it("sums unread counts across previews", () => {
    const preview = {
      chatId: "chat-a-b",
      otherUserId: "b",
      lastMessage: "hi",
      lastMessageAt: "2026-04-24T10:00:00.000Z",
      unreadCount: 0,
    };
    assert.equal(
      totalUnread([
        { ...preview, unreadCount: 3 },
        { ...preview, unreadCount: 1 },
        { ...preview, unreadCount: 0 },
      ]),
      4,
    );
  });

  it("returns 0 for an empty list", () => {
    assert.equal(totalUnread([]), 0);
  });
});

describe("chooseFriendsTabBadge", () => {
  it("returns a count badge when there are unread messages", () => {
    assert.deepEqual(chooseFriendsTabBadge(3, 0), { kind: "count", value: 3 });
  });

  it("prefers the count badge over the request dot when both are present", () => {
    assert.deepEqual(chooseFriendsTabBadge(2, 4), { kind: "count", value: 2 });
  });

  it("returns a dot when only friend requests are pending", () => {
    assert.deepEqual(chooseFriendsTabBadge(0, 1), { kind: "dot" });
  });

  it("returns none when nothing is pending", () => {
    assert.deepEqual(chooseFriendsTabBadge(0, 0), { kind: "none" });
  });

  it("treats negative inputs as zero", () => {
    assert.deepEqual(chooseFriendsTabBadge(-1, -1), { kind: "none" });
  });
});

describe("formatBadgeCount", () => {
  it("returns an empty string for zero or negative counts", () => {
    assert.equal(formatBadgeCount(0), "");
    assert.equal(formatBadgeCount(-3), "");
  });

  it("returns the raw number for small counts", () => {
    assert.equal(formatBadgeCount(1), "1");
    assert.equal(formatBadgeCount(99), "99");
  });

  it("caps anything above 99 at 99+", () => {
    assert.equal(formatBadgeCount(100), "99+");
    assert.equal(formatBadgeCount(2500), "99+");
  });
});
