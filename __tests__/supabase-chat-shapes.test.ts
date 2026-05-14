import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthHeaders,
  buildSendMessageHeaders,
  chatRowToMessage,
  extractTypingUserIds,
  fetchMessageByClientIdUrl,
  fetchMessagesUrl,
  friendCheckUrl,
  generateClientMessageId,
  inboxChannelTopic,
  inboxFilter,
  isMutualFriendFromResponses,
  messageToInsertPayload,
  realtimeEndpoint,
  sendMessageUrl,
  typingChannelTopic,
  unreadCountForChat,
} from "@/lib/supabase-chat-shapes";
import { ChatMessage } from "@/lib/types";

const BASE = "https://demo.supabase.co";
const KEY = "publishable-anon-key";

describe("fetchMessagesUrl", () => {
  it("targets /rest/v1/chat_messages filtered by chat_id and ordered by created_at asc", () => {
    const url = fetchMessagesUrl(BASE, "chat-alice-bob");
    assert.equal(
      url,
      `${BASE}/rest/v1/chat_messages?chat_id=eq.chat-alice-bob&select=*&order=created_at.asc`,
    );
  });

  it("URI-encodes the chat id so a malicious id can't break out of the eq filter", () => {
    const url = fetchMessagesUrl(BASE, "chat-a&deleteall=true");
    assert.ok(url.includes("chat_id=eq.chat-a%26deleteall%3Dtrue"));
    assert.ok(!url.includes("&deleteall=true"));
  });
});

describe("sendMessageUrl", () => {
  it("targets /rest/v1/chat_messages without filters", () => {
    assert.equal(sendMessageUrl(BASE), `${BASE}/rest/v1/chat_messages`);
  });
});

describe("messageToInsertPayload", () => {
  it("snake-cases the required fields", () => {
    const body = messageToInsertPayload({
      chatId: "chat-a-b",
      fromUserId: "a",
      toUserId: "b",
      text: "hi",
    });
    assert.deepEqual(body, {
      chat_id: "chat-a-b",
      from_user_id: "a",
      to_user_id: "b",
      text: "hi",
    });
  });

  it("includes optional id and created_at only when provided", () => {
    const withMeta = messageToInsertPayload({
      chatId: "chat-a-b",
      fromUserId: "a",
      toUserId: "b",
      text: "hi",
      id: "msg-1",
      createdAt: "2026-04-25T10:00:00.000Z",
    });
    assert.equal(withMeta.id, "msg-1");
    assert.equal(withMeta.created_at, "2026-04-25T10:00:00.000Z");

    const withoutMeta = messageToInsertPayload({
      chatId: "chat-a-b",
      fromUserId: "a",
      toUserId: "b",
      text: "hi",
    });
    assert.ok(!("id" in withoutMeta));
    assert.ok(!("created_at" in withoutMeta));
  });

  it("forwards clientMessageId as snake-case client_message_id when provided", () => {
    const body = messageToInsertPayload({
      chatId: "chat-a-b",
      fromUserId: "a",
      toUserId: "b",
      text: "hi",
      clientMessageId: "11111111-2222-4333-8444-555555555555",
    });
    assert.equal(body.client_message_id, "11111111-2222-4333-8444-555555555555");
  });

  it("omits client_message_id when caller does not provide one (legacy callers)", () => {
    const body = messageToInsertPayload({
      chatId: "chat-a-b",
      fromUserId: "a",
      toUserId: "b",
      text: "hi",
    });
    assert.ok(!("client_message_id" in body));
  });
});

describe("fetchMessageByClientIdUrl", () => {
  it("queries /rest/v1/chat_messages by (from_user_id, client_message_id) with limit 1", () => {
    const url = fetchMessageByClientIdUrl(
      BASE,
      "alice",
      "11111111-2222-4333-8444-555555555555",
    );
    assert.equal(
      url,
      `${BASE}/rest/v1/chat_messages?from_user_id=eq.alice&client_message_id=eq.11111111-2222-4333-8444-555555555555&select=*&limit=1`,
    );
  });

  it("URI-encodes both parameters so injection can't escape the filter", () => {
    const url = fetchMessageByClientIdUrl(
      BASE,
      "alice&x=1",
      "id&y=2",
    );
    assert.ok(url.includes("from_user_id=eq.alice%26x%3D1"));
    assert.ok(url.includes("client_message_id=eq.id%26y%3D2"));
    assert.ok(!url.includes("&x=1"));
    assert.ok(!url.includes("&y=2"));
  });
});

