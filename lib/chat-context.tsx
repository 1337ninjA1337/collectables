import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  ChatPreview,
  appendMessage,
  buildChatId,
  buildChatPreviews,
  canChatWith,
  totalUnread,
} from "@/lib/chat-helpers";
import { useSocial } from "@/lib/social-context";
import { ChatMessage } from "@/lib/types";

const CHAT_STORAGE_KEY = "collectables-chats-v1";

type ChatStore = {
  messagesByChat: Record<string, ChatMessage[]>;
  lastReadByChat: Record<string, string>;
};

type ChatContextValue = {
  ready: boolean;
  previews: ChatPreview[];
  unreadTotal: number;
  getMessages: (chatId: string) => ChatMessage[];
  canMessage: (otherUserId: string) => boolean;
  ensureChatWith: (otherUserId: string) => string | null;
  sendMessage: (otherUserId: string, text: string) => Promise<ChatMessage | null>;
  markRead: (chatId: string) => void;
  clearChat: (chatId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { friends } = useSocial();
  const [store, setStore] = useState<ChatStore>({ messagesByChat: {}, lastReadByChat: {} });
  const [ready, setReady] = useState(false);

  const storageKey = user ? `${CHAT_STORAGE_KEY}-${user.id}` : null;

  useEffect(() => {
    if (!storageKey) {
      setStore({ messagesByChat: {}, lastReadByChat: {} });
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
          });
        } else {
          setStore({ messagesByChat: {}, lastReadByChat: {} });
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
      const message: ChatMessage = {
        id: generateMessageId(),
        chatId,
        fromUserId: user.id,
        toUserId: otherUserId,
        text: trimmed,
        createdAt: new Date().toISOString(),
      };

      setStore((prev) => ({
        messagesByChat: {
          ...prev.messagesByChat,
          [chatId]: appendMessage(prev.messagesByChat[chatId] ?? [], message),
        },
        lastReadByChat: {
          ...prev.lastReadByChat,
          [chatId]: message.createdAt,
        },
      }));

      return message;
    },
    [canMessage, user],
  );

  const markRead = useCallback((chatId: string) => {
    setStore((prev) => {
      const msgs = prev.messagesByChat[chatId] ?? [];
      if (msgs.length === 0) return prev;
      const latest = msgs.reduce(
        (acc, m) => (m.createdAt > acc ? m.createdAt : acc),
        prev.lastReadByChat[chatId] ?? "",
      );
      if (latest === prev.lastReadByChat[chatId]) return prev;
      return {
        ...prev,
        lastReadByChat: { ...prev.lastReadByChat, [chatId]: latest },
      };
    });
  }, []);

  const clearChat = useCallback((chatId: string) => {
    setStore((prev) => {
      if (!(chatId in prev.messagesByChat) && !(chatId in prev.lastReadByChat)) {
        return prev;
      }
      const nextMessages = { ...prev.messagesByChat };
      delete nextMessages[chatId];
      const nextRead = { ...prev.lastReadByChat };
      delete nextRead[chatId];
      return { messagesByChat: nextMessages, lastReadByChat: nextRead };
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
      getMessages,
      canMessage,
      ensureChatWith,
      sendMessage,
      markRead,
      clearChat,
    }),
    [ready, previews, unreadTotal, getMessages, canMessage, ensureChatWith, sendMessage, markRead, clearChat],
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
