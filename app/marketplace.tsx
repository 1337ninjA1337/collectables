import { Link, Stack } from "expo-router";
import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen, useResponsive } from "@/components/screen";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";
import { CollectableItem, MarketplaceListing, UserProfile } from "@/lib/types";

type ResolvedListing = {
  listing: MarketplaceListing;
  item: CollectableItem | undefined;
  owner: UserProfile | undefined;
};

export default function MarketplaceScreen() {
  const { t } = useI18n();
  const { activeListings, myPurchases } = useMarketplace();
  const { getItemById } = useCollections();
  const { getProfileById } = useSocial();
  const { isDesktop, isTablet } = useResponsive();

  const resolved = useMemo<ResolvedListing[]>(
    () =>
      activeListings.map((listing) => ({
        listing,
        item: getItemById(listing.itemId),
        owner: getProfileById(listing.ownerUserId),
      })),
    [activeListings, getItemById, getProfileById],
  );

  const purchases = useMemo<ResolvedListing[]>(
    () =>
      myPurchases.map((listing) => ({
        listing,
        item: getItemById(listing.itemId),
        owner: getProfileById(listing.ownerUserId),
      })),
    [myPurchases, getItemById, getProfileById],
  );

  const columns = isDesktop ? 3 : isTablet ? 2 : 1;

  return (
    <Screen>
      <Stack.Screen options={{ title: t("marketplaceTitle") }} />
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("marketplaceEyebrow")}</Text>
        <Text style={styles.title}>{t("marketplaceTitle")}</Text>
        <Text style={styles.subtitle}>{t("marketplaceSubtitle")}</Text>
      </View>

      {resolved.length === 0 ? (
        <EmptyState
          icon="🛍️"
          title={t("marketplaceEmptyTitle")}
          hint={t("marketplaceEmpty")}
        />
      ) : (
        <View style={styles.grid}>
          {resolved.map(({ listing, item, owner }) => (
            <View
              key={listing.id}
              style={{ ...styles.cardWrap, flexBasis: `${100 / columns}%` }}
            >
              <ListingCard listing={listing} item={item} owner={owner} />
            </View>
          ))}
        </View>
      )}

      {purchases.length > 0 ? (
        <View style={styles.purchasesSection}>
          <Text style={styles.sectionTitle}>{t("marketplaceMyPurchasesTitle")}</Text>
          <View style={styles.grid}>
            {purchases.map(({ listing, item, owner }) => (
              <View
                key={listing.id}
                style={{ ...styles.cardWrap, flexBasis: `${100 / columns}%` }}
              >
                <ListingCard listing={listing} item={item} owner={owner} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function ListingCard({
  listing,
  item,
  owner,
}: {
  listing: MarketplaceListing;
  item: CollectableItem | undefined;
  owner: UserProfile | undefined;
}) {
  const { t } = useI18n();
  const photo = item?.photos?.find(Boolean);
  const title = item?.title ?? t("marketplaceUnknownItem");
  const ownerName = owner?.displayName ?? t("unknownUser");
  const modeLabel = listing.mode === "trade" ? t("marketplaceModeTrade") : t("marketplaceModeSell");
  const priceLabel =
    listing.mode === "sell" && typeof listing.askingPrice === "number"
      ? `${listing.askingPrice} ${listing.currency}`
      : null;

  return (
    <Link href={`/listing/${listing.id}` as never} asChild>
      <Pressable style={styles.card}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} />
        ) : (
          <View style={{ ...styles.photo, backgroundColor: placeholderColor(listing.id) }} />
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.cardOwner} numberOfLines={1}>{ownerName}</Text>
          <View style={styles.cardMetaRow}>
            <View
              style={{
                ...styles.modeBadge,
                backgroundColor: listing.mode === "sell" ? "#d89c5b" : "#3a7d4f",
              }}
            >
              <Text style={styles.modeBadgeText}>{modeLabel}</Text>
            </View>
            {priceLabel ? <Text style={styles.cardPrice}>{priceLabel}</Text> : null}
          </View>
        </View>
      </Pressable>
    </Link>
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
  },
  cardWrap: {
    padding: 6,
  },
  card: {
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: 180,
    backgroundColor: "#d8c7b1",
  },
  cardBody: {
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#2f2318",
  },
  cardOwner: {
    color: "#8f6947",
    fontSize: 13,
    fontWeight: "700",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modeBadgeText: {
    color: "#fff7ef",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardPrice: {
    color: "#261b14",
    fontWeight: "800",
    fontSize: 14,
  },
  purchasesSection: {
    marginTop: 24,
    gap: 12,
  },
  sectionTitle: {
    color: "#2f2318",
    fontSize: 20,
    fontWeight: "800",
  },
});
