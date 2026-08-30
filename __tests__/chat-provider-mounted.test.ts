import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * `ChatProvider`, mounted — the account switch, asked of the provider whose
 * blob is the one nothing upstream can rebuild.
 *
 * `messagesByChat` is a cache the cloud refills. `pendingByChatId` is NOT: it
 * holds messages composed OFFLINE, and it is the reason this provider's
 * hydration gate exists at all. When the leak found in `premium-context` was
 * checked here, this was the provider where it cost the most — user A's
 * unsent messages written under user B's key on a shared device — and the only
 * thing covering it was a sweep looking for the name `hydrationMatchesKey` in
 * the source, which is the shape that missed the bug to begin with.
 *
 * Four modules stand between this provider and a mount: the session, the
 * friends list, the whole Supabase chat surface, and Sentry. All four are
 * `mockModule` calls; none of them is a dev-dep.
 */

installNativeModuleStubs();

const writes: { key: string; value: string }[] = [];
const reads: string[] = [];
const store = new Map<string, string>();
let readError: Error | null = null;
let user: { id: string } | null = { id: "user-a" };

mockModule("@react-native-async-storage/async-storage", {
  default: {
    getItem: async (key: string) => {
      reads.push(key);
      if (readError) throw readError;
      return store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      writes.push({ key, value });
      store.set(key, value);
    },
  },
});

mockModule("@/lib/sentry", { captureException: () => undefined });

mockModule("@/lib/auth-context", { useAuth: () => ({ user }) });

mockModule("@/lib/social-context", { useSocial: () => ({ friends: [] as string[] }) });

mockModule("@/lib/supabase-chat", {
  fetchChatReads: async () => ({}),
  fetchMessagesForChat: async () => [],
  sendMessage: async () => null,
  upsertChatRead: async () => undefined,
  subscribeToInbox: () => ({ unsubscribe: () => undefined }),
});

type ChatModule = typeof import("../lib/chat-context");
type ContextValue = ReturnType<ChatModule["useChat"]>;

let chat: ChatModule | null = null;
let seen: ContextValue | null = null;

function Probe() {
  seen = chat!.useChat();
  return createElement("View", null);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount() {
  chat ??= await import("../lib/chat-context");
  (await import("../lib/report-storage-failure")).__resetStorageFailureReportsForTests();
  const tree = render(createElement(chat.ChatProvider, null, createElement(Probe)));
  await settle();
  tree.rerender();
  await settle();
  tree.rerender();
  return tree;
}

const KEY_A = "collectables-chats-v1-user-a";
const KEY_B = "collectables-chats-v1-user-b";

/** One message user A composed while offline. Nothing upstream holds it. */
const A_PENDING = JSON.stringify({
  messagesByChat: {},
  lastReadByChat: {},
  pendingByChatId: {
    "chat-a-friend": [
      {
        id: "local-1",
        chatId: "chat-a-friend",
        senderId: "user-a",
        recipientId: "friend",
        text: "sent from the tunnel",
        createdAt: "2026-08-30T00:00:00.000Z",
      },
    ],
  },
});

beforeEach(() => {
  writes.length = 0;
  reads.length = 0;
  store.clear();
  readError = null;
  user = { id: "user-a" };
  seen = null;
});

describe("ChatProvider — one account", () => {
  it("hydrates the signed-in account's cache", async () => {
    const { chatCacheKey } = await import("../lib/storage-keys");
    store.set(KEY_A, A_PENDING);
    await mount();

    assert.equal(chatCacheKey("user-a"), KEY_A);
    assert.deepEqual(reads, [KEY_A]);
    assert.equal(seen?.ready, true);
  });

  it("a failed read writes nothing, because the pending queue is not re-fetchable", async () => {
    store.set(KEY_A, A_PENDING);
    readError = new Error("SecurityError: localStorage is not available");
    await mount();

    assert.deepEqual(writes, []);
    assert.equal(store.get(KEY_A), A_PENDING, "the offline messages stay on disk");
  });
});

describe("ChatProvider — the account changes under it", () => {
  it("does not write user A's messages under user B's key", async () => {
    store.set(KEY_A, A_PENDING);
    const tree = await mount();
    writes.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await settle();
    tree.rerender();

    const leaked = writes.filter((write) => write.key === KEY_B && write.value.includes("local-1"));
    assert.deepEqual(leaked, [], "user B must not receive user A's offline queue");
  });

  it("hydrates the new account from its own key", async () => {
    store.set(KEY_A, A_PENDING);
    const tree = await mount();
    reads.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await settle();
    tree.rerender();

    assert.deepEqual(reads, [KEY_B]);
  });

  it("signing out empties the store without writing it anywhere", async () => {
    store.set(KEY_A, A_PENDING);
    const tree = await mount();
    writes.length = 0;

    user = null;
    tree.rerender();
    await settle();
    tree.rerender();

    assert.deepEqual(writes, []);
    assert.equal(store.get(KEY_A), A_PENDING, "what A had is still A's");
  });
});
