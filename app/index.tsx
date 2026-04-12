import { Link, router } from "expo-router";
import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NestableDraggableFlatList, ScaleDecorator, RenderItemParams } from "../components/DraggableList";

import { CollectionCard } from "@/components/collection-card";
import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { SwipeTabs } from "@/components/swipe-tabs";
import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";
import { Collection } from "@/lib/types";

type CollectionsTab = "mine" | "friends" | "subscribed";

export default function HomeScreen() {
  const { user, signOut, pending } = useAuth();
  const {
    collections,
    items,
    getItemsForCollection,
    getCollectionTotalCost,
    getCollectionById,
    ready,
    subscribedCollections,
    reorderOwnedCollections,
    refresh,
  } = useCollections();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const { t } = useI18n();
  const { friends, following, getMyProfile } = useSocial();
  const [collectionsTab, setCollectionsTab] = useState<CollectionsTab>("mine");

  const recentItems = useMemo(() => {
    const ownedIds = new Set(
      collections.filter((c) => c.role === "owner").map((c) => c.id),
    );
    return items
      .filter((item) => !item.isWishlist && ownedIds.has(item.collectionId))
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .slice(0, 10);
  }, [items, collections]);

  if (!ready) {
    return (
      <Screen scroll={false}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8a5a2b" />
          <Text style={styles.loadingText}>{t("loadingCollections")}</Text>
        </View>
      </Screen>
    );
  }

  const ownedCollections = collections.filter((collection) => collection.role === "owner");
  const friendCollections = collections.filter((collection) => collection.role === "viewer" && friends.includes(collection.ownerUserId));
  const myProfile = getMyProfile();
  const isPhone = Platform.OS !== "web";

  const renderOwnedCollection = ({ item: collection, drag, isActive }: RenderItemParams<Collection>) => (
    <ScaleDecorator>
      <Pressable onLongPress={drag} disabled={isActive} delayLongPress={150}>
        <CollectionCard
          collection={collection}
          count={getItemsForCollection(collection.id).length}
          totalCost={getCollectionTotalCost(collection.id)}
        />
      </Pressable>
    </ScaleDecorator>
  );

  return (
    <Screen nestable refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: "Collectables" }} />
      {isPhone ? null : (
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("appName")}</Text>
        <View style={styles.profileRow}>
          {myProfile ? (
            <Link href={`/profile/${myProfile.id}` as never} asChild>
              <Pressable style={styles.profileCard}>
                <Text style={styles.profileLabel}>{t("profile")}</Text>
                <Text style={styles.profileValue}>{myProfile.displayName}</Text>
              </Pressable>
            </Link>
          ) : (
            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>{t("profile")}</Text>
              <Text style={styles.profileValue}>{user?.email ?? t("noEmail")}</Text>
            </View>
          )}
          <View style={styles.headerButtons}>
            <Link href="/settings" asChild>
              <Pressable style={styles.settingsButton}>
                <Text style={styles.settingsButtonText}>{t("settings")}</Text>
              </Pressable>
            </Link>
            <Pressable
              style={{...styles.signOutButton, ...(pending ? styles.signOutButtonDisabled : {})}}
              onPress={() => void signOut()}
              disabled={pending}
            >
              <Text style={styles.signOutButtonText}>{t("signOut")}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.title}>{t("homeTitle")}</Text>
        <Text style={styles.subtitle}>{t("homeSubtitle")}</Text>
        <View style={styles.actionsRow}>
          <Link href="/create" asChild>
            <Pressable style={styles.cta}>
              <Text style={styles.ctaText}>{t("addItem")}</Text>
            </Pressable>
          </Link>
          <Link href="/create-collection" asChild>
            <Pressable style={styles.secondaryCta}>
              <Text style={styles.secondaryCtaText}>{t("createCollection")}</Text>
            </Pressable>
          </Link>
          <Link href="/people" asChild>
            <Pressable style={styles.peopleCta}>
              <Text style={styles.peopleCtaText}>{t("peopleAndFollowing")}</Text>
            </Pressable>
          </Link>
          <Link href="/wishlist" asChild>
            <Pressable style={styles.peopleCta}>
              <Text style={styles.peopleCtaText}>{t("wishlist")}</Text>
            </Pressable>
          </Link>
        </View>
      </View>
      )}

      {!isPhone && (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>{t("myProfile")}</Text>
            <Text style={styles.sectionDescription}>{t("myProfileSubtitle")}</Text>
          </View>
          {myProfile ? (
            <Link href={`/profile/${myProfile.id}` as never} asChild>
              <Pressable style={styles.inlineAction}>
                <Text style={styles.inlineActionText}>{t("openProfile")}</Text>
              </Pressable>
            </Link>
          ) : null}
        </View>

        {!isPhone && (
          <View style={styles.socialSummary}>
            <Link href={"/people?tab=friends" as never} asChild>
              <Pressable style={styles.summaryCard}>
                <Text style={styles.summaryNumber}>{friends.length}</Text>
                <Text style={styles.summaryLabel}>{t("friends")}</Text>
              </Pressable>
            </Link>
            <Link href={"/people?tab=following" as never} asChild>
              <Pressable style={styles.summaryCard}>
                <Text style={styles.summaryNumber}>{following.length}</Text>
                <Text style={styles.summaryLabel}>{t("following")}</Text>
              </Pressable>
            </Link>
          </View>
        )}

      </View>
      )}

      <Link href="/wishlist" asChild>
        <Pressable style={styles.wishlistBanner}>
          <View style={styles.wishlistBannerIcon}>
            <Text style={styles.wishlistBannerIconText}>★</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.wishlistBannerTitle}>{t("wishlist")}</Text>
            <Text style={styles.wishlistBannerHint}>{t("wishlistHint")}</Text>
          </View>
          <Text style={styles.wishlistBannerArrow}>›</Text>
        </Pressable>
      </Link>

      {recentItems.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.sectionTitle}>{t("recentlyAdded")}</Text>
              <Text style={styles.sectionDescription}>{t("recentlyAddedHint")}</Text>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {recentItems.map((item) => {
              const hasPhoto = item.photos.length > 0 && Boolean(item.photos[0]);
              const col = getCollectionById(item.collectionId);
              return (
                <Link key={item.id} href={`/item/${item.id}`} asChild>
                  <Pressable style={styles.recentCard}>
                    {hasPhoto ? (
                      <Image source={{ uri: item.photos[0] }} style={styles.recentImage} />
                    ) : (
                      <View style={{...styles.recentImage, backgroundColor: placeholderColor(item.id)}} />
                    )}
                    <View style={styles.recentBadge}>
                      <Text style={styles.recentBadgeText}>NEW</Text>
                    </View>
                    <View style={styles.recentTextWrap}>
                      <Text style={styles.recentTitle} numberOfLines={1}>{item.title}</Text>
                      {col ? <Text style={styles.recentMeta} numberOfLines={1}>{col.name}</Text> : null}
                    </View>
                  </Pressable>
                </Link>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        <SwipeTabs
          tabs={[
            { key: "mine", label: t("myCollections") },
            { key: "friends", label: t("friendCollections") },
            { key: "subscribed", label: t("tabSubscribedCollections") },
          ]}
          active={collectionsTab}
          onChange={(k) => setCollectionsTab(k as CollectionsTab)}
          renderTab={(key) => {
            if (key === "mine") {
              return (
                <View style={styles.tabPanel}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionHeaderText}>
                      <Text style={styles.sectionDescription}>{t("myCollectionsSubtitle")}</Text>
                    </View>
                    <Link href="/create-collection" asChild>
                      <Pressable style={styles.inlineAction}>
                        <Text style={styles.inlineActionText}>{t("newCollectionInline")}</Text>
                      </Pressable>
                    </Link>
                  </View>
                  {ownedCollections.length > 0 ? (
                    <NestableDraggableFlatList
                      data={ownedCollections}
                      keyExtractor={(c) => c.id}
                      renderItem={renderOwnedCollection}
                      onDragEnd={({ data }) => reorderOwnedCollections(data.map((c) => c.id))}
                      contentContainerStyle={styles.draggableList}
                    />
                  ) : (
                    <EmptyState
                      icon="📚"
                      title={t("emptyOwnedTitle")}
                      hint={t("emptyOwnedHint")}
                      actionLabel={t("emptyOwnedCta")}
                      onAction={() => router.push("/create-collection")}
                    />
                  )}
                </View>
              );
            }
            if (key === "friends") {
              return (
                <View style={styles.tabPanel}>
                  <Text style={styles.sectionDescription}>{t("friendCollectionsSubtitle")}</Text>
                  {friendCollections.length > 0 ? (
                    friendCollections.map((collection) => (
                      <CollectionCard key={collection.id} collection={collection} count={getItemsForCollection(collection.id).length} totalCost={getCollectionTotalCost(collection.id)} />
                    ))
                  ) : (
                    <EmptyState
                      icon="🤝"
                      title={t("emptyFriendCollectionsTitle")}
                      hint={t("emptyFriendCollectionsHint")}
                      actionLabel={t("emptyFriendCollectionsCta")}
                      onAction={() => router.push("/people")}
                    />
                  )}
                </View>
              );
            }
            return (
              <View style={styles.tabPanel}>
                <Text style={styles.sectionDescription}>{t("collectionsFeedSubtitle")}</Text>
                {subscribedCollections.length > 0 ? (
                  subscribedCollections.map((collection) => (
                    <CollectionCard key={collection.id} collection={collection} count={getItemsForCollection(collection.id).length} totalCost={getCollectionTotalCost(collection.id)} />
                  ))
                ) : (
                  <EmptyState
                    icon="🔖"
                    title={t("emptySubscribedTitle")}
                    hint={t("emptySubscribedHint")}
                    actionLabel={t("emptySubscribedCta")}
                    onAction={() => router.push("/people")}
                  />
                )}
              </View>
            );
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: "#261b14",
    borderRadius: 32,
    padding: 24,
    gap: 12,
  },
  phoneActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
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
    fontSize: 31,
    lineHeight: 39,
    fontWeight: "800",
  },
  profileRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  profileCard: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 244, 229, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 201, 154, 0.24)",
    gap: 4,
  },
  profileLabel: {
    color: "#f5c99a",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  profileValue: {
    color: "#fff7ef",
    fontSize: 14,
    fontWeight: "700",
  },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  settingsButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#6e5541",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingsButtonText: {
    color: "#f8e7d1",
    fontSize: 14,
    fontWeight: "700",
  },
  signOutButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#6e5541",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutButtonText: {
    color: "#f8e7d1",
    fontSize: 14,
    fontWeight: "700",
  },
  subtitle: {
    color: "#ead8c3",
    fontSize: 15,
    lineHeight: 23,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  cta: {
    alignSelf: "flex-start",
    backgroundColor: "#d89c5b",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
  },
  ctaText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 15,
  },
  secondaryCta: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#fff4e5",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryCtaText: {
    color: "#2a1d15",
    fontWeight: "800",
    fontSize: 15,
  },
  peopleCta: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(255, 244, 229, 0.12)",
    borderWidth: 1,
    borderColor: "#6e5541",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  peopleCtaText: {
    color: "#fff3e4",
    fontWeight: "800",
    fontSize: 15,
  },
  section: {
    gap: 14,
  },
  tabPanel: {
    gap: 14,
  },
  draggableList: {
    gap: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    flexWrap: "wrap",
  },
  sectionHeaderText: {
    flex: 1,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#2f2318",
  },
  sectionDescription: {
    color: "#735f50",
    lineHeight: 21,
  },
  inlineAction: {
    borderRadius: 999,
    backgroundColor: "#2f2318",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inlineActionText: {
    color: "#fff3e4",
    fontWeight: "800",
    fontSize: 14,
  },
  socialSummary: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 24,
    padding: 18,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 6,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: "#2d2117",
  },
  summaryLabel: {
    color: "#715d4d",
    lineHeight: 21,
  },
  socialList: {
    gap: 10,
  },
  personCard: {
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 16,
    gap: 4,
  },
  personName: {
    color: "#2f2318",
    fontSize: 18,
    fontWeight: "800",
  },
  personMeta: {
    color: "#8f6947",
    fontWeight: "700",
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
  },
  emptyCardText: {
    color: "#6b5647",
    lineHeight: 22,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#6d5645",
    fontSize: 15,
  },
  recentRow: {
    gap: 12,
    paddingRight: 4,
  },
  recentCard: {
    width: 140,
    borderRadius: 20,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    overflow: "hidden",
  },
  recentImage: {
    width: 140,
    height: 120,
    backgroundColor: "#dbc7ae",
  },
  recentBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 8,
    backgroundColor: "#d89c5b",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recentBadgeText: {
    color: "#fff7ea",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  recentTextWrap: {
    padding: 10,
    gap: 2,
  },
  recentTitle: {
    color: "#2f2318",
    fontSize: 14,
    fontWeight: "700",
  },
  recentMeta: {
    color: "#8f6947",
    fontSize: 12,
  },
  wishlistBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#fff4e5",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  wishlistBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#d89c5b",
    alignItems: "center",
    justifyContent: "center",
  },
  wishlistBannerIconText: {
    color: "#fff7ea",
    fontSize: 22,
    fontWeight: "800",
  },
  wishlistBannerTitle: {
    color: "#2f2318",
    fontSize: 16,
    fontWeight: "800",
  },
  wishlistBannerHint: {
    color: "#8f6947",
    fontSize: 13,
    marginTop: 2,
  },
  wishlistBannerArrow: {
    color: "#8f6947",
    fontSize: 28,
    fontWeight: "800",
  },
});
