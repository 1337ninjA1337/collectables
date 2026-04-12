import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { SkeletonProfileList } from "@/components/skeleton";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfiles } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";

const PAGE_SIZE = 25;

export default function PeopleScreen() {
  const { t } = useI18n();
  const {
    getMyProfile,
    getRelationship,
    addFriend,
    followProfile,
    removeFriend,
    unfollowProfile,
  } = useSocial();

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [remoteProfiles, setRemoteProfiles] = useState<UserProfile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const myProfile = getMyProfile();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

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
    void loadPage(page);
  }, [page, loadPage]);

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
        <Text style={styles.title}>{t("searchTitle")}</Text>
        <Text style={styles.subtitle}>{t("searchSubtitle")}</Text>
      </View>

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
        <SkeletonProfileList count={4} />
      ) : filteredPeople.length === 0 ? (
        <EmptyState
          icon="🔎"
          title={t("emptyPeopleTitle")}
          hint={t("emptyPeopleHint")}
        />
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
