import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { CollectionCard } from "@/components/collection-card";
import { Screen } from "@/components/screen";
import { SwipeTabs } from "@/components/swipe-tabs";
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

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("collectionsFeed")}</Text>
        <Text style={styles.title}>{t("collectionsFeedTitle")}</Text>
        <Text style={styles.subtitle}>{t("collectionsFeedSubtitle")}</Text>
      </View>

      <SwipeTabs
        tabs={[
          { key: "friends", label: t("tabFriendCollections") },
          { key: "subscribed", label: t("tabSubscribedCollections") },
        ]}
        active={mainTab}
        onChange={(k) => setMainTab(k as MainTab)}
        renderTab={(key) => {
          const cols = key === "friends" ? friendCollections : subscribedCollections;
          if (cols.length === 0) {
            return (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  {key === "friends" ? t("noFriendCollections") : t("noSubscribedCollections")}
                </Text>
              </View>
            );
          }
          return (
            <View style={styles.tabPanel}>
              {cols.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  count={getItemsForCollection(collection.id).length || itemCounts[collection.id] || 0}
                />
              ))}
            </View>
          );
        }}
      />
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
  tabPanel: {
    gap: 14,
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
