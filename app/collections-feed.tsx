import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CollectionCard } from "@/components/collection-card";
import { EmptyState } from "@/components/empty-state";
import { HeroBanner } from "@/components/hero-banner";
import { LoadMoreButton } from "@/components/load-more-button";
import { Screen } from "@/components/screen";
import { SwipeTabs } from "@/components/swipe-tabs";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_SOFT,
  CARD_BG_3,
  MUTED_3,
  RADIUS_CARD,
} from "@/lib/design-tokens";
import { FONT_BODY_BOLD } from "@/lib/fonts";
import { selectFriendCollections } from "@/lib/home-helpers";
import { useChunkedList } from "@/lib/use-chunked-list";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { Collection } from "@/lib/types";

type MainTab = "friends" | "subscribed";

export default function CollectionsFeedScreen() {
  const { t } = useI18n();
  const { collections, sharedWithMeCollections, subscribedCollections, getItemsForCollection, getCollectionTotalCost } = useCollections();
  const { friendIds } = useSocial();

  /**
   * The same list the home screen's "Friends' collections" tab shows.
   *
   * This tab rendered the context's `friendCollections` — only what
   * `fetchPublicCollectionsByUserId` returned for each friend — so it was a
   * strict subset of the home screen's answer to the same question: no seeded
   * friend collections, nothing shared directly with the viewer, and nothing
   * at all before the fetch landed. Two lists with one name, on two screens a
   * user moves between. `selectFriendCollections` is now the only place the
   * rule is written.
   */
  const friendCollections = useMemo(
    () => selectFriendCollections(collections, friendIds, sharedWithMeCollections),
    [collections, friendIds, sharedWithMeCollections],
  );

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
      <HeroBanner
        tone="solid"
        eyebrow={t("collectionsFeed")}
        title={t("collectionsFeedTitle")}
        subtitle={t("collectionsFeedSubtitle")}
      />

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
              <LoadMoreButton remaining={total - cols.length} onPress={window.loadMore} />
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabPanel: {
    gap: 14,
  },
});
