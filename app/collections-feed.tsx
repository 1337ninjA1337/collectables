import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CollectionCard } from "@/components/collection-card";
import { Screen } from "@/components/screen";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { Collection } from "@/lib/types";

type MainTab = "friends" | "subscribed";

export default function CollectionsFeedScreen() {
  const { t } = useI18n();
  const { friendCollections, subscribedCollections, getItemsForCollection } = useCollections();

  const [mainTab, setMainTab] = useState<MainTab>("friends");
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});

  // Fetch item counts for all visible collections
  useEffect(() => {
    const visible: Collection[] = mainTab === "friends" ? friendCollections : subscribedCollections;
    if (visible.length === 0) return;

    let active = true;
    Promise.all(
      visible.map((c) =>
        fetchItemsByCollectionId(c.id).then((items) => ({ id: c.id, count: items.length })),
      ),
    )
      .then((results) => {
        if (!active) return;
        setItemCounts((current) => {
          const next = { ...current };
          results.forEach((r) => { next[r.id] = r.count; });
          return next;
        });
      })
      .catch(() => {});

    return () => { active = false; };
  }, [mainTab, friendCollections, subscribedCollections]);

  const visibleCollections = mainTab === "friends" ? friendCollections : subscribedCollections;

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("collectionsFeed")}</Text>
        <Text style={styles.title}>{t("collectionsFeedTitle")}</Text>
        <Text style={styles.subtitle}>{t("collectionsFeedSubtitle")}</Text>
      </View>

      {/* Main tabs */}
      <View style={styles.tabRow}>
        <Pressable
          style={{...styles.tab, ...(mainTab === "friends" ? styles.tabActive : {})}}
          onPress={() => setMainTab("friends")}
        >
          <Text style={{...styles.tabText, ...(mainTab === "friends" ? styles.tabTextActive : {})}}>
            {t("tabFriendCollections")}
          </Text>
        </Pressable>
        <Pressable
          style={{...styles.tab, ...(mainTab === "subscribed" ? styles.tabActive : {})}}
          onPress={() => setMainTab("subscribed")}
        >
          <Text style={{...styles.tabText, ...(mainTab === "subscribed" ? styles.tabTextActive : {})}}>
            {t("tabSubscribedCollections")}
          </Text>
        </Pressable>
      </View>

      {visibleCollections.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {mainTab === "friends" ? t("noFriendCollections") : t("noSubscribedCollections")}
          </Text>
        </View>
      ) : (
        visibleCollections.map((collection) => (
          <CollectionCard
            key={collection.id}
            collection={collection}
            count={getItemsForCollection(collection.id).length || itemCounts[collection.id] || 0}
          />
        ))
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
});
