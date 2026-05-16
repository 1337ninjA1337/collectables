import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  ChatPreview,
  appendMessage,
  buildChatId,
  buildChatPreviews,
  canChatWith,
  totalUnread,
} from "@/lib/chat-helpers";
import { captureException } from "@/lib/sentry";
import { useSocial } from "@/lib/social-context";
import {
  fetchChatReads,
  fetchMessagesForChat as cloudFetchMessagesForChat,
  sendMessage as cloudSendMessage,
  subscribeToInbox,
  upsertChatRead,
} from "@/lib/supabase-chat";
import { chatCacheKey } from "@/lib/storage-keys";
import { ChatMessage } from "@/lib/types";
import { generateUuidV4, isUuidV4 } from "@/lib/uuid";

type ChatStore = {
  messagesByChat: Record<string, ChatMessage[]>;
  lastReadByChat: Record<string, string>;
  pendingByChatId: Record<string, ChatMessage[]>;
};

type ChatContextValue = {
  ready: boolean;
  previews: ChatPreview[];
  unreadTotal: number;
  realtimeOnline: boolean;
  getMessages: (chatId: string) => ChatMessage[];
  canMessage: (otherUserId: string) => boolean;
  ensureChatWith: (otherUserId: string) => string | null;
  sendMessage: (otherUserId: string, text: string) => Promise<ChatMessage | null>;
  markRead: (chatId: string) => void;
  clearChat: (chatId: string) => void;
  refreshFromCloud: (otherUserIds?: readonly string[]) => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { friends } = useSocial();
  const [store, setStore] = useState<ChatStore>({ messagesByChat: {}, lastReadByChat: {}, pendingByChatId: {} });
  const [ready, setReady] = useState(false);
  const [realtimeOnline, setRealtimeOnline] = useState(false);
  const pendingRef = useRef<Record<string, ChatMessage[]>>({});

  const storageKey = user ? chatCacheKey(user.id) : null;

  useEffect(() => {
    if (!storageKey) {
      setStore({ messagesByChat: {}, lastReadByChat: {}, pendingByChatId: {} });
      setReady(false);
      return;
    }

    let active = true;

    async function hydrate(key: string) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<ChatStore>;
          setStore({
            messagesByChat: parsed.messagesByChat ?? {},
            lastReadByChat: parsed.lastReadByChat ?? {},
            pendingByChatId: parsed.pendingByChatId ?? {},
          });
        } else {
          setStore({ messagesByChat: {}, lastReadByChat: {}, pendingByChatId: {} });
        }
      } finally {
        if (active) setReady(true);
      }
    }

    void hydrate(storageKey);

    return () => {
      active = false;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(store)).catch(() => undefined);
  }, [ready, storageKey, store]);

  // Keep a ref in sync with the latest pending queue so flushPending can read
  // it without re-creating refreshFromCloud on every store change.
  useEffect(() => {
    pendingRef.current = store.pendingByChatId;
  }, [store.pendingByChatId]);

  const mergeCloudMessages = useCallback(
    (results: readonly { chatId: string; messages: ChatMessage[] }[]) => {
      setStore((prev) => {
        let nextMessages = prev.messagesByChat;
        let touched = false;
        for (const { chatId, messages } of results) {
          if (messages.length === 0) continue;
          const existing = nextMessages[chatId] ?? [];
          let merged = existing;
          for (const msg of messages) {
            merged = appendMessage(merged, msg);
          }
          if (merged !== existing) {
            if (!touched) {
              nextMessages = { ...nextMessages };
              touched = true;
            }
            nextMessages[chatId] = merged;
          }
        }
        if (!touched) return prev;
        return { ...prev, messagesByChat: nextMessages };
      });
    },
    [],
  );

  const flushPending = useCallback(
    async (pending: Record<string, ChatMessage[]>) => {
      if (!user) return;
      // Track every message that reached the server so it can be dropped from
      // the pending queue individually (not whole-chat): a partial flush must
      // not re-send already-delivered messages on the next attempt. Legacy
      // rows cached before the uuid fix carry a `msg-…` id the uuid
      // `chat_messages.id` column rejects, so they are remapped to a real
      // uuid; `newId` lets the local cache (and any realtime echo / refetch
      // keyed on the server id) stay deduped.
      const sent: { chatId: string; oldId: string; newId: string }[] = [];
      for (const [chatId, msgs] of Object.entries(pending)) {
        if (!msgs || msgs.length === 0) continue;
        for (const msg of msgs) {
          const outId = isUuidV4(msg.id) ? msg.id : generateUuidV4();
          const delivered = await cloudSendMessage({
            chatId: msg.chatId,
            fromUserId: msg.fromUserId,
            toUserId: msg.toUserId,
            text: msg.text,
            id: outId,
            createdAt: msg.createdAt,
          });
          // Stop at the first failure in this chat to preserve send order;
          // the rest stay queued for the next flush.
          if (!delivered) break;
          sent.push({ chatId, oldId: msg.id, newId: outId });
        }
      }
      if (sent.length === 0) return;

      const sentByChat = new Map<string, Set<string>>();
      for (const { chatId, oldId } of sent) {
        const set = sentByChat.get(chatId) ?? new Set<string>();
        set.add(oldId);
        sentByChat.set(chatId, set);
      }

      setStore((prev) => {
        const nextPending: Record<string, ChatMessage[]> = {};
        for (const [chatId, msgs] of Object.entries(prev.pendingByChatId)) {
          const sentIds = sentByChat.get(chatId);
          const remaining = sentIds
            ? msgs.filter((m) => !sentIds.has(m.id))
            : msgs;
          if (remaining.length > 0) nextPending[chatId] = remaining;
        }

        let nextMessages = prev.messagesByChat;
        const remaps = sent.filter((s) => s.oldId !== s.newId);
        if (remaps.length > 0) {
          nextMessages = { ...nextMessages };
          for (const { chatId, oldId, newId } of remaps) {
            const list = nextMessages[chatId];
            if (!list) continue;
            nextMessages[chatId] = list.map((m) =>
              m.id === oldId ? { ...m, id: newId } : m,
            );
          }
        }

        return {
          ...prev,
          pendingByChatId: nextPending,
          messagesByChat: nextMessages,
        };
      });
    },
    [user],
  );

  const refreshFromCloud = useCallback(
    async (otherUserIds?: readonly string[]) => {
      if (!user) return;
      const targets = otherUserIds && otherUserIds.length > 0 ? otherUserIds : friends;
      if (targets.length === 0) return;
      const results = await Promise.all(
        targets.map(async (otherId) => {
          const chatId = buildChatId(user.id, otherId);
          const messages = await cloudFetchMessagesForChat(chatId);
          return { chatId, messages };
        }),
      );
      mergeCloudMessages(results);
      void flushPending(pendingRef.current);
    },
    [friends, flushPending, mergeCloudMessages, user],
  );

  // Pull cloud messages for every confirmed-friend chat once we have a user
  // and the local cache has been hydrated. Cloud rows are merged on top of
  // cached rows (deduped by id), so offline-first reads keep working when the
  // network or Supabase config is unavailable.
  useEffect(() => {
    if (!ready || !user || friends.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const results = await Promise.all(
          friends.map(async (friendId) => {
            const chatId = buildChatId(user.id, friendId);
            const messages = await cloudFetchMessagesForChat(chatId);
            return { chatId, messages };
          }),
        );

        if (cancelled) return;
        mergeCloudMessages(results);
      } catch (err) {
        // Swallow + report — a transient cloud read failure (e.g. iOS Safari
        // 18's intermittent "Load failed" fetch flake) must not surface as an
        // unhandled rejection that the browser's unhandled-rejection handler
        // can treat as a render crash.
        captureException(err, { context: "chat-context.cloudFetchMessages" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, friends, mergeCloudMessages]);

  // Hydrate server-side last-read timestamps so the unread badge is consistent
  // across devices. Server wins for any chat where it has a later timestamp.
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const cloudReads = await fetchChatReads(user.id);
        if (cancelled || Object.keys(cloudReads).length === 0) return;
        setStore((prev) => {
          let touched = false;
          let nextRead = prev.lastReadByChat;
          for (const [chatId, cloudAt] of Object.entries(cloudReads)) {
            const localAt = prev.lastReadByChat[chatId] ?? "";
            if (cloudAt > localAt) {
              if (!touched) {
                nextRead = { ...nextRead };
                touched = true;
              }
              nextRead[chatId] = cloudAt;
            }
          }
          if (!touched) return prev;
          return { ...prev, lastReadByChat: nextRead };
        });
      } catch (err) {
        captureException(err, { context: "chat-context.fetchChatReads" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  // Realtime inbox: any INSERT on chat_messages where to_user_id = me is
  // pushed straight into local state so other-device messages show up
  // without a poll. RLS already restricts what the channel can deliver, so
  // an over-permissive payload is impossible.
  useEffect(() => {
    if (!ready || !user) return;

    const subscription = subscribeToInbox(
      user.id,
      (incoming) => {
        setStore((prev) => {
          const existing = prev.messagesByChat[incoming.chatId] ?? [];
          const merged = appendMessage(existing, incoming);
          if (merged === existing) return prev;
          return {
            ...prev,
            messagesByChat: { ...prev.messagesByChat, [incoming.chatId]: merged },
          };
        });
      },
      (connected) => setRealtimeOnline(connected),
    );

    return () => {
      setRealtimeOnline(false);
      subscription.unsubscribe();
    };
  }, [ready, user]);

  const previews = useMemo<ChatPreview[]>(() => {
    if (!user) return [];
    return buildChatPreviews(store.messagesByChat, user.id, store.lastReadByChat);
  }, [store, user]);

  const unreadTotal = useMemo(() => totalUnread(previews), [previews]);

  const canMessage = useCallback(
    (otherUserId: string) => canChatWith(otherUserId, user?.id, friends),
    [friends, user],
  );

  const ensureChatWith = useCallback(
    (otherUserId: string) => {
      if (!user) return null;
      if (!canMessage(otherUserId)) return null;
      return buildChatId(user.id, otherUserId);
    },
    [canMessage, user],
  );

  const sendMessage = useCallback(
    async (otherUserId: string, text: string) => {
      if (!user) return null;
      const trimmed = text.trim();
      if (!trimmed) return null;
      if (!canMessage(otherUserId)) return null;

      const chatId = buildChatId(user.id, otherUserId);

      // Generate the message id client-side so it is stable from composition
      // onward: the same uuid is used for the cloud insert, the local cache,
      // and any later offline-flush retry. Because the server primary key is
      // exactly this id, a retry after a lost response is an idempotent no-op
      // (ON CONFLICT DO NOTHING) rather than a duplicate row. `created_at` is
      // left for the server to set so message ordering stays consistent
      // across clients with skewed clocks.
      const id = generateUuidV4();
      const createdAt = new Date().toISOString();

      // Try cloud first so other devices see the message. When the cloud send
      // fails (offline, unconfigured, RLS reject), fall back to the locally
      // composed message (same id) so the UI records the attempt and the
      // pending queue can flush it later; AsyncStorage caches it for re-reads.
      const cloudMessage = await cloudSendMessage({
        chatId,
        fromUserId: user.id,
        toUserId: otherUserId,
        text: trimmed,
        id,
      });

      const message: ChatMessage = cloudMessage ?? {
        id,
        chatId,
        fromUserId: user.id,
        toUserId: otherUserId,
        text: trimmed,
        createdAt,
      };

      setStore((prev) => {
        const next: ChatStore = {
          ...prev,
          messagesByChat: {
            ...prev.messagesByChat,
            [chatId]: appendMessage(prev.messagesByChat[chatId] ?? [], message),
          },
          lastReadByChat: {
            ...prev.lastReadByChat,
            [chatId]: message.createdAt,
          },
        };
        if (!cloudMessage) {
          next.pendingByChatId = {
            ...prev.pendingByChatId,
            [chatId]: [...(prev.pendingByChatId[chatId] ?? []), message],
          };
        }
        return next;
      });

      return message;
    },
    [canMessage, user],
  );

  const markRead = useCallback(
    (chatId: string) => {
      setStore((prev) => {
        const msgs = prev.messagesByChat[chatId] ?? [];
        if (msgs.length === 0) return prev;
        const latest = msgs.reduce(
          (acc, m) => (m.createdAt > acc ? m.createdAt : acc),
          prev.lastReadByChat[chatId] ?? "",
        );
        if (latest === prev.lastReadByChat[chatId]) return prev;
        if (user) void upsertChatRead(user.id, chatId, latest);
        return {
          ...prev,
          lastReadByChat: { ...prev.lastReadByChat, [chatId]: latest },
        };
      });
    },
    [user],
  );

  const clearChat = useCallback((chatId: string) => {
    setStore((prev) => {
      if (!(chatId in prev.messagesByChat) && !(chatId in prev.lastReadByChat)) {
        return prev;
      }
      const nextMessages = { ...prev.messagesByChat };
      delete nextMessages[chatId];
      const nextRead = { ...prev.lastReadByChat };
      delete nextRead[chatId];
      const nextPending = { ...prev.pendingByChatId };
      delete nextPending[chatId];
      return { messagesByChat: nextMessages, lastReadByChat: nextRead, pendingByChatId: nextPending };
    });
  }, []);

  const getMessages = useCallback(
    (chatId: string) => {
      const msgs = store.messagesByChat[chatId] ?? [];
      return [...msgs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    [store],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      ready,
      previews,
      unreadTotal,
      realtimeOnline,
      getMessages,
      canMessage,
      ensureChatWith,
      sendMessage,
      markRead,
      clearChat,
      refreshFromCloud,
    }),
    [
      ready,
      previews,
      unreadTotal,
      realtimeOnline,
      getMessages,
      canMessage,
      ensureChatWith,
      sendMessage,
      markRead,
      clearChat,
      refreshFromCloud,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used inside ChatProvider");
  }
  return context;
}
