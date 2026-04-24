import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { EmptyState } from "@/components/empty-state";
import { SkeletonProfileList } from "@/components/skeleton";

import { Screen } from "@/components/screen";
import { SwipeTabs } from "@/components/swipe-tabs";
import { useChat } from "@/lib/chat-context";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfileById } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";

type Tab = "friends" | "following";

export default function FriendsScreen() {
  const { t } = useI18n();
  const {
    friends,
    following,
    incomingRequestUserIds,
    addFriend,
    removeFriend,
    unfollowProfile,
  } = useSocial();

  const [tab, setTab] = useState<Tab>("friends");
  const [friendProfiles, setFriendProfiles] = useState<UserProfile[]>([]);
  const [followingProfiles, setFollowingProfiles] = useState<UserProfile[]>([]);
  const [requestProfiles, setRequestProfiles] = useState<UserProfile[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const { unreadTotal } = useChat();

  useEffect(() => {
    let active = true;
    const ids = [...friends, ...incomingRequestUserIds];
    if (ids.length === 0) {
      setFriendProfiles([]);
      setRequestProfiles([]);
      return;
    }
    setLoadingFriends(true);
    Promise.all(ids.map((id) => fetchProfileById(id)))
      .then((rs) => {
        if (!active) return;
        const valid = rs.filter((p): p is UserProfile => p !== null);
        setFriendProfiles(valid.filter((p) => friends.includes(p.id)));
        setRequestProfiles(valid.filter((p) => incomingRequestUserIds.includes(p.id)));
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingFriends(false); });
    return () => { active = false; };
  }, [friends, incomingRequestUserIds]);

  useEffect(() => {
    let active = true;
    if (following.length === 0) {
      setFollowingProfiles([]);
      return;
    }
    setLoadingFollowing(true);
    Promise.all(following.map((id) => fetchProfileById(id)))
      .then((rs) => {
        if (active) setFollowingProfiles(rs.filter((p): p is UserProfile => p !== null));
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingFollowing(false); });
    return () => { active = false; };
  }, [following]);

  function renderProfileCard(profile: UserProfile, kind: "friend" | "following" | "request") {
    return (
      <View key={profile.id} style={styles.card}>
        <Link href={`/profile/${profile.id}` as never} asChild>
          <Pressable style={styles.profileRow}>
            {profile.avatar ? (
              <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatar} />
            )}
            <View style={styles.profileMeta}>
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.username}>@{profile.username}</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          </Pressable>
        </Link>
        <View style={styles.actions}>
          {kind === "request" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(profile.id)}>
                <Text style={styles.primaryActionText}>{t("acceptRequest")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(profile.id)}>
                <Text style={styles.secondaryActionText}>{t("rejectRequest")}</Text>
              </Pressable>
            </>
          ) : kind === "friend" ? (
            <>
              <Pressable
                style={styles.primaryAction}
                onPress={() => router.push(`/chat/${profile.id}` as never)}
              >
                <Text style={styles.primaryActionText}>{t("chatSend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(profile.id)}>
                <Text style={styles.secondaryActionText}>{t("removeFriend")}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.secondaryAction} onPress={() => void unfollowProfile(profile.id)}>
              <Text style={styles.secondaryActionText}>{t("unfollow")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("community")}</Text>
        <Text style={styles.title}>{t("friendsTitle")}</Text>
        <Text style={styles.subtitle}>{t("friendsSubtitle")}</Text>
      </View>

      <Pressable style={styles.chatsLink} onPress={() => router.push("/chats")}>
        <View style={styles.chatsLinkIcon}>
          <Ionicons name="chatbubbles-outline" size={22} color="#3a2716" />
        </View>
        <View style={styles.chatsLinkBody}>
          <Text style={styles.chatsLinkTitle}>{t("chatsTitle")}</Text>
          <Text style={styles.chatsLinkSubtitle}>{t("chatsSubtitle")}</Text>
        </View>
        {unreadTotal > 0 ? (
          <View style={styles.chatsBadge}>
            <Text style={styles.chatsBadgeText}>{unreadTotal}</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={20} color="#8f6947" />
        )}
      </Pressable>

      <SwipeTabs
        tabs={[
          {
            key: "friends",
            label: `${t("tabFriends")}${incomingRequestUserIds.length > 0 ? ` (${incomingRequestUserIds.length})` : ""}`,
          },
          { key: "following", label: t("tabFollowing") },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        dotHighlight={incomingRequestUserIds.length > 0 ? "friends" : undefined}
        renderTab={(key) => {
          if (key === "friends") {
            return (
              <View style={styles.tabPanel}>
                {loadingFriends && friendProfiles.length === 0 && requestProfiles.length === 0 ? (
                  <SkeletonProfileList count={3} />
                ) : (
                  <>
                    {requestProfiles.length > 0 && (
                      <>
                        <Text style={styles.sectionLabel}>{t("subTabRequests")}</Text>
                        {requestProfiles.map((p) => renderProfileCard(p, "request"))}
                      </>
                    )}
                    {friendProfiles.length > 0 ? (
                      <>
                        <Text style={styles.sectionLabel}>{t("subTabMyFriends")}</Text>
                        {friendProfiles.map((p) => renderProfileCard(p, "friend"))}
                      </>
                    ) : requestProfiles.length === 0 ? (
                      <EmptyState
                        icon="👋"
                        title={t("emptyFriendsTabTitle")}
                        hint={t("emptyFriendsTabHint")}
                        actionLabel={t("emptyFriendCollectionsCta")}
                        onAction={() => router.push("/people")}
                      />
                    ) : null}
                  </>
                )}
              </View>
            );
          }
          return (
            <View style={styles.tabPanel}>
              {loadingFollowing && followingProfiles.length === 0 ? (
                <SkeletonProfileList count={3} />
              ) : followingProfiles.length === 0 ? (
                <EmptyState
                  icon="🔍"
                  title={t("emptyFollowingTabTitle")}
                  hint={t("emptyFollowingTabHint")}
                  actionLabel={t("emptySubscribedCta")}
                  onAction={() => router.push("/people")}
                />
              ) : (
                followingProfiles.map((p) => renderProfileCard(p, "following"))
              )}
            </View>
          );
        }}
      />
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
  tabPanel: {
    gap: 14,
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
  chatsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  chatsLinkIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#eadbc8",
    alignItems: "center",
    justifyContent: "center",
  },
  chatsLinkBody: {
    flex: 1,
    gap: 2,
  },
  chatsLinkTitle: {
    color: "#2f2318",
    fontSize: 15,
    fontWeight: "800",
  },
  chatsLinkSubtitle: {
    color: "#8f6947",
    fontSize: 12,
    fontWeight: "600",
  },
  chatsBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#d92f2f",
    alignItems: "center",
    justifyContent: "center",
  },
  chatsBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
  sectionLabel: {
    color: "#624a35",
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  card: {
    borderRadius: 28,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 16,
  },
  profileRow: {
    flexDirection: "row",
    gap: 14,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: "#d9c2a8",
  },
  profileMeta: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2f2318",
  },
  username: {
    color: "#8f6947",
    fontWeight: "700",
  },
  bio: {
    color: "#6b5647",
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryAction: {
    borderRadius: 999,
    backgroundColor: "#261b14",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  secondaryAction: {
    borderRadius: 999,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryActionText: {
    color: "#2a1d15",
    fontWeight: "800",
  },
});