describe("generateClientMessageId", () => {
  it("uses crypto.randomUUID when available", () => {
    let calls = 0;
    const fake = {
      randomUUID: () => {
        calls++;
        return "deterministic-uuid";
      },
    };
    assert.equal(generateClientMessageId(fake), "deterministic-uuid");
    assert.equal(calls, 1);
  });

  it("falls back to getRandomValues when randomUUID is unavailable, producing a valid v4 uuid", () => {
    const fake = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array && "length" in array && "BYTES_PER_ELEMENT" in array) {
          const bytes = array as unknown as Uint8Array;
          for (let i = 0; i < bytes.length; i++) bytes[i] = 0xab;
        }
        return array;
      },
    };
    const id = generateClientMessageId(fake);
    // Format: 8-4-4-4-12 hex digits, version-4 nibble, RFC 4122 variant.
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns distinct uuids on consecutive crypto calls", () => {
    let counter = 0;
    const fake = {
      randomUUID: () => `uuid-${counter++}`,
    };
    const a = generateClientMessageId(fake);
    const b = generateClientMessageId(fake);
    assert.notEqual(a, b);
  });

  it("still produces a valid uuid string without any crypto host (math.random fallback)", () => {
    const id = generateClientMessageId({});
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("chatRowToMessage with client_message_id", () => {
  it("hoists client_message_id into clientMessageId when present", () => {
    const row = {
      id: "msg-1",
      chat_id: "chat-a-b",
      from_user_id: "a",
      to_user_id: "b",
      text: "hello",
      created_at: "2026-04-25T10:00:00.000Z",
      client_message_id: "cmi-1",
    };
    const msg = chatRowToMessage(row);
    assert.equal(msg.clientMessageId, "cmi-1");
  });

  it("omits clientMessageId when the column is null (legacy rows)", () => {
    const row = {
      id: "msg-1",
      chat_id: "chat-a-b",
      from_user_id: "a",
      to_user_id: "b",
      text: "hello",
      created_at: "2026-04-25T10:00:00.000Z",
      client_message_id: null,
    };
    const msg = chatRowToMessage(row);
    assert.ok(!("clientMessageId" in msg));
  });
});

describe("chatRowToMessage", () => {
  it("camel-cases the row shape into a ChatMessage", () => {
    const row = {
      id: "msg-1",
      chat_id: "chat-a-b",
      from_user_id: "a",
      to_user_id: "b",
      text: "hello",
      created_at: "2026-04-25T10:00:00.000Z",
    };
    const msg: ChatMessage = chatRowToMessage(row);
    assert.deepEqual(msg, {
      id: "msg-1",
      chatId: "chat-a-b",
      fromUserId: "a",
      toUserId: "b",
      text: "hello",
      createdAt: "2026-04-25T10:00:00.000Z",
    });
  });
});

describe("buildAuthHeaders", () => {
  it("falls back to the anon key as the bearer when no session token is present", () => {
    const headers = buildAuthHeaders(KEY, null);
    assert.equal(headers.apikey, KEY);
    assert.equal(headers.Authorization, `Bearer ${KEY}`);
    assert.equal(headers["Content-Type"], "application/json");
  });

  it("uses the user's access token as the bearer when available", () => {
    const headers = buildAuthHeaders(KEY, "user-jwt-abc");
    assert.equal(headers.apikey, KEY);
    assert.equal(headers.Authorization, "Bearer user-jwt-abc");
  });
});

describe("buildSendMessageHeaders", () => {
  it("includes Prefer: return=representation so insert echoes the row back", () => {
    const headers = buildSendMessageHeaders(KEY, "tok");
    assert.equal(headers.Prefer, "return=representation");
    assert.equal(headers.apikey, KEY);
    assert.equal(headers.Authorization, "Bearer tok");
    assert.equal(headers["Content-Type"], "application/json");
  });
});

describe("friendCheckUrl", () => {
  it("queries friend_requests for one direction at a time", () => {
    const url = friendCheckUrl(BASE, "alice", "bob");
    assert.equal(
      url,
      `${BASE}/rest/v1/friend_requests?from_user_id=eq.alice&to_user_id=eq.bob&select=from_user_id`,
    );
  });

  it("URI-encodes both ids", () => {
    const url = friendCheckUrl(BASE, "alice@x", "bob#y");
    assert.ok(url.includes("from_user_id=eq.alice%40x"));
    assert.ok(url.includes("to_user_id=eq.bob%23y"));
  });
});

describe("isMutualFriendFromResponses", () => {
  it("returns true only when both directions have at least one row", () => {
    assert.equal(isMutualFriendFromResponses([{}], [{}]), true);
  });

  it("returns false when either side is empty", () => {
    assert.equal(isMutualFriendFromResponses([], [{}]), false);
    assert.equal(isMutualFriendFromResponses([{}], []), false);
    assert.equal(isMutualFriendFromResponses([], []), false);
  });

  it("returns false when either side is not an array (eg. error body)", () => {
    assert.equal(isMutualFriendFromResponses({ error: "x" }, [{}]), false);
    assert.equal(isMutualFriendFromResponses([{}], null), false);
  });
});

describe("unreadCountForChat", () => {
  function msg(overrides: Partial<ChatMessage>): ChatMessage {
    return {
      id: overrides.id ?? "m",
      chatId: "chat-a-b",
      fromUserId: overrides.fromUserId ?? "a",
      toUserId: overrides.toUserId ?? "b",
      text: "hi",
      createdAt: overrides.createdAt ?? "2026-04-25T10:00:00.000Z",
    };
  }

  it("counts only messages addressed to selfId after the lastReadAt cutoff", () => {
    const messages: ChatMessage[] = [
      msg({ id: "1", fromUserId: "b", toUserId: "a", createdAt: "2026-04-25T09:00:00.000Z" }),
      msg({ id: "2", fromUserId: "b", toUserId: "a", createdAt: "2026-04-25T11:00:00.000Z" }),
      msg({ id: "3", fromUserId: "a", toUserId: "b", createdAt: "2026-04-25T12:00:00.000Z" }),
    ];
    assert.equal(unreadCountForChat(messages, "a", "2026-04-25T10:00:00.000Z"), 1);
  });

  it("treats empty lastReadAt as 'count everything addressed to self'", () => {
    const messages: ChatMessage[] = [
      msg({ id: "1", fromUserId: "b", toUserId: "a", createdAt: "2026-04-25T09:00:00.000Z" }),
      msg({ id: "2", fromUserId: "b", toUserId: "a", createdAt: "2026-04-25T11:00:00.000Z" }),
    ];
    assert.equal(unreadCountForChat(messages, "a", ""), 2);
  });

  it("never counts messages the user themselves sent", () => {
    const messages: ChatMessage[] = [
      msg({ id: "1", fromUserId: "a", toUserId: "b", createdAt: "2026-04-25T11:00:00.000Z" }),
    ];
    assert.equal(unreadCountForChat(messages, "a", ""), 0);
  });

  it("returns 0 for an empty list", () => {
    assert.equal(unreadCountForChat([], "a", ""), 0);
  });
});

describe("inboxFilter", () => {
  it("restricts realtime stream to rows addressed to the given user", () => {
    assert.equal(inboxFilter("alice"), "to_user_id=eq.alice");
  });
});

describe("inboxChannelTopic", () => {
  it("is deterministic per user so re-subscribes hit the same channel", () => {
    assert.equal(inboxChannelTopic("alice"), "chat-inbox-alice");
    assert.equal(inboxChannelTopic("alice"), inboxChannelTopic("alice"));
  });

  it("differs per user", () => {
    assert.notEqual(inboxChannelTopic("alice"), inboxChannelTopic("bob"));
  });
});

describe("typingChannelTopic", () => {
  it("is deterministic per chat so both participants share one channel", () => {
    assert.equal(typingChannelTopic("chat-a-b"), "chat-typing-chat-a-b");
    assert.equal(typingChannelTopic("chat-a-b"), typingChannelTopic("chat-a-b"));
  });

  it("differs per chat", () => {
    assert.notEqual(typingChannelTopic("chat-a-b"), typingChannelTopic("chat-c-d"));
  });
});

describe("extractTypingUserIds", () => {
  it("returns remote user ids whose latest payload has typing: true, excluding self", () => {
    const state = {
      alice: [{ typing: true }],
      bob: [{ typing: false }],
      carol: [{ typing: true }],
    };
    assert.deepEqual(extractTypingUserIds(state, "alice"), ["carol"]);
  });

  it("returns [] when nobody (other than self) is typing", () => {
    const state = {
      alice: [{ typing: true }],
      bob: [{ typing: false }],
    };
    assert.deepEqual(extractTypingUserIds(state, "alice"), []);
  });

  it("ignores empty entry arrays and missing typing flags", () => {
    const state = {
      alice: [],
      bob: [{}],
      carol: [{ typing: true }],
    };
    assert.deepEqual(extractTypingUserIds(state, "self"), ["carol"]);
  });

  it("returns sorted ids so consumers can compare with reference equality patterns", () => {
    const state = {
      zara: [{ typing: true }],
      bob: [{ typing: true }],
      alice: [{ typing: true }],
    };
    assert.deepEqual(extractTypingUserIds(state, "self"), ["alice", "bob", "zara"]);
  });
});

describe("realtimeEndpoint", () => {
  it("upgrades https to wss and appends /realtime/v1", () => {
    assert.equal(
      realtimeEndpoint("https://demo.supabase.co"),
      "wss://demo.supabase.co/realtime/v1",
    );
  });

  it("upgrades http to ws for local supabase instances", () => {
    assert.equal(
      realtimeEndpoint("http://localhost:54321"),
      "ws://localhost:54321/realtime/v1",
    );
  });
});
