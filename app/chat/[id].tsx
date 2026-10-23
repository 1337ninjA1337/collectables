import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { trackEvent } from "@/lib/analytics";
import { isFriendRelationship } from "@/lib/social-helpers";
import {
  AMBER_MUTED,
  AMBER_SOFT,
  AMBER_SOFT_2,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  CARD_BG_4,
  HERO_DARK,
  HERO_DARK_3,
  MUTED,
  MUTED_11,
  MUTED_12,
  MUTED_13,
  MUTED_14,
  RADIUS_CARD,
  RADIUS_PILL,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { useAppAway } from "@/lib/use-app-away";
import { useAppVisible } from "@/lib/use-app-visible";
import { useMountedRef } from "@/lib/use-mounted-ref";
import { useAuth } from "@/lib/auth-context";
import { useChat } from "@/lib/chat-context";
import { buildChatId } from "@/lib/chat-helpers";
import { CONNECTION_NOTICE_KEYS } from "@/lib/connection-notice";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { subscribeToTyping } from "@/lib/supabase-chat";
import { useConnectionNotice } from "@/lib/use-connection-notice";
import { DWELL_TIME_DEFAULT_MS, useDwellTimeEffect } from "@/lib/use-dwell-time";
import { useVisibilityRefresh } from "@/lib/use-visibility-refresh";

const TYPING_DEBOUNCE_MS = 1000;
const REFRESH_INTERVAL_MS = 8000;

export default function ChatDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const otherUserId = params.id ?? "";
  const { user } = useAuth();
  const { t, formatClockTime } = useI18n();
  const { getProfileById, ensureProfilesLoaded, getRelationship } = useSocial();
  const { getMessages, sendMessage, canMessage, markRead, clearChat, refreshFromCloud, realtimeOnline } = useChat();

  // The pill used to vanish on reconnect, which is announced by nothing:
  // text becoming empty is not a sentence. See lib/connection-notice.ts.
  const connectionNotice = useConnectionNotice(realtimeOnline);

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

  /**
   * A read receipt is a claim that somebody LOOKED at the message.
   *
   * This effect is keyed on `messages.length`, and messages arrive on their
   * own — over the realtime channel, or over the 8s poll below — so a message
   * that landed while the conversation sat in a hidden tab or a backgrounded
   * app marked itself read with nobody in front of it. `markRead` is not a
   * local flag: it writes `lastReadByChat` AND `upsertChatRead`, so the sender
   * was shown a read receipt the recipient never earned, and the recipient
   * lost the unread badge that was going to tell them about it.
   *
   * `appVisible` is a dependency rather than an early `return` for the half
   * that makes the gate honest: coming back re-runs this effect and marks read
   * everything that arrived while they were away, which is the moment they
   * actually did look.
   */
  const appVisible = useAppVisible();

  useEffect(() => {
    if (chatId && appVisible) markRead(chatId);
  }, [chatId, messages.length, appVisible, markRead]);

  /**
   * `chat_opened` counts ATTENTION, which is what its dwell gate was already
   * for.
   *
   * The 500ms gate exists so a back/forth navigation flicker does not count a
   * conversation nobody looked at — and the same event fired for a chat opened
   * into a hidden tab or a backgrounded app, which nobody looked at either.
   * That is the same reading the read receipt above now makes, and the funnel
   * was counting intent in one line and attention in the other.
   *
   * `appVisible` is in the DEPS, so a return re-arms the gate and the event
   * fires after 500ms of the user actually being there. `countedChatRef` is
   * what keeps that from counting the same conversation twice: without it, a
   * user who alt-tabs away and back fires `chat_opened` again for a chat they
   * never left. One fire per conversation per mount, which is what the event
   * has always claimed to be.
   */
  const countedChatRef = useRef<string | null>(null);

  useDwellTimeEffect([chatId, otherUserId, appVisible], DWELL_TIME_DEFAULT_MS, () => {
    if (!chatId || !appVisible) return;
    if (countedChatRef.current === chatId) return;
    countedChatRef.current = chatId;
    trackEvent("chat_opened", {
      conversationId: chatId,
      withFriend: isFriendRelationship(getRelationship(otherUserId)),
    });
  });

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

  // Clear typing presence when the user goes away, so the other side stops
  // seeing "is typing..." the moment they leave rather than when a timer says
  // so.
  //
  // `useAppAway` rather than the third hand-rolled copy of the platform split
  // this file carried: on native it reports every state that is not `active`
  // (a notification shade and an incoming call are both "not looking"), and on
  // web it listens for the window losing FOCUS as well as the tab being
  // hidden — alt-tabbing to another app is the commonest way a desktop user
  // leaves, and `document.hidden` reports it as `false`, so the listener this
  // replaces did not see it at all.
  useAppAway(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    typingSubRef.current?.setTyping(false);
  });

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

  /**
   * One press, one message.
   *
   * `sendMessage` awaits a cloud insert before anything clears the box, and
   * `disabled={!text.trim()}` is false for that whole round trip — so a second
   * tap, or `onSubmitEditing` landing on top of the press that triggered it,
   * sent the same text again under a fresh uuid. Two rows, two bubbles, and
   * nothing after the fact can tell them from a message somebody meant to send
   * twice.
   *
   * A ref rather than state, for the reason `app/collection/[id].tsx`'
   * `hasAttemptedShareSaveRef` is one: the second press is in the same tick as
   * the first, and a `setState` has not re-rendered yet when it arrives.
   */
  const sendingRef = useRef(false);

  /**
   * The ref AND a state, because the guard has two audiences.
   *
   * `sendingRef` is read by the second press, which arrives in the same tick as
   * the first and before any re-render — that is what it is for and a state
   * cannot do it. But the button stayed bright and pressable for the whole
   * round trip it was ignoring presses in: on a slow connection the user
   * presses, nothing moves for a second or two, and the only honest reading of
   * that interface is that the press did not land. `sending` drives `disabled`
   * and the dimmed style, so the control says what the guard is doing.
   *
   * `mountedRef` is what makes the state safe to set. `sendMessage` awaits a
   * cloud insert, the user can leave mid-flight, and a `setState` after the
   * screen is gone is the defect `app/profile/[id].tsx` grew its own
   * `mountedRef` for — on the same kind of slow connection that makes this
   * visible at all.
   */
  const [sending, setSending] = useState(false);
  const mountedRef = useMountedRef();

  const canSend = text.trim().length > 0 && !sending;

  async function handleSend() {
    if (!text.trim()) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    typingSubRef.current?.setTyping(false);
    try {
      const msg = await sendMessage(otherUserId, text);
      if (msg) {
        setText("");
      }
    } finally {
      // In a `finally` because a rejected send must not wedge the composer:
      // `sendMessage` resolves for an offline send (it queues), so a rejection
      // here is a bug somewhere else, and a button that never works again is
      // the worst way to report one.
      sendingRef.current = false;
      // The ref is cleared unconditionally and the state only while mounted:
      // the ref belongs to this closure, the state belongs to a component that
      // may be gone.
      if (mountedRef.current) setSending(false);
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
            accessibilityRole="button"
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
            <Pressable
              style={styles.headerAction}
              onPress={handleClear}
              accessibilityLabel={t("chatClear")}
              accessibilityRole="button"
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={MUTED}
                accessibilityElementsHidden
                importantForAccessibility="no"
                aria-hidden
              />
            </Pressable>
          ) : null}
        </View>

        {/* The region is mounted before the pill it will carry: a node that
            arrives with its text already inside it is a new node, not a
            changed one, and a new node is announced by nothing. See
            components/sync-status-pill.tsx. */}
        <View aria-live="polite" accessibilityLiveRegion="polite">
          {allowed && connectionNotice !== null ? (
            <View style={styles.offlinePill} accessibilityRole="text">
              <Text style={styles.offlinePillText}>
                {t(CONNECTION_NOTICE_KEYS[connectionNotice])}
              </Text>
            </View>
          ) : null}
        </View>

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
                  <Text style={styles.bubbleTime}>{formatClockTime(m.createdAt)}</Text>
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

        {/*
          One reading for all four props. `disabled`, the style, the icon
          colour and the a11y state were four copies of `text.trim()`, and the
          round that added `sending` would otherwise have had to remember all
          four — which is how a control comes to LOOK enabled while refusing
          presses, the bug this is fixing one shape of.

          `busy` is beside `disabled` rather than instead of it: a screen
          reader announcing "dimmed" says the press will not land, and `busy`
          says why — the message is going out, not that there is nothing to
          send.
        */}
        <View style={styles.composer}>
          <MaskedTextInput
            style={styles.input}
            placeholder={t("chatInputPlaceholder")}
            placeholderTextColor={MUTED_14}
            value={text}
            onChangeText={handleTextChange}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline
          />
          <Pressable
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            accessibilityState={{ disabled: !canSend, busy: sending }}
            accessibilityLabel={t("chatSend")}
            accessibilityRole="button"
          >
            <Ionicons
              name="send"
              size={18}
              color={canSend ? TEXT_ON_DARK_5 : AMBER_MUTED}
              accessibilityElementsHidden
              importantForAccessibility="no"
              aria-hidden
            />
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
    gap: SPACING_CARD,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_CARD,
    flex: 1,
  },
  headerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: AMBER_MUTED,
  },
  headerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: HERO_DARK_3,
    fontWeight: "800",
    fontSize: 18,
  },
  headerMeta: {
    flex: 1,
  },
  headerName: {
    color: TEXT_DARK,
    fontSize: 17,
    fontWeight: "800",
  },
  headerHandle: {
    color: MUTED,
    fontWeight: "700",
    fontSize: 12,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingVertical: 16,
    gap: SPACING_LIST,
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 40,
    gap: SPACING_INLINE,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_DARK,
  },
  emptyHint: {
    color: MUTED_11,
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
    backgroundColor: HERO_DARK,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomLeftRadius: 6,
  },
  bubbleTextMine: {
    color: TEXT_ON_DARK_5,
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextTheirs: {
    color: TEXT_DARK,
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTime: {
    fontSize: 11,
    color: MUTED_14,
    paddingHorizontal: 4,
  },
  offlinePill: {
    alignSelf: "center",
    backgroundColor: CARD_BG_4,
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: AMBER_SOFT_2,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 4,
  },
  offlinePillText: {
    fontSize: 12,
    color: MUTED_12,
    fontWeight: "600",
  },
  typingRow: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  typingText: {
    fontSize: 12,
    color: MUTED,
    fontStyle: "italic",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SPACING_LIST,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS_CARD,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_DARK,
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: RADIUS_CARD,
    backgroundColor: HERO_DARK,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: MUTED_13,
    opacity: 0.6,
  },
});
