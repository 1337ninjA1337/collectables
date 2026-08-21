import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { HeroBanner } from "@/components/hero-banner";
import { EmptyState } from "@/components/empty-state";
import { SkeletonProfileList } from "@/components/skeleton";

import { RelationshipActionRow } from "@/components/relationship-action-row";
import { Screen } from "@/components/screen";
import { SwipeTabs } from "@/components/swipe-tabs";
import { useChat } from "@/lib/chat-context";
import { useI18n } from "@/lib/i18n-context";
import { ACTION_METHOD, type RelationshipActionId } from "@/lib/relationship-actions";
import { useSocial } from "@/lib/social-context";
import { ProfileRelationship, UserProfile } from "@/lib/types";
import { FONT_DISPLAY_BOLD, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import {
  AMBER_MUTED,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  DANGER,
  HERO_DARK_3,
  MUTED,
  MUTED_2,
  MUTED_10,
  PURE_WHITE,
  RADIUS_CARD,
  RADIUS_CARD_LG,
  TEXT_DARK,
} from "@/lib/design-tokens";

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
    getProfileById,
    ensureProfilesLoaded,
  } = useSocial();

  const [tab, setTab] = useState<Tab>("friends");
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const { unreadTotal } = useChat();

  useEffect(() => {
    let active = true;
    const ids = [...friends, ...incomingRequestUserIds];
    if (ids.length === 0) return;
    setLoadingFriends(true);
    ensureProfilesLoaded(ids)
      .catch(() => {})
      .finally(() => { if (active) setLoadingFriends(false); });
    return () => { active = false; };
  }, [friends, incomingRequestUserIds, ensureProfilesLoaded]);

  useEffect(() => {
    let active = true;
    if (following.length === 0) return;
    setLoadingFollowing(true);
    ensureProfilesLoaded(following)
      .catch(() => {})
      .finally(() => { if (active) setLoadingFollowing(false); });
    return () => { active = false; };
  }, [following, ensureProfilesLoaded]);

  const friendProfiles = friends
    .map((id) => getProfileById(id))
    .filter((p): p is UserProfile => p !== undefined);
  const requestProfiles = incomingRequestUserIds
    .map((id) => getProfileById(id))
    .filter((p): p is UserProfile => p !== undefined);
  const followingProfiles = following
    .map((id) => getProfileById(id))
    .filter((p): p is UserProfile => p !== undefined);

  /**
   * One intent → one context method, via `ACTION_METHOD`. Same switch the
   * other two surfaces run, and `chat` navigates here exactly as it does on
   * the profile screen — this screen is the one that had a chat button before
   * the table existed.
   */
  function runRelationshipAction(id: RelationshipActionId, profileId: string) {
    switch (ACTION_METHOD[id]) {
      case "chat":
        router.push(`/chat/${profileId}` as never);
        return;
      case "addFriend":
        void addFriend(profileId);
        return;
      case "removeFriend":
        void removeFriend(profileId);
        return;
      case "unfollowProfile":
        void unfollowProfile(profileId);
        return;
      case "followProfile":
        // No follow action reaches the friends screen — every list here is of
        // people the user already has an edge to. Throwing rather than
        // falling through is how a table edit that gave a tab a follow button
        // surfaces, instead of a button that does nothing.
        throw new Error("friends screen has no follow action");
    }
  }

  /**
   * The tab a profile is listed under, as a relationship.
   *
   * Read from the LIST rather than from `getRelationship`, and the difference
   * is load-bearing: `getRelationship` answers `friend` before it answers
   * `following`, so a friend the user also follows would render the friends
   * buttons on the following tab. The following tab is a tidying screen and
   * lists everyone in `following` — the tab is the question being asked, so
   * the tab is what decides.
   */
  const RELATIONSHIP_BY_TAB: Readonly<
    Record<"friend" | "following" | "request", ProfileRelationship>
  > = {
    friend: "friend",
    following: "following",
    request: "request_received",
  };

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
        <RelationshipActionRow
          relationship={RELATIONSHIP_BY_TAB[kind]}
          surface="tab"
          onAction={(id) => runRelationshipAction(id, profile.id)}
        />
      </View>
    );
  }

  return (
    <Screen>
      <HeroBanner
        tone="solid"
        eyebrow={t("community")}
        title={t("friendsTitle")}
        subtitle={t("friendsSubtitle")}
      />

      <Pressable

        style={styles.chatsLink}

        onPress={() => router.push("/chats")}

        accessibilityRole="button"

      >
        <View style={styles.chatsLinkIcon}>
          <Ionicons
            name="chatbubbles-outline"
            size={22}
            color={HERO_DARK_3}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          />
        </View>
        <View style={styles.chatsLinkBody}>
          <Text style={styles.chatsLinkTitle}>{t("chatsTitle")}</Text>
          <Text style={styles.chatsLinkSubtitle}>{t("chatsSubtitle")}</Text>
        </View>
        {unreadTotal > 0 ? (
          <View
            style={styles.chatsBadge}
            accessibilityLabel={t("navChatsUnreadA11y", { count: unreadTotal })}
          >
            <Text
              style={styles.chatsBadgeText}
              accessibilityElementsHidden
              importantForAccessibility="no"
              aria-hidden
            >
              {unreadTotal}
            </Text>
          </View>
        ) : (
          <Ionicons
            name="chevron-forward"
            size={20}
            color={MUTED}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          />
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
  tabPanel: {
    gap: 14,
  },
  chatsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: RADIUS_CARD,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chatsLinkIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  chatsLinkBody: {
    flex: 1,
    gap: 2,
  },
  chatsLinkTitle: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  chatsLinkSubtitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  chatsBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: DANGER,
    alignItems: "center",
    justifyContent: "center",
  },
  chatsBadgeText: {
    color: PURE_WHITE,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  sectionLabel: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  card: {
    borderRadius: 28,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
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
    borderRadius: RADIUS_CARD_LG,
    backgroundColor: AMBER_MUTED,
  },
  profileMeta: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_DISPLAY_BOLD,
  },
  username: {
    color: MUTED,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  bio: {
    color: MUTED_2,
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
});
