import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";
//
import { EmptyState } from "@/components/empty-state";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_MUTED,
  AMBER_SOFT,
  BORDER,
  BORDER_3,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_10,
  MUTED_13,
  MUTED_15,
  PAGE_BG_2,
  PLACEHOLDER,
  RADIUS_CARD,
  RADIUS_CARD_LG,
  RADIUS_PILL,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
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

  const q = query.trim().toLowerCase();

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
        const matchesQuery =
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q);
        const matchesOwner = !ownerFilter || c.ownerUserId === ownerFilter;
        return matchesQuery && matchesOwner;
      })
      .slice(0, 20);
  }, [collections, q, filter, ownerFilter]);

  const matchedItems = useMemo(() => {
    if (!q || filter === "collections" || filter === "people") return [];
    return items
      .filter((item) => {
        if (item.isWishlist) return false;
        if (item.archivedAt) return false;
        const matchesQuery =
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.acquiredFrom.toLowerCase().includes(q);
        const matchesOwner = !ownerFilter || item.createdByUserId === ownerFilter;
        return matchesQuery && matchesOwner;
      })
      .slice(0, 20);
  }, [items, q, filter, ownerFilter]);

  // Server-side people search: the 100-row snapshot fetched on open misses
  // any profile beyond it, so the query also hits the whole table (debounced).
  const [remoteMatches, setRemoteMatches] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!q || filter === "collections" || filter === "items") {
      setRemoteMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProfiles(q, 20)
        .then((results) => {
          if (!cancelled) setRemoteMatches(results);
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, filter]);

  const matchedProfiles = useMemo(() => {
    if (!q || filter === "collections" || filter === "items") return [];
    const needle = q.replace(/^@/, "");
    const local = profiles.filter(
      (p) =>
        p.username.toLowerCase().includes(needle) ||
        p.displayName.toLowerCase().includes(needle),
    );
    const seen = new Set(local.map((p) => p.id));
    const merged = [...local, ...remoteMatches.filter((p) => !seen.has(p.id))];
    return merged.slice(0, 20);
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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Search input */}
          <View style={styles.inputRow}>
            <Ionicons name="search" size={20} color={MUTED_13} />
            <MaskedTextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} style={styles.clearBtn} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={MUTED_15} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color={MUTED_13} />
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
                  <Text style={styles.sectionLabel}>
                    {t("searchResultsItems")} ({matchedItems.length})
                  </Text>
                  {matchedItems.map((item) => (
                    <Pressable
                      key={item.id}
                      style={styles.row}
                      onPress={() => goToItem(item.id)}
                    >
                      <View style={styles.rowContent}>
                        {item.photos.length > 0 ? (
                          <Image
                            source={{ uri: item.photos[0] }}
                            style={styles.rowThumb}
                          />
                        ) : (
                          <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
                            <Text style={styles.rowThumbEmoji}>📷</Text>
                          </View>
                        )}
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {getCollectionName(item.collectionId)}
                            {item.cost ? ` · ${item.cost}` : ""}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </>
              )}

              {matchedCollections.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>
                    {t("searchResultsCollections")} ({matchedCollections.length})
                  </Text>
                  {matchedCollections.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.row}
                      onPress={() => goToCollection(c.id)}
                    >
                      <View style={styles.rowContent}>
                        {c.coverPhoto ? (
                          <Image
                            source={{ uri: c.coverPhoto }}
                            style={styles.rowThumb}
                          />
                        ) : (
                          <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
                            <Text style={styles.rowThumbEmoji}>📚</Text>
                          </View>
                        )}
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {c.ownerName}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </>
              )}

              {matchedProfiles.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>
                    {t("searchResultsPeople")} ({matchedProfiles.length})
                  </Text>
                  {matchedProfiles.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.row}
                      onPress={() => goToProfile(p.id)}
                    >
                      <View style={styles.rowContent}>
                        {p.avatar ? (
                          <Image
                            source={{ uri: p.avatar }}
                            style={styles.rowAvatar}
                          />
                        ) : (
                          <View style={[styles.rowAvatar, styles.rowAvatarEmpty]}>
                            <Text style={styles.rowThumbEmoji}>👤</Text>
                          </View>
                        )}
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {p.displayName}
                          </Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            @{p.username}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
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
    shadowColor: "#000",
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
  row: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_3,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_CARD,
  },
  rowThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: BORDER,
  },
  rowThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  rowThumbEmoji: {
    fontSize: 18,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: RADIUS_CARD,
    backgroundColor: AMBER_MUTED,
  },
  rowAvatarEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
  },
  rowMeta: {
    color: MUTED,
    fontSize: 13,
  },
});
