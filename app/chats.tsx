import { Stack, router } from "expo-router";
import { useEffect, useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { useChat } from "@/lib/chat-context";
import {
  AMBER_LIGHT,
  AMBER_MUTED,
  DANGER,
  HERO_DARK,
  HERO_DARK_3,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  SHADOW_SOFT,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { FONT_DISPLAY_EDITORIAL } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { useVisibilityRefresh } from "@/lib/use-visibility-refresh";

const CHATS_REFRESH_INTERVAL_MS = 15000;

export default function ChatsScreen() {
  const { t, formatChatPreviewTimestamp } = useI18n();
  const theme = useAppTheme();
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
                style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}
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
                    <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={[styles.when, { color: theme.meta }]}>{formatChatPreviewTimestamp(preview.lastMessageAt)}</Text>
                  </View>
                  <View style={styles.rowFooter}>
                    <Text
                      style={[styles.preview, { color: theme.muted }, unread && { color: theme.text, fontWeight: "700" }]}
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
    borderRadius: RADIUS_HERO_LG,
    padding: 24,
    gap: SPACING_LIST,
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
    fontFamily: FONT_DISPLAY_EDITORIAL,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    lineHeight: 22,
  },
  list: {
    gap: SPACING_LIST,
  },
  row: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: RADIUS_ITEM_AIRY,
    borderWidth: 1,
    ...SHADOW_SOFT,
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
    gap: SPACING_INLINE,
  },
  rowFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_INLINE,
  },
  name: {
    fontFamily: FONT_DISPLAY_EDITORIAL,
    fontSize: 16,
    fontWeight: "800",
    flex: 1,
  },
  when: {
    fontSize: 12,
    fontWeight: "700",
  },
  preview: {
    flex: 1,
    fontSize: 14,
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
