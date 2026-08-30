import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { autoUnmount, mockModule } from "./helpers/render";
import {
  drain,
  installSpyAsyncStorage,
  installSpyCapture,
  installSpyToast,
  installStubI18n,
  providerHarness,
  resetStorageNotice,
} from "./helpers/mount-provider";

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

// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

const spy = installSpyAsyncStorage();
const { reads, writes, store } = spy;
let user: { id: string } | null = { id: "user-a" };

const toasts = installSpyToast();
installStubI18n();

installSpyCapture();

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

const harness = providerHarness<ContextValue>(async () => {
  const chat: ChatModule = await import("../lib/chat-context");
  return { Provider: chat.ChatProvider, useValue: chat.useChat };
});

const mount = () => harness.mount();
const seen = () => harness.seen;

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

beforeEach(async () => {
  spy.reset();
  harness.reset();
  toasts.length = 0;
  await resetStorageNotice();
  user = { id: "user-a" };
});

describe("ChatProvider — one account", () => {
  it("hydrates the signed-in account's cache", async () => {
    const { chatCacheKey } = await import("../lib/storage-keys");
    store.set(KEY_A, A_PENDING);
    await mount();

    assert.equal(chatCacheKey("user-a"), KEY_A);
    assert.deepEqual(reads, [KEY_A]);
    assert.equal(seen()?.ready, true);
  });

  it("a failed read writes nothing, because the pending queue is not re-fetchable", async () => {
    store.set(KEY_A, A_PENDING);
    spy.readError = new Error("SecurityError: localStorage is not available");
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
    await drain(tree);

    const leaked = writes.filter((write) => write.key === KEY_B && write.value.includes("local-1"));
    assert.deepEqual(leaked, [], "user B must not receive user A's offline queue");
  });

  it("hydrates the new account from its own key", async () => {
    store.set(KEY_A, A_PENDING);
    const tree = await mount();
    reads.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    assert.deepEqual(reads, [KEY_B]);
  });

  it("signing out empties the store without writing it anywhere", async () => {
    store.set(KEY_A, A_PENDING);
    const tree = await mount();
    writes.length = 0;

    user = null;
    tree.rerender();
    await drain(tree);

    assert.deepEqual(writes, []);
    assert.equal(store.get(KEY_A), A_PENDING, "what A had is still A's");
  });
});
