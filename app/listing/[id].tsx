import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { useChat } from "@/lib/chat-context";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { priceHistoryForTitle } from "@/lib/marketplace-helpers";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";

export default function ListingDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const listingId = params.id ?? "";
  const { t } = useI18n();
  const { user } = useAuth();
  const { getListingById, listings } = useMarketplace();
  const { getItemById } = useCollections();
  const { getProfileById, ensureProfilesLoaded } = useSocial();
  const { ensureChatWith, canMessage } = useChat();

  const listing = getListingById(listingId);

  const item = listing ? getItemById(listing.itemId) : undefined;
  const owner = listing ? getProfileById(listing.ownerUserId) : undefined;

  useEffect(() => {
    if (!listing) return;
    ensureProfilesLoaded([listing.ownerUserId]);
  }, [listing, ensureProfilesLoaded]);

  if (!listing) {
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
              backgroundColor: listing.mode === "sell" ? "#d89c5b" : "#3a7d4f",
            }}
          >
            <Text style={styles.modeBadgeText}>{modeLabel}</Text>
          </View>
          {priceLabel ? <Text style={styles.priceText}>{priceLabel}</Text> : null}
        </View>
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
                  {entry.recordedAt.slice(0, 10)}
                </Text>
                <Text style={styles.priceHistoryPrice}>
                  {entry.price} {entry.currency}
                </Text>
                <View
                  style={{
                    ...styles.priceHistoryModeBadge,
                    backgroundColor: entry.mode === "sell" ? "#d89c5b" : "#3a7d4f",
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
        <Pressable style={styles.messageButton} onPress={handleMessageOwner}>
          <Text style={styles.messageButtonText}>{t("marketplaceMessageOwner")}</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: "100%",
    height: 280,
    borderRadius: 24,
    backgroundColor: "#d8c7b1",
  },
  headerCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: "#2a1e17",
    gap: 10,
  },
  itemTitle: {
    color: "#fff7ed",
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
    color: "#fff7ef",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  priceText: {
    color: "#fff7ed",
    fontSize: 18,
    fontWeight: "800",
  },
  ownerChip: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    alignItems: "center",
  },
  ownerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: "#d9c2a8",
  },
  ownerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  ownerAvatarText: {
    color: "#3a2716",
    fontWeight: "800",
    fontSize: 22,
  },
  ownerMeta: {
    flex: 1,
    gap: 2,
  },
  ownerLabel: {
    color: "#8f6947",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  ownerName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#2f2318",
  },
  ownerHandle: {
    color: "#8f6947",
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
    backgroundColor: "#ddc9af",
  },
  sheet: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 6,
  },
  sheetLabel: {
    color: "#8f6947",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  sheetValue: {
    color: "#2f2318",
    fontSize: 15,
    lineHeight: 22,
  },
  messageButton: {
    borderRadius: 22,
    backgroundColor: "#261b14",
    paddingVertical: 16,
    alignItems: "center",
  },
  messageButtonText: {
    color: "#fff5ea",
    fontSize: 15,
    fontWeight: "800",
  },
  selfHint: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  selfHintText: {
    color: "#5f4734",
    fontSize: 14,
    lineHeight: 20,
  },
  priceHistoryHint: {
    color: "#8f6947",
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
    borderBottomColor: "#f0e2cf",
  },
  priceHistoryDate: {
    color: "#8f6947",
    fontSize: 13,
    fontWeight: "700",
    minWidth: 90,
  },
  priceHistoryPrice: {
    color: "#261b14",
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
    color: "#fff7ef",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
