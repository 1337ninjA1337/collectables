import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CollectionCard } from "@/components/collection-card";
import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { SwipeTabs } from "@/components/swipe-tabs";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_LIGHT,
  AMBER_SOFT,
  CARD_BG_3,
  HERO_DARK,
  MUTED_3,
  RADIUS_CARD,
  SPACING_LIST,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { FONT_BODY_BOLD } from "@/lib/fonts";
import { useChunkedList } from "@/lib/use-chunked-list";
import { useI18n } from "@/lib/i18n-context";
import { fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { Collection } from "@/lib/types";

type MainTab = "friends" | "subscribed";

export default function CollectionsFeedScreen() {
  const { t } = useI18n();
  const { friendCollections, subscribedCollections, getItemsForCollection, getCollectionTotalCost } = useCollections();

  const [mainTab, setMainTab] = useState<MainTab>("friends");
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});

  // WLF-C: per-tab chunked windows bound the card mount count. A scroll-owning
  // FlatList (the VM-D flip) can't live inside <SwipeTabs>' pager — its
  // prev/next panels are absolutely positioned and the container's height
  // tracks the active panel — so the bounded-mount win comes from the chunked
  // window + the manual Load-more CTA (the drag-fallback precedent from
  // collection detail). A future fill-height SwipeTabs refactor can graduate
  // this to true windowing.
  const friendsWindow = useChunkedList(friendCollections);
  const subscribedWindow = useChunkedList(subscribedCollections);

  // Fetch item counts for the *mounted* window of collections only — the
  // chunked window bounds the network fan-out the same way it bounds card
  // mounts; growing the window (or switching tabs) fetches the newly
  // revealed rows, and already-fetched counts stay merged in state.
  useEffect(() => {
    const visible: Collection[] =
      mainTab === "friends" ? friendsWindow.visibleItems : subscribedWindow.visibleItems;
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
  }, [mainTab, friendsWindow.visibleItems, subscribedWindow.visibleItems]);

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
          const window = key === "friends" ? friendsWindow : subscribedWindow;
          const total = key === "friends" ? friendCollections.length : subscribedCollections.length;
          const cols = window.visibleItems;
          if (total === 0) {
            return key === "friends" ? (
              <EmptyState
                icon="🤝"
                title={t("emptyFriendCollectionsTitle")}
                hint={t("emptyFriendCollectionsHint")}
                actionLabel={t("emptyFriendCollectionsCta")}
                onAction={() => router.push("/people")}
              />
            ) : (
              <EmptyState
                icon="🔖"
                title={t("emptySubscribedTitle")}
                hint={t("emptySubscribedHint")}
                actionLabel={t("emptySubscribedCta")}
                onAction={() => router.push("/people")}
              />
            );
          }
          return (
            <View style={styles.tabPanel}>
              {cols.map((collection) => {
                const totalCost = getCollectionTotalCost(collection.id);
                return (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    count={getItemsForCollection(collection.id).length || itemCounts[collection.id] || 0}
                    totalCost={totalCost.amount}
                    totalCostCurrency={totalCost.currency}
                  />
                );
              })}
              {window.hasMore ? (
                <Pressable
                  style={styles.loadMore}
                  onPress={window.loadMore}
                  accessibilityRole="button"
                  accessibilityLabel={t("loadMoreItemsA11y", { count: total - cols.length })}
                  accessibilityHint={t("loadMoreItemsHint")}
                >
                  <Text style={styles.loadMoreText}>
                    {t("loadMoreItems", { count: total - cols.length })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: HERO_DARK,
    borderRadius: 32,
    padding: 24,
    gap: SPACING_LIST,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    lineHeight: 22,
  },
  tabPanel: {
    gap: 14,
  },
  // Mirrors collection detail's drag-fallback Load-more CTA styles.
  loadMore: {
    borderRadius: RADIUS_CARD,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    backgroundColor: CARD_BG_3,
    alignItems: "center",
    marginTop: 4,
  },
  loadMoreText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
});
