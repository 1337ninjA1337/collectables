import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { SkeletonProfileList } from "@/components/skeleton";
import { useAppTheme } from "@/components/use-app-theme";
import {
  AMBER_LIGHT,
  AMBER_MUTED,
  AMBER_SOFT,
  BORDER,
  BORDER_2,
  BORDER_4,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK,
  HERO_DARK_2,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_8,
  MUTED_10,
  MUTED_16,
  PLACEHOLDER,
  PURE_WHITE,
  RADIUS_HERO_LG,
  RADIUS_CARD_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  TEXT_DARK,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfiles, searchProfiles } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

const PAGE_SIZE = 25;

export default function PeopleScreen() {
  const { t } = useI18n();
  const theme = useAppTheme();
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
  const [refreshing, setRefreshing] = useState(false);

  const myProfile = getMyProfile();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const loadPage = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const result = await fetchProfiles(pageNum, PAGE_SIZE);
      setRemoteProfiles(result.data);
      setTotalCount(result.totalCount);
    } catch {
      // Network/auth failure: keep whatever page is already shown instead of
      // leaving the list stuck on the skeleton via an unhandled rejection.
    } finally {
      setLoading(false);
    }
  }, []);

  // Server-side search: the loaded page only holds PAGE_SIZE profiles, so
  // filtering it client-side made anyone beyond the current page unfindable.
  // Debounced ilike query against the whole profiles table.
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProfiles(normalized, 50)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    void loadPage(page);
  }, [page, loadPage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadPage(page); } finally { setRefreshing(false); }
  }, [loadPage, page]);

  const others = useMemo(
    () => remoteProfiles.filter((p) => p.id !== myProfile?.id),
    [remoteProfiles, myProfile],
  );
 //
  const filteredPeople = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return others;
    const needle = normalized.replace(/^@/, "");
    // Instant pass over the already-loaded page, unioned with the (debounced)
    // server-wide results so matches beyond the current page appear too.
    const local = others.filter(
      (p) =>
        p.username.toLowerCase().includes(needle) ||
        p.displayName.toLowerCase().includes(needle),
    );
    const seen = new Set(local.map((p) => p.id));
    const remote = searchResults.filter(
      (p) => p.id !== myProfile?.id && !seen.has(p.id),
    );
    return [...local, ...remote];
  }, [others, query, searchResults, myProfile]);

  function renderProfileCard(profile: UserProfile) {
    const relationship = getRelationship(profile.id);
    return (
      <View key={profile.id} style={{ ...styles.card, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        <Link href={`/profile/${profile.id}` as never} asChild>
          <Pressable style={styles.profileRow}>
            {profile.avatar ? (
              <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatar} />
            )}
            <View style={styles.profileMeta}>
              <Text style={{ ...styles.name, color: theme.text }}>{profile.displayName}</Text>
              <Text style={{ ...styles.username, color: theme.meta }}>@{profile.username}</Text>
              <Text style={{ ...styles.bio, color: theme.muted }}>{profile.bio}</Text>
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
    <Screen refreshing={refreshing} onRefresh={handleRefresh}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("community")}</Text>
        <Text style={styles.title}>{t("searchTitle")}</Text>
        <Text style={styles.subtitle}>{t("searchSubtitle")}</Text>
      </View>

      <View style={{ ...styles.searchCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        <Text style={{ ...styles.searchLabel, color: theme.meta }}>{t("searchByProfileId")}</Text>
        <MaskedTextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("searchByProfileIdPlaceholder")}
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="none"
          style={{ ...styles.searchInput, backgroundColor: theme.page, borderColor: theme.border, color: theme.text }}
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
          <Text style={{ ...styles.pageInfo, color: theme.meta }}>{t("pageOf", { page, total: totalPages })}</Text>
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
    backgroundColor: HERO_DARK,
    borderRadius: RADIUS_HERO_LG,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  searchCard: {
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: 10,
  },
  searchLabel: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  searchInput: {
    borderRadius: 20,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: TEXT_DARK,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  card: {
    borderRadius: RADIUS_ITEM_AIRY,
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
    fontFamily: FONT_DISPLAY_EDITORIAL,
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
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  secondaryAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryActionText: {
    color: HERO_DARK_2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  statusBadge: {
    borderRadius: RADIUS_PILL,
    backgroundColor: BORDER_2,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusBadgeText: {
    color: MUTED_8,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  pageButton: {
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pageButtonDisabled: {
    backgroundColor: BORDER_4,
  },
  pageButtonText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  pageButtonTextDisabled: {
    color: MUTED_16,
  },
  pageInfo: {
    color: MUTED_3,
    fontWeight: "700",
    fontSize: 14,
    fontFamily: FONT_BODY_BOLD,
  },
});
