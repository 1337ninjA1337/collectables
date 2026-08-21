import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { HeroBanner } from "@/components/hero-banner";
import { MaskedTextInput } from "@/components/masked-text-input";

import { EmptyState } from "@/components/empty-state";
import { RelationshipActionRow } from "@/components/relationship-action-row";
import { Screen } from "@/components/screen";
import { SkeletonProfileList } from "@/components/skeleton";
import { useAppTheme } from "@/components/use-app-theme";
import {
  AMBER_MUTED,
  BORDER,
  BORDER_4,
  CARD_BG,
  HERO_DARK,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_10,
  MUTED_16,
  PLACEHOLDER,
  PURE_WHITE,
  RADIUS_CARD_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { PROFILE_SEARCH_DEBOUNCE_MS } from "@/lib/debounce-helpers";
import { ACTION_METHOD, type RelationshipActionId } from "@/lib/relationship-actions";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfiles, searchProfiles } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useMinimumVisible } from "@/lib/use-minimum-visible";

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
  //
  // Clearing the field does NOT clear `searchResults` until the debounce
  // settles, which is invisible: `filteredPeople` below returns `others`
  // untouched while the raw `query` is empty, so the stale remote matches are
  // never read during that window.
  const debouncedQuery = useDebouncedValue(query.trim(), PROFILE_SEARCH_DEBOUNCE_MS);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    searchProfiles(debouncedQuery, 50)
      .then((results) => {
        if (!cancelled) setSearchResults(results);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    void loadPage(page);
  }, [page, loadPage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadPage(page); } finally { setRefreshing(false); }
  }, [loadPage, page]);

  // Keeps the pull-to-refresh spinner legible when refresh() resolves from
  // cache — see lib/minimum-visible-helpers.ts for why this is a trailing
  // hold and not a leading debounce.
  const showRefreshing = useMinimumVisible(refreshing);

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

  /**
   * One intent → one context method, via `ACTION_METHOD`. The switch is
   * exhaustive over the method names rather than over the eight intents, so
   * adding a ninth intent that reuses an existing method needs no change here.
   */
  function runRelationshipAction(id: RelationshipActionId, profileId: string) {
    switch (ACTION_METHOD[id]) {
      case "addFriend":
        void addFriend(profileId);
        return;
      case "removeFriend":
        void removeFriend(profileId);
        return;
      case "followProfile":
        void followProfile(profileId);
        return;
      case "unfollowProfile":
        void unfollowProfile(profileId);
        return;
      case "chat":
        // No chat action reaches the people list — `chat` is detail-only in
        // the table. Falling through silently would hide a table edit that
        // gave a row a button this screen cannot service.
        throw new Error("people list has no chat action");
    }
  }

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

        <RelationshipActionRow
          relationship={relationship}
          surface="row"
          onAction={(id) => runRelationshipAction(id, profile.id)}
        />
      </View>
    );
  }

  return (
    <Screen refreshing={showRefreshing} onRefresh={handleRefresh}>
      <HeroBanner
        tone="solid"
        eyebrow={t("community")}
        title={t("searchTitle")}
        subtitle={t("searchSubtitle")}
      />

      <View style={{ ...styles.searchCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        <Text style={{ ...styles.searchLabel, color: theme.meta }}>{t("searchByProfileId")}</Text>
        <MaskedTextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("searchByProfileIdPlaceholder")}
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="none"
          style={{ ...styles.searchInput, backgroundColor: theme.page, borderColor: theme.border, color: theme.text }}
          // The visible <Text> above is a sibling, not a bound label — RN has
          // no htmlFor, so without this the field announces as "edit text".
          accessibilityRole="search"
          accessibilityLabel={t("searchByProfileId")}
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
            accessibilityState={{ disabled: page <= 1 }}
            accessibilityRole="button"
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
            accessibilityState={{ disabled: page >= totalPages }}
            accessibilityRole="button"
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
  searchCard: {
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: SPACING_LIST,
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
