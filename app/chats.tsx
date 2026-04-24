import { Stack, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { useChat } from "@/lib/chat-context";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfileById } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";

function formatWhen(isoDate: string, locale: string | undefined): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  try {
    if (sameDay) {
      return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export default function ChatsScreen() {
  const { t, language } = useI18n();
  const { previews } = useChat();
  const { getProfileById, friends } = useSocial();
  const [remoteProfiles, setRemoteProfiles] = useState<Record<string, UserProfile>>({});

  const otherIds = useMemo(() => previews.map((p) => p.otherUserId), [previews]);

  useEffect(() => {
    let active = true;
    const missing = otherIds.filter((id) => !getProfileById(id) && !remoteProfiles[id]);
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => fetchProfileById(id)))
      .then((results) => {
        if (!active) return;
        const next: Record<string, UserProfile> = {};
        results.forEach((p) => {
          if (p) next[p.id] = p;
        });
        if (Object.keys(next).length > 0) {
          setRemoteProfiles((prev) => ({ ...prev, ...next }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [otherIds, getProfileById, remoteProfiles]);

  function resolveProfile(id: string): UserProfile | undefined {
    return getProfileById(id) ?? remoteProfiles[id];
  }

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
            const profile = resolveProfile(preview.otherUserId);
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
                    <Text style={styles.when}>{formatWhen(preview.lastMessageAt, language)}</Text>
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
    backgroundColor: "#261b14",
    borderRadius: 32,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: "#f5c99a",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  title: {
    color: "#fff8ef",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: "#ead8c3",
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
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "#d9c2a8",
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: "#3a2716",
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
    color: "#2f2318",
    flex: 1,
  },
  when: {
    color: "#8f6947",
    fontSize: 12,
    fontWeight: "700",
  },
  preview: {
    color: "#6b5647",
    flex: 1,
    fontSize: 14,
  },
  previewUnread: {
    color: "#261b14",
    fontWeight: "700",
  },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "#d92f2f",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
});
