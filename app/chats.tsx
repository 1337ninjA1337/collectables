import { Stack, router } from "expo-router";
import { useEffect, useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { useChat } from "@/lib/chat-context";
import {
  AMBER_LIGHT,
  AMBER_MUTED,
  BORDER,
  CARD_BG,
  DANGER,
  HERO_DARK,
  HERO_DARK_3,
  MUTED,
  MUTED_2,
  TEXT_DARK,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { useVisibilityRefresh } from "@/lib/use-visibility-refresh";

const CHATS_REFRESH_INTERVAL_MS = 15000;

export default function ChatsScreen() {
  const { t, formatRelativeDate } = useI18n();
  const { previews, refreshFromCloud } = useChat();
  const { getProfileById, ensureProfilesLoaded, friends } = useSocial();

  const otherIds = useMemo(() => previews.map((p) => p.otherUserId), [previews]);

  useEffect(() => {
    ensureProfilesLoaded(otherIds);
  }, [otherIds, ensureProfilesLoaded]);

  // Refresh on mount and on a recurring interval, pausing when backgrounded.
  useVisibilityRefresh(() => { void refreshFromCloud(); }, CHATS_REFRESH_INTERVAL_MS);

  return (
    <Screen>
      <Stack.Screen options={{ title: t("chatsTitle") }} />
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("community")}</Text>
        <Text style={styles.title}>{t("chatsTitle")}</Text>
        <Text style={styles.subtitle}>{t("chatsSubtitle")}</Text>
      </View>

      {previews.length === 0 ? (
        <EmptyState
          icon="💬"
          title={t("chatsEmptyTitle")}
          hint={friends.length === 0 ? t("chatsEmptyNoFriendsHint") : t("chatsEmptyHint")}
          actionLabel={friends.length === 0 ? t("findPeople") : t("goFriends")}
          onAction={() => router.push(friends.length === 0 ? "/people" : "/friends")}
        />
      ) : (
        <View style={styles.list}>
          {previews.map((preview) => {
            const profile = getProfileById(preview.otherUserId);
            const displayName = profile?.displayName ?? t("unknownUser");
            const unread = preview.unreadCount > 0;
            return (
              <Pressable
                key={preview.chatId}
                style={styles.row}
                onPress={() => router.push(`/chat/${preview.otherUserId}` as never)}
              >
                {profile?.avatar ? (
                  <Image source={{ uri: profile.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarFallbackText}>
                      {displayName.charAt(0).toUpperCase() || "?"}
                    </Text>
                  </View>
                )}
                <View style={styles.rowBody}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.name} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={styles.when}>{formatRelativeDate(preview.lastMessageAt)}</Text>
                  </View>
                  <View style={styles.rowFooter}>
                    <Text
                      style={[styles.preview, unread && styles.previewUnread]}
                      numberOfLines={1}
                    >
                      {preview.lastMessage}
                    </Text>
                    {unread ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{preview.unreadCount}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: HERO_DARK,
    borderRadius: 32,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    lineHeight: 22,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: AMBER_MUTED,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: HERO_DARK_3,
    fontWeight: "800",
    fontSize: 20,
  },
  rowBody: {
    flex: 1,
    gap: 4,
    justifyContent: "center",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  rowFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_DARK,
    flex: 1,
  },
  when: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  preview: {
    color: MUTED_2,
    flex: 1,
    fontSize: 14,
  },
  previewUnread: {
    color: HERO_DARK,
    fontWeight: "700",
  },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: DANGER,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
});
