import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { SkeletonItemDetail } from "@/components/skeleton";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useChat } from "@/lib/chat-context";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_MUTED,
  AMBER_MUTED_3,
  AMBER_MUTED_4,
  AMBER_SOFT,
  BORDER,
  BORDER_2,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK,
  HERO_DARK_3,
  HERO_DARK_7,
  MUTED,
  MUTED_3,
  SUCCESS_GREEN,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_6,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { priceHistoryForTitle } from "@/lib/marketplace-helpers";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";
import { useToast } from "@/lib/toast-context";

export default function ListingDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const listingId = params.id ?? "";
  const { t, formatRelativeDate, formatAbsoluteDate } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const {
    getListingById,
    fetchListingById,
    listings,
    markListingSold,
    claimingListingId,
    setClaimingListingId,
  } = useMarketplace();
  const { getItemById, transferItemToBuyer } = useCollections();
  const { getProfileById, ensureProfilesLoaded, getRelationship } = useSocial();
  const { ensureChatWith, canMessage, sendMessage } = useChat();
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const claiming = claimingListingId === listingId;

  const listing = getListingById(listingId);

  useEffect(() => {
    if (listing || !listingId || fetchingRemote) return;
    setFetchingRemote(true);
    fetchListingById(listingId).finally(() => setFetchingRemote(false));
  }, [listing, listingId, fetchListingById, fetchingRemote]);

  const item = listing ? getItemById(listing.itemId) : undefined;
  const owner = listing ? getProfileById(listing.ownerUserId) : undefined;

  useEffect(() => {
    if (!listing) return;
    const ids = [listing.ownerUserId];
    if (listing.buyerUserId) ids.push(listing.buyerUserId);
    ensureProfilesLoaded(ids);
  }, [listing, ensureProfilesLoaded]);

  if (!listing) {
    if (fetchingRemote) {
      return (
        <Screen>
          <Stack.Screen options={{ title: t("marketplaceTitle") }} />
          <SkeletonItemDetail />
        </Screen>
      );
    }
    return (
      <Screen>
        <Stack.Screen options={{ title: t("marketplaceTitle") }} />
        <EmptyState
          icon="🪧"
          title={t("marketplaceListingNotFound")}
          hint={t("marketplaceListingNotFoundHint")}
          actionLabel={t("marketplaceTitle")}
          onAction={() => router.replace("/marketplace")}
        />
      </Screen>
    );
  }

  const ownerName = owner?.displayName ?? t("unknownUser");
  const isSelf = user?.id === listing.ownerUserId;
  const friendsOnly = !isSelf && !canMessage(listing.ownerUserId);
  const isSold = listing.soldAt !== null;
  const buyer = listing.buyerUserId ? getProfileById(listing.buyerUserId) : undefined;
  const buyerName = buyer?.username
    ? `@${buyer.username}`
    : buyer?.displayName ?? t("unknownUser");

  const referenceTitle = item?.title ?? "";
  const priceHistory = useMemo(
    () =>
      referenceTitle
        ? priceHistoryForTitle(
            referenceTitle,
            listings,
            (id) => getItemById(id)?.title ?? null,
            { excludeListingId: listing.id, limit: 10 },
          )
        : [],
    [referenceTitle, listings, getItemById, listing.id],
  );

  const photo = item?.photos?.find(Boolean);
  const itemTitle = item?.title ?? t("marketplaceUnknownItem");
  const modeLabel =
    listing.mode === "trade" ? t("marketplaceModeTrade") : t("marketplaceModeSell");
  const priceLabel =
    listing.mode === "sell" && typeof listing.askingPrice === "number"
      ? `${listing.askingPrice} ${listing.currency}`
      : null;

  function handleMessageOwner() {
    if (!listing) return;
    const chatId = ensureChatWith(listing.ownerUserId);
    if (!chatId) return;
    router.push(`/chat/${listing.ownerUserId}` as never);
  }

  const performClaim = useCallback(async () => {
    if (!listing || !user) return;
    setClaimingListingId(listing.id);
    try {
      const sourceItem = getItemById(listing.itemId);
      const fallbackTitle = sourceItem?.title ?? t("marketplaceUnknownItem");
      await transferItemToBuyer(
        {
          title: fallbackTitle,
          photos: sourceItem?.photos ?? [],
          description: sourceItem?.description ?? listing.notes,
          variants: sourceItem?.variants,
          cost:
            listing.mode === "sell" && typeof listing.askingPrice === "number"
              ? listing.askingPrice
              : sourceItem?.cost ?? null,
          acquiredFrom: t("marketplaceTitle"),
          condition: sourceItem?.condition,
          tags: sourceItem?.tags,
        },
        {
          collectionName: t("marketplaceAcquiredCollection"),
          collectionDescription: t("marketplaceAcquiredCollectionDescription"),
        },
      );
      markListingSold(listing.id, user.id);
      toast.success(t("marketplaceClaimSuccess"));
      // Notify the seller in-app via chat so the buy/trade event has an
      // explicit follow-up thread. Fire-and-forget: a chat failure (no
      // friendship, RLS reject, offline) must not block the claim itself.
      const messageBody =
        listing.mode === "sell" && typeof listing.askingPrice === "number"
          ? t("marketplaceClaimAutoMessageBuy", {
              title: sourceItem?.title ?? fallbackTitle,
              price: listing.askingPrice,
              currency: listing.currency,
            })
          : t("marketplaceClaimAutoMessageTrade", {
              title: sourceItem?.title ?? fallbackTitle,
            });
      void sendMessage(listing.ownerUserId, messageBody);
      trackEvent("listing_claimed", {
        mode: listing.mode,
        sellerWasFriend: getRelationship(listing.ownerUserId) === "friend",
      });
    } finally {
      setClaimingListingId(null);
    }
  }, [listing, user, markListingSold, setClaimingListingId, getItemById, transferItemToBuyer, getRelationship, sendMessage, toast, t]);

  function handleClaimPress() {
    if (!listing || !user || claiming) return;
    const title = t("marketplaceConfirmBuyTitle");
    const text =
      listing.mode === "trade"
        ? t("marketplaceConfirmTradeText")
        : t("marketplaceConfirmBuyText");
    if (Platform.OS === "web") {
      const ok = typeof window !== "undefined" && window.confirm
        ? window.confirm(`${title}\n\n${text}`)
        : true;
      if (ok) void performClaim();
      return;
    }
    Alert.alert(title, text, [
      { text: t("cancel"), style: "cancel" },
      { text: t("marketplaceClaim"), style: "default", onPress: () => void performClaim() },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: itemTitle }} />

      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} />
      ) : (
        <View style={{ ...styles.photo, backgroundColor: placeholderColor(listing.id) }} />
      )}

      <View style={styles.headerCard}>
        <Text style={styles.itemTitle}>{itemTitle}</Text>
        <View style={styles.metaRow}>
          <View
            style={{
              ...styles.modeBadge,
              backgroundColor: listing.mode === "sell" ? AMBER_ACCENT : SUCCESS_GREEN,
            }}
          >
            <Text style={styles.modeBadgeText}>{modeLabel}</Text>
          </View>
          {priceLabel ? <Text style={styles.priceText}>{priceLabel}</Text> : null}
        </View>
        <Pressable
          onLongPress={() => toast.info(formatAbsoluteDate(listing.createdAt))}
          accessibilityLabel={formatAbsoluteDate(listing.createdAt)}
          {...(Platform.OS === "web"
            ? ({ title: formatAbsoluteDate(listing.createdAt) } as object)
            : null)}
        >
          <Text style={styles.listedAt}>
            {t("marketplaceListedAt", { when: formatRelativeDate(listing.createdAt) })}
          </Text>
        </Pressable>
      </View>

      <Link href={`/profile/${listing.ownerUserId}` as never} asChild>
        <Pressable style={styles.ownerChip}>
          {owner?.avatar ? (
            <Image source={{ uri: owner.avatar }} style={styles.ownerAvatar} />
          ) : (
            <View style={[styles.ownerAvatar, styles.ownerAvatarFallback]}>
              <Text style={styles.ownerAvatarText}>
                {ownerName.charAt(0).toUpperCase() || "?"}
              </Text>
            </View>
          )}
          <View style={styles.ownerMeta}>
            <Text style={styles.ownerLabel}>{t("marketplaceOwnerLabel")}</Text>
            <Text style={styles.ownerName} numberOfLines={1}>{ownerName}</Text>
            {owner?.username ? (
              <Text style={styles.ownerHandle}>@{owner.username}</Text>
            ) : null}
          </View>
        </Pressable>
      </Link>

      {item?.photos && item.photos.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gallery}
        >
          {item.photos.map((p) => (
            <Image key={p} source={{ uri: p }} style={styles.galleryImage} />
          ))}
        </ScrollView>
      ) : null}

      {item?.description ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{t("description")}</Text>
          <Text style={styles.sheetValue}>{item.description}</Text>
        </View>
      ) : null}

      {listing.notes ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{t("marketplaceNotesLabel")}</Text>
          <Text style={styles.sheetValue}>{listing.notes}</Text>
        </View>
      ) : null}

      {priceHistory.length > 0 ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{t("marketplacePriceHistoryLabel")}</Text>
          <Text style={styles.priceHistoryHint}>{t("marketplacePriceHistoryHint")}</Text>
          <View style={styles.priceHistoryList}>
            {priceHistory.map((entry) => (
              <View key={entry.listingId} style={styles.priceHistoryRow}>
                <Text style={styles.priceHistoryDate}>
                  {formatRelativeDate(entry.recordedAt)}
                </Text>
                <Text style={styles.priceHistoryPrice}>
                  {entry.price} {entry.currency}
                </Text>
                <View
                  style={{
                    ...styles.priceHistoryModeBadge,
                    backgroundColor: entry.mode === "sell" ? AMBER_ACCENT : SUCCESS_GREEN,
                  }}
                >
                  <Text style={styles.priceHistoryModeText}>
                    {entry.mode === "sell"
                      ? t("marketplaceModeSell")
                      : t("marketplaceModeTrade")}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {isSold ? (
        <View style={styles.soldBanner}>
          <Text style={styles.soldBannerLabel}>{t("marketplaceSoldBanner")}</Text>
          {listing.buyerUserId ? (
            <>
              <Text style={styles.soldBannerBuyer}>
                {t("marketplaceSoldTo", { name: buyerName })}
              </Text>
              <View style={styles.transferredBadge}>
                <Text style={styles.transferredBadgeText}>
                  {t("marketplaceTransferredBadge")}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {isSelf ? (
        <View style={styles.selfHint}>
          <Text style={styles.selfHintText}>{t("marketplaceSelfHint")}</Text>
        </View>
      ) : friendsOnly ? (
        <EmptyState
          icon="🔒"
          title={t("chatOnlyFriendsTitle")}
          hint={t("chatOnlyFriendsHint")}
          actionLabel={t("openProfile")}
          onAction={() => router.push(`/profile/${listing.ownerUserId}` as never)}
        />
      ) : (
        <View style={styles.actionsColumn}>
          {!isSold ? (
            <Pressable
              style={{
                ...styles.claimButton,
                backgroundColor: listing.mode === "sell" ? AMBER_ACCENT : SUCCESS_GREEN,
                opacity: claiming ? 0.6 : 1,
              }}
              onPress={handleClaimPress}
              disabled={claiming}
            >
              <Text style={styles.claimButtonText}>
                {listing.mode === "sell"
                  ? t("marketplaceBuyNow")
                  : t("marketplaceTradeRequest")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.messageButton} onPress={handleMessageOwner}>
            <Text style={styles.messageButtonText}>{t("marketplaceMessageOwner")}</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: "100%",
    height: 280,
    borderRadius: 24,
    backgroundColor: AMBER_MUTED_3,
  },
  headerCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: HERO_DARK_7,
    gap: 10,
  },
  itemTitle: {
    color: TEXT_ON_DARK_6,
    fontSize: 26,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  modeBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  priceText: {
    color: TEXT_ON_DARK_6,
    fontSize: 18,
    fontWeight: "800",
  },
  listedAt: {
    color: TEXT_ON_DARK_SOFT,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  ownerChip: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },
  ownerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: AMBER_MUTED,
  },
  ownerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  ownerAvatarText: {
    color: HERO_DARK_3,
    fontWeight: "800",
    fontSize: 22,
  },
  ownerMeta: {
    flex: 1,
    gap: 2,
  },
  ownerLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  ownerName: {
    fontSize: 17,
    fontWeight: "800",
    color: TEXT_DARK,
  },
  ownerHandle: {
    color: MUTED,
    fontWeight: "600",
    fontSize: 13,
  },
  gallery: {
    gap: 10,
    paddingRight: 20,
  },
  galleryImage: {
    width: 180,
    height: 220,
    borderRadius: 18,
    backgroundColor: AMBER_MUTED_4,
  },
  sheet: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
  },
  sheetLabel: {
    color: MUTED,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  sheetValue: {
    color: TEXT_DARK,
    fontSize: 15,
    lineHeight: 22,
  },
  actionsColumn: {
    gap: 10,
  },
  claimButton: {
    borderRadius: 22,
    paddingVertical: 16,
    alignItems: "center",
  },
  claimButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  messageButton: {
    borderRadius: 22,
    backgroundColor: HERO_DARK,
    paddingVertical: 16,
    alignItems: "center",
  },
  messageButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 15,
    fontWeight: "800",
  },
  soldBanner: {
    borderRadius: 22,
    padding: 14,
    backgroundColor: HERO_DARK_3,
    gap: 4,
    alignItems: "center",
  },
  soldBannerLabel: {
    color: AMBER_LIGHT,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  soldBannerBuyer: {
    color: TEXT_ON_DARK,
    fontSize: 15,
    fontWeight: "800",
  },
  transferredBadge: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: SUCCESS_GREEN,
  },
  transferredBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  selfHint: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  selfHintText: {
    color: MUTED_3,
    fontSize: 14,
    lineHeight: 20,
  },
  priceHistoryHint: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
  },
  priceHistoryList: {
    gap: 8,
    marginTop: 4,
  },
  priceHistoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_2,
  },
  priceHistoryDate: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
    minWidth: 90,
  },
  priceHistoryPrice: {
    color: HERO_DARK,
    fontSize: 16,
    fontWeight: "800",
    flex: 1,
  },
  priceHistoryModeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  priceHistoryModeText: {
    color: TEXT_ON_DARK,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
