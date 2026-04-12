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
  TextInput,
  View,
} from "react-native";

import { EmptyState } from "@/components/empty-state";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { fetchProfiles } from "@/lib/supabase-profiles";
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
        const matchesQuery =
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.acquiredFrom.toLowerCase().includes(q);
        const matchesOwner = !ownerFilter || item.createdByUserId === ownerFilter;
        return matchesQuery && matchesOwner;
      })
      .slice(0, 20);
  }, [items, q, filter, ownerFilter]);

  const matchedProfiles = useMemo(() => {
    if (!q || filter === "collections" || filter === "items") return [];
    const needle = q.replace(/^@/, "");
    return profiles
      .filter(
        (p) =>
          p.username.toLowerCase().includes(needle) ||
          p.displayName.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }, [profiles, q, filter]);

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
            <Ionicons name="search" size={20} color="#8a6e54" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor="#9b8571"
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} style={styles.clearBtn} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#b8a08a" />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color="#8a6e54" />
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
    padding: 20,
    paddingTop: 72,
  },
  sheet: {
    backgroundColor: "#fffaf4",
    borderRadius: 24,
    padding: 16,
    maxHeight: "85%",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff1df",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  input: {
    flex: 1,
    color: "#2f2318",
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
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  filterChipActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  filterChipText: {
    color: "#5f4734",
    fontWeight: "700",
    fontSize: 13,
  },
  filterChipTextActive: {
    color: "#fff4e8",
  },
  ownerRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
  },
  ownerChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  ownerChipActive: {
    backgroundColor: "#d89c5b",
    borderColor: "#d89c5b",
  },
  ownerChipText: {
    color: "#6b5647",
    fontWeight: "700",
    fontSize: 12,
  },
  ownerChipTextActive: {
    color: "#fff7ea",
  },
  results: {
    maxHeight: 440,
  },
  sectionLabel: {
    color: "#624a35",
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
    borderBottomColor: "#f0e4d0",
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#eadbc8",
  },
  rowThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  rowThumbEmoji: {
    fontSize: 18,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#d9c2a8",
  },
  rowAvatarEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: "#2f2318",
    fontSize: 15,
    fontWeight: "700",
  },
  rowMeta: {
    color: "#8f6947",
    fontSize: 13,
  },
});
