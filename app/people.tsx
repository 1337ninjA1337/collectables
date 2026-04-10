import { Link, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Screen } from "@/components/screen";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfiles, fetchProfileById } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";

const PAGE_SIZE = 25;

type MainTab = "discover" | "friends" | "following";
type FriendsSubTab = "my" | "requests";

export default function PeopleScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ tab?: string }>();
  const {
    getMyProfile,
    getRelationship,
    addFriend,
    followProfile,
    removeFriend,
    unfollowProfile,
    friends,
    following,
    incomingRequestUserIds,
  } = useSocial();

  const initialTab = (params.tab === "friends" || params.tab === "following") ? params.tab : "discover";
  const [mainTab, setMainTab] = useState<MainTab>(initialTab);
  const [friendsSubTab, setFriendsSubTab] = useState<FriendsSubTab>("my");

  // --- Discover tab state ---
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [remoteProfiles, setRemoteProfiles] = useState<UserProfile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // --- Friends tab state ---
  const [friendProfiles, setFriendProfiles] = useState<UserProfile[]>([]);
  const [requestProfiles, setRequestProfiles] = useState<UserProfile[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);

  // --- Following tab state ---
  const [followingProfiles, setFollowingProfiles] = useState<UserProfile[]>([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);

  const myProfile = getMyProfile();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Load discover page
  const loadPage = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const result = await fetchProfiles(pageNum, PAGE_SIZE);
      setRemoteProfiles(result.data);
      setTotalCount(result.totalCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === "discover") {
      void loadPage(page);
    }
  }, [page, loadPage, mainTab]);

  // Load friend/request profiles from Supabase
  useEffect(() => {
    if (mainTab !== "friends") return;

    setLoadingFriends(true);
    const ids = friendsSubTab === "my" ? friends : incomingRequestUserIds;

    if (ids.length === 0) {
      if (friendsSubTab === "my") setFriendProfiles([]);
      else setRequestProfiles([]);
      setLoadingFriends(false);
      return;
    }

    Promise.all(ids.map((id) => fetchProfileById(id)))
      .then((results) => {
        const valid = results.filter((p): p is UserProfile => p !== null);
        if (friendsSubTab === "my") setFriendProfiles(valid);
        else setRequestProfiles(valid);
      })
      .catch(() => {})
      .finally(() => setLoadingFriends(false));
  }, [mainTab, friendsSubTab, friends, incomingRequestUserIds]);

  // Load following profiles from Supabase
  useEffect(() => {
    if (mainTab !== "following") return;

    setLoadingFollowing(true);

    if (following.length === 0) {
      setFollowingProfiles([]);
      setLoadingFollowing(false);
      return;
    }

    Promise.all(following.map((id) => fetchProfileById(id)))
      .then((results) => {
        setFollowingProfiles(results.filter((p): p is UserProfile => p !== null));
      })
      .catch(() => {})
      .finally(() => setLoadingFollowing(false));
  }, [mainTab, following]);

  const others = useMemo(
    () => remoteProfiles.filter((p) => p.id !== myProfile?.id),
    [remoteProfiles, myProfile],
  );

  const filteredPeople = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return others;
    return others.filter((p) => p.username.toLowerCase().includes(normalized.replace(/^@/, "")));
  }, [others, query]);

  function renderProfileCard(profile: UserProfile) {
    const relationship = getRelationship(profile.id);
    return (
      <View key={profile.id} style={styles.card}>
        <Link href={`/profile/${profile.id}` as never} asChild>
          <Pressable style={styles.profileRow}>
            <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            <View style={styles.profileMeta}>
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.username}>@{profile.username}</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          </Pressable>
        </Link>

        <View style={styles.actions}>
          {relationship === "friend" ? (
            <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(profile.id)}>
              <Text style={styles.secondaryActionText}>{t("removeFriend")}</Text>
            </Pressable>
          ) : relationship === "request_sent" ? (
            <>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{t("requestSent")}</Text>
              </View>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(profile.id)}>
                <Text style={styles.secondaryActionText}>{t("cancelInvitation")}</Text>
              </Pressable>
            </>
          ) : relationship === "request_received" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(profile.id)}>
                <Text style={styles.primaryActionText}>{t("acceptRequest")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(profile.id)}>
                <Text style={styles.secondaryActionText}>{t("rejectRequest")}</Text>
              </Pressable>
            </>
          ) : relationship === "following" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(profile.id)}>
                <Text style={styles.primaryActionText}>{t("addFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void unfollowProfile(profile.id)}>
                <Text style={styles.secondaryActionText}>{t("unfollow")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(profile.id)}>
                <Text style={styles.primaryActionText}>{t("addFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void followProfile(profile.id)}>
                <Text style={styles.secondaryActionText}>{t("follow")}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("community")}</Text>
        <Text style={styles.title}>{t("peopleTitle")}</Text>
        <Text style={styles.subtitle}>{t("peopleSubtitle")}</Text>
      </View>

      {/* Main tabs */}
      <View style={styles.tabRow}>
        <Pressable
          style={{...styles.tab, ...(mainTab === "discover" ? styles.tabActive : {})}}
          onPress={() => setMainTab("discover")}
        >
          <Text style={{...styles.tabText, ...(mainTab === "discover" ? styles.tabTextActive : {})}}>
            {t("tabDiscover")}
          </Text>
        </Pressable>
        <Pressable
          style={{...styles.tab, ...(mainTab === "friends" ? styles.tabActive : {})}}
          onPress={() => setMainTab("friends")}
        >
          <Text style={{...styles.tabText, ...(mainTab === "friends" ? styles.tabTextActive : {})}}>
            {t("tabFriends")}
            {incomingRequestUserIds.length > 0 ? ` (${incomingRequestUserIds.length})` : ""}
          </Text>
        </Pressable>
        <Pressable
          style={{...styles.tab, ...(mainTab === "following" ? styles.tabActive : {})}}
          onPress={() => setMainTab("following")}
        >
          <Text style={{...styles.tabText, ...(mainTab === "following" ? styles.tabTextActive : {})}}>
            {t("tabFollowing")}
          </Text>
        </Pressable>
      </View>

      {mainTab === "discover" ? (
        <>
          <View style={styles.searchCard}>
            <Text style={styles.searchLabel}>{t("searchByProfileId")}</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("searchByProfileIdPlaceholder")}
              placeholderTextColor="#9b8571"
              autoCapitalize="none"
              style={styles.searchInput}
            />
          </View>

          {loading ? (
            <View style={styles.emptyCard}>
              <ActivityIndicator color="#d89c5b" size="large" />
              <Text style={styles.emptyText}>{t("loadingPeople")}</Text>
            </View>
          ) : filteredPeople.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t("noPeopleFound")}</Text>
            </View>
          ) : (
            filteredPeople.map(renderProfileCard)
          )}

          {!loading && totalPages > 1 && (
            <View style={styles.pagination}>
              <Pressable
                style={{...styles.pageButton, ...(page <= 1 ? styles.pageButtonDisabled : {})}}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <Text style={{...styles.pageButtonText, ...(page <= 1 ? styles.pageButtonTextDisabled : {})}}>
                  {t("prevPage")}
                </Text>
              </Pressable>
              <Text style={styles.pageInfo}>{t("pageOf", { page, total: totalPages })}</Text>
              <Pressable
                style={{...styles.pageButton, ...(page >= totalPages ? styles.pageButtonDisabled : {})}}
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <Text style={{...styles.pageButtonText, ...(page >= totalPages ? styles.pageButtonTextDisabled : {})}}>
                  {t("nextPage")}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      ) : mainTab === "friends" ? (
        <>
          {/* Friends sub-tabs */}
          <View style={styles.subTabRow}>
            <Pressable
              style={{...styles.subTab, ...(friendsSubTab === "my" ? styles.subTabActive : {})}}
              onPress={() => setFriendsSubTab("my")}
            >
              <Text style={{...styles.subTabText, ...(friendsSubTab === "my" ? styles.subTabTextActive : {})}}>
                {t("subTabMyFriends")}
              </Text>
            </Pressable>
            <Pressable
              style={{...styles.subTab, ...(friendsSubTab === "requests" ? styles.subTabActive : {})}}
              onPress={() => setFriendsSubTab("requests")}
            >
              <Text style={{...styles.subTabText, ...(friendsSubTab === "requests" ? styles.subTabTextActive : {})}}>
                {t("subTabRequests")}
                {incomingRequestUserIds.length > 0 ? ` (${incomingRequestUserIds.length})` : ""}
              </Text>
            </Pressable>
          </View>

          {loadingFriends ? (
            <View style={styles.emptyCard}>
              <ActivityIndicator color="#d89c5b" size="large" />
            </View>
          ) : friendsSubTab === "my" ? (
            friendProfiles.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>{t("noFriendsYetTab")}</Text>
              </View>
            ) : (
              friendProfiles.map(renderProfileCard)
            )
          ) : requestProfiles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t("noRequestsYet")}</Text>
            </View>
          ) : (
            requestProfiles.map(renderProfileCard)
          )}
        </>
      ) : (
        <>
          {loadingFollowing ? (
            <View style={styles.emptyCard}>
              <ActivityIndicator color="#d89c5b" size="large" />
            </View>
          ) : followingProfiles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t("noFollowingYet")}</Text>
            </View>
          ) : (
            followingProfiles.map(renderProfileCard)
          )}
        </>
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
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  tabActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  tabText: {
    color: "#5f4734",
    fontWeight: "800",
    fontSize: 15,
  },
  tabTextActive: {
    color: "#fff4e8",
  },
  subTabRow: {
    flexDirection: "row",
    gap: 8,
  },
  subTab: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  subTabActive: {
    backgroundColor: "#d89c5b",
    borderColor: "#d89c5b",
  },
  subTabText: {
    color: "#6b5543",
    fontWeight: "700",
    fontSize: 14,
  },
  subTabTextActive: {
    color: "#241912",
  },
  searchCard: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 10,
  },
  searchLabel: {
    color: "#624a35",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  searchInput: {
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#2f2318",
    fontSize: 15,
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
  statusBadge: {
    borderRadius: 999,
    backgroundColor: "#f0e2cf",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusBadgeText: {
    color: "#6b5543",
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    color: "#6b5647",
    lineHeight: 22,
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  pageButton: {
    borderRadius: 999,
    backgroundColor: "#261b14",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pageButtonDisabled: {
    backgroundColor: "#e4d5c4",
  },
  pageButtonText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  pageButtonTextDisabled: {
    color: "#a89480",
  },
  pageInfo: {
    color: "#5f4734",
    fontWeight: "700",
    fontSize: 14,
  },
});
