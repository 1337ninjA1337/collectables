import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { captureException } from "@/lib/sentry";
import {
  profileSearchNeedle,
  profileSearchUnion,
} from "@/lib/profile-search";
import { ACTION_METHOD, type RelationshipActionId } from "@/lib/relationship-actions";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfiles, searchProfiles } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useMinimumVisible } from "@/lib/use-minimum-visible";

const PAGE_SIZE = 25;

/**
 * How many server-wide matches the search asks for.
 *
 * Twice `PAGE_SIZE`, and the reason is the union it feeds: `filteredPeople`
 * folds the loaded page into these rows and renders EVERY row of the result,
 * so this number is the only cap on how much of the table a search can reach
 * — not a slice the way `components/search-overlay.tsx`' `SECTION_LIMIT` is.
 * The sheet's 20 is a display cut that doubles as its request size; this is a
 * request size with no cut behind it, which is why the two are different
 * numbers rather than one shared constant. It was a bare `50` until
 * 2026-10-19.
 */
const SEARCH_RESULT_LIMIT = 50;

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

  // The id of the most recent page request. Two taps on Next fire two
  // `fetchProfiles` calls and the SLOWER one used to win: whichever response
  // landed last wrote `remoteProfiles`, so the list could settle on page 2
  // while the pager read "Page 3 of 12" and nothing would correct it until the
  // next tap. The search effect three blocks down has carried a `cancelled`
  // flag for exactly this since it was written; the pager never did.
  //
  // A monotonic token rather than a per-call `cancelled` boolean, because
  // `handleRefresh` calls `loadPage` too and a refresh must also lose to a
  // page change started after it.
  const pageRequestRef = useRef(0);

  const loadPage = useCallback(async (pageNum: number) => {
    const request = pageRequestRef.current + 1;
    pageRequestRef.current = request;
    setLoading(true);
    try {
      const result = await fetchProfiles(pageNum, PAGE_SIZE);
      if (request !== pageRequestRef.current) return;
      setRemoteProfiles(result.data);
      setTotalCount(result.totalCount);
    } catch {
      // Network/auth failure: keep whatever page is already shown instead of
      // leaving the list stuck on the skeleton via an unhandled rejection.
    } finally {
      // Only the newest request may stop the skeleton: an older one finishing
      // afterwards would show the list as settled while a page is still in
      // flight.
      if (request === pageRequestRef.current) setLoading(false);
    }
  }, []);

  /**
   * What somebody typed, reduced to what can be matched — once.
   *
   * `profileSearchNeedle` was called twice in this screen and `query.trim()`
   * twice more, which is four reductions of one input and three spellings of
   * "is a search active". They agree on ordinary text and not on a query of
   * only metacharacters: `"%"` trims to `"%"` and reduces to `""`, so the
   * trimmed reading calls that a search with no matches and the needle calls
   * it no search at all. The needle is the one `filteredPeople` compares
   * with, so it is the one the empty state and the pager have to agree with.
   *
   * `query.trim()` survives in ONE place below — what `useDebouncedValue`
   * holds, which is what `searchProfiles` is asked for and what
   * `use-debounced-value.test.ts` pins. `searchSettling` compares against it
   * for that reason: the question there is whether the debounce has caught up
   * with the field, and the debounce holds the trimmed string.
   */
  const needle = useMemo(() => profileSearchNeedle(query), [query]);

  /** A query is active, so the list is search results rather than a page. */
  const searching = needle.length > 0;

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
  const [searchInFlight, setSearchInFlight] = useState(false);
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults([]);
      setSearchInFlight(false);
      return;
    }
    let cancelled = false;
    setSearchInFlight(true);
    searchProfiles(debouncedQuery, SEARCH_RESULT_LIMIT)
      .then((results) => {
        if (!cancelled) setSearchResults(results);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSearchInFlight(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  /**
   * The search has been asked for and has not answered yet.
   *
   * Two windows, and the first is the one with no request in it at all: the
   * debounce means `debouncedQuery` lags what is typed, so for
   * `PROFILE_SEARCH_DEBOUNCE_MS` after a keystroke nothing has been sent.
   * Then the round trip.
   *
   * It exists because the empty state was shown through both. Typing a profile
   * ID that only the server knows about matched nothing on the loaded page, so
   * "no people found" rendered for the debounce plus a round trip and then
   * flipped to the answer — under a field whose whole purpose is finding
   * somebody who is NOT on this page. `loading` could not cover it: that flag
   * is about `fetchProfiles`, which is not running.
   */
  const searchSettling = searching && (debouncedQuery !== query.trim() || searchInFlight);

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
    if (!searching) return others;
    // The loaded page and the (debounced) server-wide results as one list,
    // through `profileSearchUnion`: it filters BOTH halves with the predicate
    // the overlay and the server's `or=` list are derived from, dedupes by id
    // and orders by how well each row answers — a handle or profile ID that
    // IS what was typed, then an exact display name (which two people can
    // share), then a prefix, then a substring, stable within each band so a
    // row already on screen leads among equally good matches.
    //
    // Everything in that sentence was once this screen's own code and one
    // half of it was wrong twice: the union was a bare spread (a page-one
    // substring match above the exact row only the server knew about) and the
    // remote half went unfiltered (`searchResults` answers `debouncedQuery`,
    // so narrowing "ann" to "annz" rendered rows that answer nothing on
    // screen until the next round trip landed). Only "not me" is left here,
    // which is genuinely this screen's rule.
    return profileSearchUnion(
      others,
      searchResults.filter((p) => p.id !== myProfile?.id),
      needle,
    );
  }, [others, needle, searching, searchResults, myProfile]);

  /**
   * One intent → one context method, via `ACTION_METHOD`. The switch is
   * exhaustive over the method names rather than over the eight intents, so
   * adding a ninth intent that reuses an existing method needs no change here.
   */
  function runRelationshipAction(action: RelationshipActionId, profileId: string) {
    switch (ACTION_METHOD[action]) {
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
        // gave a row a button this screen cannot service, which is why this
        // throws rather than returns.
        //
        // Reported first, because the throw is a tripwire for a DEVELOPER and
        // it fires inside an `onAction` during a press: in dev it surfaces
        // loudly, and in production it takes the screen down with nothing
        // recorded anywhere. `captureException` means the table edit that
        // caused it is findable either way.
        captureException(new Error("people list has no chat action"), {
          scope: "people.runRelationshipAction",
          extra: { action },
        });
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

      {/*
        Rows win over the skeleton, and the skeleton wins over the empty state.
        The order is the point: a keystroke that narrows a search must not
        replace rows that still answer with a skeleton (that is the
        responsiveness `profileSearchUnion` keeps stale-but-matching rows
        for), and "no people found" must not be shown while the search that
        would find them is still in the air.
      */}
      {loading ? (
        <SkeletonProfileList count={4} />
      ) : filteredPeople.length > 0 ? (
        filteredPeople.map(renderProfileCard)
      ) : searchSettling ? (
        <SkeletonProfileList count={4} />
      ) : (
        <EmptyState
          icon="🔎"
          title={t("emptyPeopleTitle")}
          hint={t("emptyPeopleHint")}
        />
      )}

      {/*
        No pager while a search is active. `totalPages` comes from
        `totalCount`, which is every profile in the table and not the rows a
        search answered — so a query matching three people rendered three
        cards under "Page 1 of 12", and Next fetched page 2 of the UNFILTERED
        table, replacing `others` and changing the result list underneath the
        user for a reason the label does not describe. The search already
        reaches the whole table through `searchProfiles`, so there is nothing
        for a pager to do while one is running.
      */}
      {!loading && !searching && totalPages > 1 && (
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
