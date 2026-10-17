import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";
//
import { CostBadge } from "@/components/cost-badge";
import { EmptyState } from "@/components/empty-state";
import {
  SEARCH_RESULT_META_STYLE,
  SearchResultRow,
} from "@/components/search-result-row";
import { isLiveItem } from "@/lib/collections-helpers";
import { hasFiniteCost } from "@/lib/item-cost";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK,
  MUTED_2,
  MUTED_3,
  MUTED_10,
  MUTED_13,
  MUTED_15,
  PAGE_BG_2,
  PLACEHOLDER,
  RADIUS_CARD_LG,
  RADIUS_PILL,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { catalogueSearchNeedle, collectionMatchesSearch, itemMatchesSearch } from "@/lib/catalogue-search";
import { PROFILE_SEARCH_DEBOUNCE_MS } from "@/lib/debounce-helpers";
import {
  mergeProfileMatches,
  profileMatchesSearch,
  profileSearchNeedle,
} from "@/lib/profile-search";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useI18n } from "@/lib/i18n-context";
import { announceMessage } from "@/lib/announce";
import { searchAnnouncement, type SearchResultsState } from "@/lib/search-announcement";
import { fetchProfiles, searchProfiles } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";

type Props = {
  visible: boolean;
  onClose: () => void;
};

type FilterType = "all" | "collections" | "items" | "people";

