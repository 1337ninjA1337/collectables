import { Link, router } from "expo-router";
import { Stack } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NestableDraggableFlatList, ScaleDecorator, RenderItemParams } from "../components/DraggableList";

import { CollectionCard } from "@/components/collection-card";
import { EmptyState } from "@/components/empty-state";
import { Screen, useResponsive } from "@/components/screen";
import { Skeleton } from "@/components/skeleton";
import { SwipeTabs } from "@/components/swipe-tabs";
import { useAppTheme } from "@/components/use-app-theme";
import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_MUTED_2,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  CARD_BG_9,
  HERO_DARK,
  HERO_DARK_2,
  HERO_DARK_4,
  HERO_DARK_5,
  MUTED,
  MUTED_2,
  MUTED_18,
  RADIUS_AVATAR,
  RADIUS_CARD,
  RADIUS_CARD_AIRY,
  RADIUS_CARD_LG,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_GUTTER,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_ON_DARK,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_5,
  TEXT_ON_DARK_7,
  TEXT_ON_DARK_8,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";
import { Collection } from "@/lib/types";
import { FONT_DISPLAY_EDITORIAL, FONT_DISPLAY_BOLD, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

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
    sharedWithMeCollections,
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
  const { isMobile } = useResponsive();
  const theme = useAppTheme();

  const recentItems = useMemo(() => {
    const ownedIds = new Set(
      collections.filter((c) => c.role === "owner").map((c) => c.id),
    );
    return items
      .filter(
        (item) =>
          !item.isWishlist && !item.archivedAt && ownedIds.has(item.collectionId),
      )
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .slice(0, 10);
  }, [items, collections]);

  if (!ready) {
    return (
      <Screen>
        <Skeleton style={{ height: 200, borderRadius: RADIUS_HERO_LG }} />
        <Skeleton style={{ height: 60, borderRadius: 20 }} />
        <Skeleton style={{ height: 20, width: 160, borderRadius: 8 }} />
        <Skeleton style={{ height: 130, borderRadius: RADIUS_CARD_AIRY }} />
        <Skeleton style={{ height: 130, borderRadius: RADIUS_CARD_AIRY }} />
      </Screen>
    );
  }

  const ownedCollections = collections.filter((collection) => collection.role === "owner");
  const sharedWithMeIds = new Set(sharedWithMeCollections.map((c) => c.id));
  const friendCollections = collections.filter((collection) =>
    collection.role === "viewer" && (friends.includes(collection.ownerUserId) || sharedWithMeIds.has(collection.id))
  );
  const myProfile = getMyProfile();
  const isPhone = isMobile;

  const renderOwnedCollection = ({ item: collection, drag, isActive }: RenderItemParams<Collection>) => (
    <ScaleDecorator>
      <Pressable onLongPress={drag} disabled={isActive} delayLongPress={150}>
        <CollectionCard
          collection={collection}
          count={getItemsForCollection(collection.id).length}
          totalCost={getCollectionTotalCost(collection.id).amount}
          totalCostCurrency={getCollectionTotalCost(collection.id).currency}
        />
      </Pressable>
    </ScaleDecorator>
  );

  return (
    <Screen nestable refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: "Collectables" }} />
      {isPhone ? null : (
      <LinearGradient
        colors={[HERO_DARK_4, HERO_DARK, HERO_DARK_5]}
        start={{ x: 0.2, y: 0.6 }}
        end={{ x: 1, y: 0 }}
        style={styles.hero}
      >
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
      </LinearGradient>
      )}

      {!isPhone && (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("myProfile")}</Text>
            <Text style={{ ...styles.sectionDescription, color: theme.muted }}>{t("myProfileSubtitle")}</Text>
          </View>
          {myProfile ? (
            <Link href={`/profile/${myProfile.id}` as never} asChild>
              <Pressable style={{ ...styles.inlineAction, backgroundColor: theme.text }}>
                <Text style={{ ...styles.inlineActionText, color: theme.textOnDark }}>{t("openProfile")}</Text>
              </Pressable>
            </Link>
          ) : null}
        </View>

        {!isPhone && (
          <View style={styles.socialSummary}>
            <Link href={"/people?tab=friends" as never} asChild>
              <Pressable style={{ ...styles.summaryCard, backgroundColor: theme.card, borderColor: theme.border }}>
                <Text style={{ ...styles.summaryNumber, color: theme.text }}>{friends.length}</Text>
                <Text style={{ ...styles.summaryLabel, color: theme.meta }}>{t("friends")}</Text>
              </Pressable>
            </Link>
            <Link href={"/people?tab=following" as never} asChild>
              <Pressable style={{ ...styles.summaryCard, backgroundColor: theme.card, borderColor: theme.border }}>
                <Text style={{ ...styles.summaryNumber, color: theme.text }}>{following.length}</Text>
                <Text style={{ ...styles.summaryLabel, color: theme.meta }}>{t("following")}</Text>
              </Pressable>
            </Link>
          </View>
        )}

      </View>
      )}

      <Link href="/wishlist" asChild>
        <Pressable style={{ ...styles.wishlistBanner, backgroundColor: theme.bannerBg, ...SHADOW_SOFT }}>
          <View style={styles.wishlistBannerIcon}>
            <Text style={styles.wishlistBannerIconText}>★</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...styles.wishlistBannerTitle, color: theme.text }}>{t("wishlist")}</Text>
            <Text style={{ ...styles.wishlistBannerHint, color: theme.meta }}>{t("wishlistHint")}</Text>
          </View>
          <Text style={{ ...styles.wishlistBannerArrow, color: theme.meta }}>›</Text>
        </Pressable>
      </Link>

      <Link href="/stats" asChild>
        <Pressable style={{ ...styles.statsBanner, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
          <View style={styles.statsBannerIcon}>
            <Text style={styles.statsBannerIconText}>⊞</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...styles.statsBannerTitle, color: theme.text }}>{t("statsTitle")}</Text>
            <Text style={{ ...styles.statsBannerHint, color: theme.meta }}>{t("statsSubtitle")}</Text>
          </View>
          <Text style={{ ...styles.statsBannerArrow, color: theme.meta }}>›</Text>
        </Pressable>
      </Link>

      {recentItems.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("recentlyAdded")}</Text>
              <Text style={{ ...styles.sectionDescription, color: theme.muted }}>{t("recentlyAddedHint")}</Text>
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
                  <Pressable style={{ ...styles.recentCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
                    {hasPhoto ? (
                      <Image source={{ uri: item.photos[0] }} style={styles.recentImage} />
                    ) : (
                      <View style={{...styles.recentImage, backgroundColor: placeholderColor(item.id)}} />
                    )}
                    <View style={styles.recentBadge}>
                      <Text style={styles.recentBadgeText}>NEW</Text>
                    </View>
                    <View style={styles.recentTextWrap}>
                      <Text style={{ ...styles.recentTitle, color: theme.text }} numberOfLines={1}>{item.title}</Text>
                      {col ? <Text style={{ ...styles.recentMeta, color: theme.meta }} numberOfLines={1}>{col.name}</Text> : null}
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
                      <Text style={{ ...styles.sectionDescription, color: theme.muted }}>{t("myCollectionsSubtitle")}</Text>
                    </View>
                    <Link href="/create-collection" asChild>
                      <Pressable style={{ ...styles.inlineAction, backgroundColor: theme.text }}>
                        <Text style={{ ...styles.inlineActionText, color: theme.textOnDark }}>{t("newCollectionInline")}</Text>
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
                  <Text style={{ ...styles.sectionDescription, color: theme.muted }}>{t("friendCollectionsSubtitle")}</Text>
                  {friendCollections.length > 0 ? (
                    friendCollections.map((collection) => {
                      const total = getCollectionTotalCost(collection.id);
                      return (
                        <CollectionCard key={collection.id} collection={collection} count={getItemsForCollection(collection.id).length} totalCost={total.amount} totalCostCurrency={total.currency} />
                      );
                    })
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
                <Text style={{ ...styles.sectionDescription, color: theme.muted }}>{t("collectionsFeedSubtitle")}</Text>
                {subscribedCollections.length > 0 ? (
                  subscribedCollections.map((collection) => {
                    const total = getCollectionTotalCost(collection.id);
                    return (
                      <CollectionCard key={collection.id} collection={collection} count={getItemsForCollection(collection.id).length} totalCost={total.amount} totalCostCurrency={total.currency} />
                    );
                  })
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
    borderRadius: RADIUS_HERO_LG,
    padding: SPACING_GUTTER,
    gap: 12,
  },
  phoneActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    fontFamily: FONT_DISPLAY_EDITORIAL,
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
    color: AMBER_LIGHT,
    fontSize: 11,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  profileValue: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  settingsButton: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: MUTED_18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingsButtonText: {
    color: TEXT_ON_DARK_7,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  signOutButton: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: MUTED_18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutButtonText: {
    color: TEXT_ON_DARK_7,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: FONT_BODY,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  cta: {
    alignSelf: "flex-start",
    backgroundColor: AMBER_ACCENT,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: RADIUS_PILL,
  },
  ctaText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    fontSize: 15,
  },
  secondaryCta: {
    alignSelf: "flex-start",
    borderRadius: RADIUS_PILL,
    backgroundColor: CARD_BG_9,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryCtaText: {
    color: HERO_DARK_2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    fontSize: 15,
  },
  peopleCta: {
    alignSelf: "flex-start",
    borderRadius: RADIUS_PILL,
    backgroundColor: "rgba(255, 244, 229, 0.12)",
    borderWidth: 1,
    borderColor: MUTED_18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  peopleCtaText: {
    color: TEXT_ON_DARK_8,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
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
    fontWeight: "600",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  sectionDescription: {
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
  inlineAction: {
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inlineActionText: {
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    fontSize: 14,
  },
  socialSummary: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: RADIUS_CARD_AIRY,
    padding: 18,
    borderWidth: 1,
    gap: 6,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  summaryLabel: {
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
  socialList: {
    gap: 10,
  },
  personCard: {
    borderRadius: RADIUS_CARD,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 4,
  },
  personName: {
    color: TEXT_DARK,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_BOLD,
  },
  personMeta: {
    color: MUTED,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  emptyCard: {
    borderRadius: RADIUS_CARD_LG,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },
  emptyCardText: {
    color: MUTED_2,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  recentRow: {
    gap: 12,
    paddingRight: 4,
  },
  recentCard: {
    width: 140,
    borderRadius: RADIUS_ITEM_AIRY,
    borderWidth: 1,
    overflow: "hidden",
  },
  recentImage: {
    width: 140,
    height: 120,
    borderRadius: RADIUS_AVATAR,
    backgroundColor: AMBER_MUTED_2,
  },
  recentBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 8,
    backgroundColor: AMBER_ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recentBadgeText: {
    color: TEXT_ON_DARK_5,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    letterSpacing: 0.6,
  },
  recentTextWrap: {
    padding: 10,
    gap: 2,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  recentMeta: {
    fontSize: 12,
    fontFamily: FONT_BODY,
  },
  wishlistBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  wishlistBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS_CARD,
    backgroundColor: AMBER_ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  wishlistBannerIconText: {
    color: TEXT_ON_DARK_5,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  wishlistBannerTitle: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  wishlistBannerHint: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: FONT_BODY,
  },
  wishlistBannerArrow: {
    fontSize: 28,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  statsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
  },
  statsBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS_CARD,
    backgroundColor: HERO_DARK,
    alignItems: "center",
    justifyContent: "center",
  },
  statsBannerIconText: {
    color: TEXT_ON_DARK,
    fontSize: 20,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  statsBannerTitle: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  statsBannerHint: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: FONT_BODY,
  },
  statsBannerArrow: {
    fontSize: 28,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
