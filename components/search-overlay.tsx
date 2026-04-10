import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { fetchProfiles } from "@/lib/supabase-profiles";
import { UserProfile } from "@/lib/types";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function SearchOverlay({ visible, onClose }: Props) {
  const { t } = useI18n();
  const { collections } = useCollections();
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    fetchProfiles(1, 100)
      .then((r) => setProfiles(r.data))
      .catch(() => {});
  }, [visible]);

  const q = query.trim().toLowerCase();

  const matchedCollections = useMemo(() => {
    if (!q) return [];
    return collections
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [collections, q]);

  const matchedProfiles = useMemo(() => {
    if (!q) return [];
    const needle = q.replace(/^@/, "");
    return profiles
      .filter(
        (p) =>
          p.username.toLowerCase().includes(needle) ||
          p.displayName.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }, [profiles, q]);

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

  const hasResults = matchedProfiles.length + matchedCollections.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
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
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color="#8a6e54" />
            </Pressable>
          </View>

          {q.length === 0 ? null : !hasResults ? (
            <Text style={styles.empty}>{t("searchNoResults")}</Text>
          ) : (
            <ScrollView
              style={styles.results}
              keyboardShouldPersistTaps="handled"
            >
              {matchedProfiles.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>
                    {t("searchResultsPeople")}
                  </Text>
                  {matchedProfiles.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.row}
                      onPress={() => goToProfile(p.id)}
                    >
                      <Text style={styles.rowTitle}>{p.displayName}</Text>
                      <Text style={styles.rowMeta}>@{p.username}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {matchedCollections.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>
                    {t("searchResultsCollections")}
                  </Text>
                  {matchedCollections.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.row}
                      onPress={() => goToCollection(c.id)}
                    >
                      <Text style={styles.rowTitle}>{c.name}</Text>
                      <Text style={styles.rowMeta}>{c.ownerName}</Text>
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
    gap: 12,
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
  closeBtn: {
    padding: 4,
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
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0e4d0",
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
  empty: {
    color: "#6b5647",
    textAlign: "center",
    paddingVertical: 12,
    fontSize: 14,
  },
});