export function SearchOverlay({ visible, onClose }: Props) {
  const { t } = useI18n();
  const { collections, items } = useCollections();
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setFilter("all");
    setOwnerFilter(null);
    fetchProfiles(1, 100)
      .then((r) => setProfiles(r.data))
      .catch(() => {});
  }, [visible]);

  const q = catalogueSearchNeedle(query);

  // Unique owners for the owner filter dropdown
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections) {
      if (c.ownerUserId && c.ownerName) {
        map.set(c.ownerUserId, c.ownerName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [collections]);

  const matchedCollections = useMemo(() => {
    if (!q || filter === "items" || filter === "people") return [];
    return collections
      .filter((c) => {
        // Shared with `app/create.tsx`'s collection picker: the two used to
        // be the same two lines written twice, so a third searchable field
        // would have reached one of them.
        const matchesQuery = collectionMatchesSearch(c, q);
        const matchesOwner = !ownerFilter || c.ownerUserId === ownerFilter;
        return matchesQuery && matchesOwner;
      })
      .slice(0, 20);
  }, [collections, q, filter, ownerFilter]);

  const matchedItems = useMemo(() => {
    if (!q || filter === "collections" || filter === "people") return [];
    return items
      .filter((item) => {
        // A want and a sold item are both things the collector does not have;
        // search answers "where is my …", so neither belongs in the results.
        // The rule is `isLiveItem` rather than two early returns because it is
        // the same rule the card counts and the collection totals use.
        if (!isLiveItem(item)) return false;
        const matchesQuery = itemMatchesSearch(item, q);
        const matchesOwner = !ownerFilter || item.createdByUserId === ownerFilter;
        return matchesQuery && matchesOwner;
      })
      .slice(0, 20);
  }, [items, q, filter, ownerFilter]);

  // Server-side people search: the 100-row snapshot fetched on open misses
  // any profile beyond it, so the query also hits the whole table (debounced).
  //
  // As on the people screen, the settle lags a cleared field by the debounce
  // window — harmless because `matchedProfiles` below returns `[]` while the
  // raw `q` is empty, so the stale matches are never rendered.
  const debouncedQuery = useDebouncedValue(q, PROFILE_SEARCH_DEBOUNCE_MS);
  const [remoteMatches, setRemoteMatches] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!debouncedQuery || filter === "collections" || filter === "items") {
      setRemoteMatches([]);
      return;
    }
    let cancelled = false;
    searchProfiles(debouncedQuery, 20)
      .then((results) => {
        if (!cancelled) setRemoteMatches(results);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, filter]);

  const matchedProfiles = useMemo(() => {
    if (!q || filter === "collections" || filter === "items") return [];
    // Shared with `app/people.tsx` and with the server's `or=` list: the page
    // the client holds and the rest of the table have to answer one question.
    const needle = profileSearchNeedle(q);
    const local = profiles.filter((p) => profileMatchesSearch(p, needle));
    // `remoteMatches` was fetched for `debouncedQuery` — what was typed a
    // debounce window ago — so it goes through the same predicate as the
    // local half. Without it, narrowing a query rendered server rows that
    // answer nothing on screen until the next round trip landed; with it, a
    // stale row that still answers is kept and one that does not goes away
    // with the keystroke.
    const remote = remoteMatches.filter((p) => profileMatchesSearch(p, needle));
    // Ordered before the slice, not after: a twenty-row cut off the front of
    // an unordered union can drop the exact match outright, which is a
    // stronger version of the bug the ordering fixes.
    return mergeProfileMatches(local, remote, needle).slice(0, 20);
  }, [profiles, q, filter, remoteMatches]);

  // Get collection name for an item
  function getCollectionName(collectionId: string): string {
    const c = collections.find((col) => col.id === collectionId);
    return c?.name ?? "";
  }

  function goToProfile(id: string) {
    setQuery("");
    onClose();
    router.push(`/profile/${id}` as never);
  }

  function goToCollection(id: string) {
    setQuery("");
    onClose();
    router.push(`/collection/${id}` as never);
  }

  function goToItem(id: string) {
    setQuery("");
    onClose();
    router.push(`/item/${id}` as never);
  }

  const totalResults =
    matchedProfiles.length + matchedCollections.length + matchedItems.length;

  // The count, out loud, when it changes.
  //
  // The three section headings are landmarks a screen-reader user can jump
  // between; nothing told them the lists underneath had changed. The rule for
  // what is worth saying lives in `lib/search-announcement.ts` — a repeat of
  // the number already spoken is silence, and an empty field forgets — and
  // what is SAID is the locale map's, because the noun agrees with the number
  // differently in six languages.
  //
  // A ref, not state: the memory must not cause a render, and a re-render is
  // what this effect is reacting to.
  const spokenResults = useRef<SearchResultsState | null>(null);
  useEffect(() => {
    // `debouncedQuery` lags the field, so this waits for typing to settle —
    // an announcement per keystroke interrupts the reader mid-word, which is
    // the failure this is supposed to prevent rather than cause.
    if (debouncedQuery !== q) return;
    const decision = searchAnnouncement({ query: q, total: totalResults }, spokenResults.current);
    spokenResults.current = decision.spoken;
    if (decision.speak) announceMessage(t("searchResultsAnnouncement", { count: totalResults }));
  }, [debouncedQuery, q, totalResults, t]);

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: t("searchFilterAll") },
    { key: "collections", label: t("searchFilterCollections") },
    { key: "items", label: t("searchFilterItems") },
    { key: "people", label: t("searchFilterPeople") },
  ];

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="none"
      >
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="none"
        >
          {/* Search input.

              Not `<SheetSearchRow>`: this row carries a trailing "close the
              overlay" button the shared component has no slot for, and its
              chrome is a size up (icon 20 vs 18, autoFocus). It does mirror
              the same accessibility contract by hand — every icon hidden on
              all three platforms (iOS + Android + web), every icon-only
              Pressable named. */}
          <View style={styles.inputRow}>
            <Ionicons
              name="search"
              size={20}
              color={MUTED_13}
              accessibilityElementsHidden
              importantForAccessibility="no"
              aria-hidden
            />
            <MaskedTextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityRole="search"
              accessibilityLabel={t("searchOverlayA11y")}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery("")}
                style={styles.clearBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("filterClearSearch")}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={MUTED_15}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  aria-hidden
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("searchClose")}
            >
              <Ionicons
                name="close"
                size={22}
                color={MUTED_13}
                accessibilityElementsHidden
                importantForAccessibility="no"
                aria-hidden
              />
            </Pressable>
          </View>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {filters.map((f) => (
              <Pressable
                key={f.key}
                style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f.key }}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filter === f.key && styles.filterChipTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Owner filter (only for collections/items) */}
          {filter !== "people" && owners.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ownerRow}
            >
              <Pressable
                style={[styles.ownerChip, !ownerFilter && styles.ownerChipActive]}
                onPress={() => setOwnerFilter(null)}
                accessibilityRole="button"
                accessibilityState={{ selected: !ownerFilter }}
              >
                <Text
                  style={[
                    styles.ownerChipText,
                    !ownerFilter && styles.ownerChipTextActive,
                  ]}
                >
                  {t("searchFilterAllOwners")}
                </Text>
              </Pressable>
              {owners.map((o) => (
                <Pressable
                  key={o.id}
                  style={[
                    styles.ownerChip,
                    ownerFilter === o.id && styles.ownerChipActive,
                  ]}
                  onPress={() => setOwnerFilter(ownerFilter === o.id ? null : o.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ownerFilter === o.id }}
                >
                  <Text
                    style={[
                      styles.ownerChipText,
                      ownerFilter === o.id && styles.ownerChipTextActive,
                    ]}
                  >
                    {o.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Results */}
          {q.length === 0 ? null : totalResults === 0 ? (
            <EmptyState
              icon="🔎"
              title={t("emptySearchTitle")}
              hint={t("emptySearchHint")}
              compact
            />
          ) : (
            <ScrollView
              style={styles.results}
              keyboardShouldPersistTaps="handled"
            >
              {matchedItems.length > 0 && (
                <>
                  {/* A header, not a label: three sections of results in one
                      scroll, and the rotor is how a screen-reader user skips
                      the twenty items to reach the two people. */}
                  <Text style={styles.sectionLabel} accessibilityRole="header">
                    {t("searchResultsItems")} ({matchedItems.length})
                  </Text>
                  {matchedItems.map((item) => (
                    <SearchResultRow
                      key={item.id}
                      photo={item.photos[0]}
                      fallbackEmoji="📷"
                      title={item.title}
                      meta={
                        <>
                          {getCollectionName(item.collectionId)}
                          {/*
                            `<CostBadge>` rather than `${item.cost}`, and
                            `hasFiniteCost` rather than a truthiness check.
                            The raw render printed a bare number with no
                            currency beside it — the same defect the export
                            round fixed in the PDF — hid a cost of zero,
                            which the shared gate holds is a price, and
                            printed `Infinity` for a non-finite one. The
                            badge converts, marks a conversion with `≈` and
                            renders nothing when there is no cost, so the
                            separator is the only thing left to decide here.
                          */}
                          {hasFiniteCost(item) ? (
                            <>
                              {" · "}
                              <CostBadge item={item} style={SEARCH_RESULT_META_STYLE} />
                            </>
                          ) : null}
                        </>
                      }
                      onPress={() => goToItem(item.id)}
                    />
                  ))}
                </>
              )}

              {matchedCollections.length > 0 && (
                <>
                  {/* A header, not a label: three sections of results in one
                      scroll, and the rotor is how a screen-reader user skips
                      the twenty items to reach the two people. */}
                  <Text style={styles.sectionLabel} accessibilityRole="header">
                    {t("searchResultsCollections")} ({matchedCollections.length})
                  </Text>
                  {matchedCollections.map((c) => (
                    <SearchResultRow
                      key={c.id}
                      photo={c.coverPhoto}
                      fallbackEmoji="📚"
                      title={c.name}
                      meta={c.ownerName}
                      onPress={() => goToCollection(c.id)}
                    />
                  ))}
                </>
              )}

              {matchedProfiles.length > 0 && (
                <>
                  {/* A header, not a label: three sections of results in one
                      scroll, and the rotor is how a screen-reader user skips
                      the twenty items to reach the two people. */}
                  <Text style={styles.sectionLabel} accessibilityRole="header">
                    {t("searchResultsPeople")} ({matchedProfiles.length})
                  </Text>
                  {matchedProfiles.map((p) => (
                    <SearchResultRow
                      key={p.id}
                      photo={p.avatar}
                      fallbackEmoji="👤"
                      avatar
                      title={p.displayName}
                      meta={`@${p.username}`}
                      onPress={() => goToProfile(p.id)}
                    />
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.55)",
    justifyContent: "flex-start",
    alignItems: "center",
    padding: 20,
    paddingTop: 72,
  },
  sheet: {
    backgroundColor: PAGE_BG_2,
    borderRadius: RADIUS_CARD_LG,
    padding: 16,
    maxHeight: "85%",
    maxWidth: 600,
    width: "100%",
    alignSelf: "center",
    gap: SPACING_LIST,
    shadowColor: HERO_DARK,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_LIST,
    backgroundColor: CARD_BG_3,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  input: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 16,
    fontWeight: "600",
  },
  clearBtn: {
    padding: 2,
  },
  closeBtn: {
    padding: 4,
  },
  filtersRow: {
    flexDirection: "row",
    gap: SPACING_INLINE,
    paddingVertical: 2,
  },
  filterChip: {
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  filterChipActive: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  filterChipText: {
    color: MUTED_3,
    fontWeight: "700",
    fontSize: 13,
  },
  filterChipTextActive: {
    color: TEXT_ON_DARK_4,
  },
  ownerRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
  },
  ownerChip: {
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  ownerChipActive: {
    backgroundColor: AMBER_ACCENT,
    borderColor: AMBER_ACCENT,
  },
  ownerChipText: {
    color: MUTED_2,
    fontWeight: "700",
    fontSize: 12,
  },
  ownerChipTextActive: {
    color: TEXT_ON_DARK_5,
  },
  results: {
    maxHeight: 440,
  },
  sectionLabel: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 6,
  },
});
