import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useChat } from "@/lib/chat-context";
import { buildChatId } from "@/lib/chat-helpers";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { subscribeToTyping } from "@/lib/supabase-chat";
import { useVisibilityRefresh } from "@/lib/use-visibility-refresh";

const TYPING_DEBOUNCE_MS = 1000;
const REFRESH_INTERVAL_MS = 8000;

function formatTime(iso: string, locale: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChatDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const otherUserId = params.id ?? "";
  const { user } = useAuth();
  const { t, language } = useI18n();
  const { getProfileById, ensureProfilesLoaded, getRelationship } = useSocial();
  const { getMessages, sendMessage, canMessage, markRead, clearChat, refreshFromCloud, realtimeOnline } = useChat();

  const [text, setText] = useState("");
  const otherProfile = getProfileById(otherUserId) ?? null;
  const [typingUserIds, setTypingUserIds] = useState<readonly string[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);
  const typingSubRef = useRef<{ setTyping: (v: boolean) => void; unsubscribe: () => void } | null>(
    null,
  );
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!otherUserId) return;
    ensureProfilesLoaded([otherUserId]);
  }, [otherUserId, ensureProfilesLoaded]);

  // Refetch the chat from cloud on mount so the recipient sees the sender's
  // latest message even if the realtime channel is silently down. Scoped to
  // the open conversation to keep it cheap.
  useEffect(() => {
    if (!otherUserId) return;
    void refreshFromCloud([otherUserId]);
  }, [otherUserId, refreshFromCloud]);

  const chatId = useMemo(() => {
    if (!user || !otherUserId) return null;
    return buildChatId(user.id, otherUserId);
  }, [user, otherUserId]);

  const messages = useMemo(() => (chatId ? getMessages(chatId) : []), [chatId, getMessages]);
  const allowed = canMessage(otherUserId);

  useEffect(() => {
    if (chatId) markRead(chatId);
  }, [chatId, messages.length, markRead]);

  // Fire chat_opened debounced — a 500ms dwell-time gate prevents a back/forth
  // navigation flicker from double-counting the conversation. The cleanup
  // clears the timer if the user leaves before the gate elapses.
  useEffect(() => {
    if (!chatId) return;
    const timer = setTimeout(() => {
      trackEvent("chat_opened", {
        conversationId: chatId,
        withFriend: getRelationship(otherUserId) === "friend",
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [chatId, otherUserId, getRelationship]);

  // Belt-and-braces fallback for realtime: pull fresh messages on mount and
  // every few seconds while the chat is open, pausing when backgrounded.
  useVisibilityRefresh(
    () => { if (otherUserId && allowed) void refreshFromCloud([otherUserId]); },
    REFRESH_INTERVAL_MS,
  );

  // Presence-based typing indicator. We open one channel per chat, keyed by
  // selfId, so each side sees the other's `{ typing: boolean }` payload.
  useEffect(() => {
    if (!chatId || !user || !allowed) {
      setTypingUserIds([]);
      return;
    }
    const sub = subscribeToTyping(chatId, user.id, (ids) => {
      setTypingUserIds(ids);
    });
    typingSubRef.current = sub;
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      typingSubRef.current = null;
      sub.setTyping(false);
      sub.unsubscribe();
    };
  }, [chatId, user, allowed]);

  // Clear typing presence when the user backgrounds the app or blurs the tab,
  // so the other side stops seeing "is typing..." after ~1s instead of ~30s.
  useEffect(() => {
    function clearTyping() {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      typingSubRef.current?.setTyping(false);
    }

    if (Platform.OS === "web") {
      if (typeof document === "undefined") return;
      function onVisibilityChange() {
        if (document.hidden) clearTyping();
      }
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") clearTyping();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages.length]);

  function handleTextChange(next: string) {
    setText(next);
    const sub = typingSubRef.current;
    if (!sub) return;
    if (next.trim().length === 0) {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      sub.setTyping(false);
      return;
    }
    sub.setTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      typingSubRef.current?.setTyping(false);
      typingTimerRef.current = null;
    }, TYPING_DEBOUNCE_MS);
  }

  async function handleSend() {
    if (!text.trim()) return;
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    typingSubRef.current?.setTyping(false);
    const msg = await sendMessage(otherUserId, text);
    if (msg) {
      setText("");
    }
  }

  function handleClear() {
    if (chatId) clearChat(chatId);
  }

  const title = otherProfile?.displayName ?? t("chatTitle");

  if (!user) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState icon="🔒" title={t("checkingSession")} />
      </Screen>
    );
  }

  if (!allowed) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState
          icon="🔒"
          title={t("chatOnlyFriendsTitle")}
          hint={t("chatOnlyFriendsHint")}
          actionLabel={otherProfile ? t("openProfile") : t("findPeople")}
          onAction={() =>
            router.push(otherProfile ? (`/profile/${otherProfile.id}` as never) : "/people")
          }
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.push(`/profile/${otherUserId}` as never)}
            style={styles.headerLeft}
          >
            {otherProfile?.avatar ? (
              <Image source={{ uri: otherProfile.avatar }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
                <Text style={styles.headerAvatarText}>
                  {title.charAt(0).toUpperCase() || "?"}
                </Text>
              </View>
            )}
            <View style={styles.headerMeta}>
              <Text style={styles.headerName} numberOfLines={1}>
                {title}
              </Text>
              {otherProfile?.username ? (
                <Text style={styles.headerHandle}>@{otherProfile.username}</Text>
              ) : null}
            </View>
          </Pressable>
          {messages.length > 0 ? (
            <Pressable style={styles.headerAction} onPress={handleClear} accessibilityLabel={t("chatClear")}>
              <Ionicons name="trash-outline" size={18} color="#8f6947" />
            </Pressable>
          ) : null}
        </View>

        {allowed && !realtimeOnline ? (
          <View style={styles.offlinePill}>
            <Text style={styles.offlinePillText}>{t("chatOfflinePill")}</Text>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>{t("chatEmptyTitle")}</Text>
              <Text style={styles.emptyHint}>{t("chatEmptyHint")}</Text>
            </View>
          ) : (
            messages.map((m) => {
              const mine = m.fromUserId === user.id;
              return (
                <View
                  key={m.id}
                  style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}
                >
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                      {m.text}
                    </Text>
                  </View>
                  <Text style={styles.bubbleTime}>{formatTime(m.createdAt, language)}</Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {typingUserIds.length > 0 ? (
          <View style={styles.typingRow}>
            <Text style={styles.typingText}>
              {(otherProfile?.displayName ?? title) + " " + t("chatTyping")}
            </Text>
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder={t("chatInputPlaceholder")}
            placeholderTextColor="#a08970"
            value={text}
            onChangeText={handleTextChange}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline
          />
          <Pressable
            style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
            accessibilityLabel={t("chatSend")}
          >
            <Ionicons name="send" size={18} color={text.trim() ? "#fff7ea" : "#d9c2a8"} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eadbc8",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  headerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#d9c2a8",
  },
  headerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: "#3a2716",
    fontWeight: "800",
    fontSize: 18,
  },
  headerMeta: {
    flex: 1,
  },
  headerName: {
    color: "#2f2318",
    fontSize: 17,
    fontWeight: "800",
  },
  headerHandle: {
    color: "#8f6947",
    fontWeight: "700",
    fontSize: 12,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    alignItems: "center",
    justifyContent: "center",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingVertical: 16,
    gap: 10,
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#2f2318",
  },
  emptyHint: {
    color: "#6f5a44",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  bubbleWrap: {
    maxWidth: "82%",
    gap: 2,
  },
  bubbleWrapMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubbleWrapTheirs: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  bubbleMine: {
    backgroundColor: "#261b14",
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#eadbc8",
    borderBottomLeftRadius: 6,
  },
  bubbleTextMine: {
    color: "#fff7ea",
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextTheirs: {
    color: "#2f2318",
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTime: {
    fontSize: 11,
    color: "#a08970",
    paddingHorizontal: 4,
  },
  offlinePill: {
    alignSelf: "center",
    backgroundColor: "#fff0d6",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e0b87a",
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 4,
  },
  offlinePillText: {
    fontSize: 12,
    color: "#7a4f1a",
    fontWeight: "600",
  },
  typingRow: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  typingText: {
    fontSize: 12,
    color: "#8f6947",
    fontStyle: "italic",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eadbc8",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    color: "#2f2318",
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#261b14",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#8a6e54",
    opacity: 0.6,
  },
});
