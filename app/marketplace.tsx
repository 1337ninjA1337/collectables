import { Link, Stack } from "expo-router";
import { useCallback, useMemo } from "react";
import { DimensionValue, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { RealtimeStatusPill } from "@/components/realtime-status-pill";
import { Screen, useResponsive } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_MUTED_3,
  BORDER,
  CARD_BG,
  HERO_DARK,
  MUTED,
  PAGE_BG,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  SHADOW_SOFT,
  SUCCESS_GREEN,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { FONT_DISPLAY_EDITORIAL } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { recentlySoldListings } from "@/lib/marketplace-helpers";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";
import { useToast } from "@/lib/toast-context";
import { CollectableItem, MarketplaceListing, UserProfile } from "@/lib/types";

type ResolvedListing = {
  listing: MarketplaceListing;
  item: CollectableItem | undefined;
  owner: UserProfile | undefined;
};

export default function MarketplaceScreen() {
  const { t } = useI18n();
  const theme = useAppTheme();
  const { activeListings, myPurchases, mySales, listings, markListingReceived } = useMarketplace();
  const { getItemById } = useCollections();
  const { getProfileById } = useSocial();
  const { isDesktop, isTablet } = useResponsive();
  const toast = useToast();

  const handleMarkReceived = useCallback(
    (id: string) => {
      markListingReceived(id);
      toast.success(t("marketplaceMarkReceivedSuccess"));
    },
    [markListingReceived, toast, t],
  );

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

  const sales = useMemo<ResolvedListing[]>(
    () =>
      mySales.map((listing) => ({
        listing,
        item: getItemById(listing.itemId),
        owner: getProfileById(listing.ownerUserId),
      })),
    [mySales, getItemById, getProfileById],
  );

  const recentlySold = useMemo<ResolvedListing[]>(
    () =>
      recentlySoldListings(listings).map((listing) => ({
        listing,
        item: getItemById(listing.itemId),
        owner: getProfileById(listing.ownerUserId),
      })),
    [listings, getItemById, getProfileById],
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

      <RealtimeStatusPill />

      {resolved.length === 0 ? (
        <EmptyState
          icon="🛍️"
          title={t("marketplaceEmptyTitle")}
          hint={t("marketplaceEmpty")}
        />
      ) : (
        <ListingGrid data={resolved} columns={columns} />
      )}

      {purchases.length > 0 ? (
        <View style={styles.purchasesSection}>
          <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("marketplaceMyPurchasesTitle")}</Text>
          <ListingGrid data={purchases} columns={columns} fromSeller onMarkReceived={handleMarkReceived} />
        </View>
      ) : null}

      {sales.length > 0 ? (
        <View style={styles.purchasesSection}>
          <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("marketplaceMySalesTitle")}</Text>
          <ListingGrid
            data={sales}
            columns={columns}
            sellerView
            resolveBuyer={(listing) =>
              listing.buyerUserId ? getProfileById(listing.buyerUserId) : undefined
            }
          />
        </View>
      ) : null}

      {recentlySold.length > 0 ? (
        <View style={styles.purchasesSection}>
          <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("marketplaceRecentlySoldTitle")}</Text>
          <ListingGrid
            data={recentlySold}
            columns={columns}
            resolveBuyer={(listing) =>
              listing.buyerUserId ? getProfileById(listing.buyerUserId) : undefined
            }
          />
        </View>
      ) : null}
    </Screen>
  );
}

function ListingGrid({
  data,
  columns,
  fromSeller,
  sellerView,
  resolveBuyer,
  onMarkReceived,
}: {
  data: ResolvedListing[];
  columns: number;
  fromSeller?: boolean;
  sellerView?: boolean;
  resolveBuyer?: (listing: MarketplaceListing) => UserProfile | undefined;
  onMarkReceived?: (id: string) => void;
}) {
  const { t } = useI18n();
  const cardWrapStyle = useMemo(
    () => ({ ...styles.cardWrap, flexBasis: `${100 / columns}%` as DimensionValue }),
    [columns],
  );
  return (
    <View style={styles.grid}>
      {data.map(({ listing, item, owner }) => (
        <View key={listing.id} style={cardWrapStyle}>
          <ListingCard
            listing={listing}
            item={item}
            owner={owner}
            fromSeller={fromSeller}
            sellerView={sellerView}
            buyer={resolveBuyer ? resolveBuyer(listing) : undefined}
          />
          {/* Buyer-only receipt affordance: a "Mark as received" button while
              the purchase hasn't arrived, flipping to a "Received" badge once
              `arrivedAt` is stamped. Rendered outside the card's Link so the
              tap confirms receipt instead of navigating to the detail page. */}
          {onMarkReceived ? (
            listing.arrivedAt == null ? (
              <Pressable
                style={styles.receiveButton}
                onPress={() => onMarkReceived(listing.id)}
                accessibilityRole="button"
                accessibilityLabel={t("marketplaceMarkReceived")}
              >
                <Text style={styles.receiveButtonText}>{t("marketplaceMarkReceived")}</Text>
              </Pressable>
            ) : (
              <View style={styles.receivedBadge}>
                <Text style={styles.receivedBadgeText}>{t("marketplaceReceivedBadge")}</Text>
              </View>
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ListingCard({
  listing,
  item,
  owner,
  buyer,
  fromSeller,
  sellerView,
}: {
  listing: MarketplaceListing;
  item: CollectableItem | undefined;
  owner: UserProfile | undefined;
  buyer?: UserProfile | undefined;
  fromSeller?: boolean;
  sellerView?: boolean;
}) {
  const { t, formatRelativeDate, relativeDateLabel } = useI18n();
  const theme = useAppTheme();
  const deliveryConfirmedLabel =
    sellerView && listing.arrivedAt
      ? relativeDateLabel(t("marketplaceDeliveryConfirmed"), formatRelativeDate(listing.arrivedAt))
      : null;
  const photo = item?.photos?.find(Boolean);
  const title = item?.title ?? t("marketplaceUnknownItem");
  const ownerName = owner?.displayName ?? t("unknownUser");
  const modeLabel = listing.mode === "trade" ? t("marketplaceModeTrade") : t("marketplaceModeSell");
  const priceLabel =
    listing.mode === "sell" && typeof listing.askingPrice === "number"
      ? `${listing.askingPrice} ${listing.currency}`
      : null;
  const isTransferred = listing.soldAt !== null && listing.buyerUserId !== null;
  const buyerHandle = buyer ? `@${buyer.username ?? buyer.publicId ?? buyer.id}` : null;
  const sellerHandle =
    fromSeller && owner ? `@${owner.username ?? owner.publicId ?? owner.id}` : null;

  return (
    <Link href={`/listing/${listing.id}` as never} asChild>
      <Pressable style={{ ...styles.card, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} />
        ) : (
          <View style={{ ...styles.photo, backgroundColor: placeholderColor(listing.id) }} />
        )}
        {isTransferred ? (
          <View style={styles.transferredBadge}>
            <Text style={styles.transferredBadgeText}>
              {t("marketplaceTransferredBadge")}
            </Text>
          </View>
        ) : null}
        <View style={styles.cardBody}>
          <Text style={{ ...styles.cardTitle, color: theme.text }} numberOfLines={2}>{title}</Text>
          <Text style={{ ...styles.cardOwner, color: theme.meta }} numberOfLines={1}>{ownerName}</Text>
          {sellerHandle ? (
            <View style={styles.soldToPill}>
              <Text style={styles.soldToPillText} numberOfLines={1}>
                {t("marketplaceBoughtFrom", { name: sellerHandle })}
              </Text>
            </View>
          ) : null}
          {buyerHandle ? (
            <View style={styles.soldToPill}>
              <Text style={styles.soldToPillText} numberOfLines={1}>
                {t("marketplaceSoldTo", { name: buyerHandle })}
              </Text>
            </View>
          ) : null}
          {/* Seller-only "Delivery confirmed {when}" signal once the buyer has
              stamped `arrivedAt` — gives the seller a delivery-confirmed cue and
              unlocks dispute handling. Relative date via the shared helper. */}
          {deliveryConfirmedLabel ? (
            <View style={styles.deliveryConfirmedPill}>
              <Text style={styles.deliveryConfirmedPillText} numberOfLines={1}>
                {deliveryConfirmedLabel}
              </Text>
            </View>
          ) : null}
          <View style={styles.cardMetaRow}>
            <View
              style={{
                ...styles.modeBadge,
                backgroundColor: listing.mode === "sell" ? AMBER_ACCENT : SUCCESS_GREEN,
              }}
            >
              <Text style={styles.modeBadgeText}>{modeLabel}</Text>
            </View>
            {priceLabel ? <Text style={{ ...styles.cardPrice, color: theme.text }}>{priceLabel}</Text> : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: HERO_DARK,
    borderRadius: RADIUS_HERO_LG,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  title: {
    color: PAGE_BG,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
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
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: 180,
    backgroundColor: AMBER_MUTED_3,
  },
  cardBody: {
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_DARK,
  },
  cardOwner: {
    color: MUTED,
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
    color: TEXT_ON_DARK,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardPrice: {
    color: HERO_DARK,
    fontWeight: "800",
    fontSize: 14,
  },
  transferredBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: SUCCESS_GREEN,
  },
  transferredBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  soldToPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: AMBER_MUTED_3,
    borderWidth: 1,
    borderColor: BORDER,
  },
  soldToPillText: {
    color: HERO_DARK,
    fontSize: 12,
    fontWeight: "700",
  },
  deliveryConfirmedPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: SUCCESS_GREEN,
  },
  deliveryConfirmedPillText: {
    color: TEXT_ON_DARK,
    fontSize: 12,
    fontWeight: "700",
  },
  purchasesSection: {
    marginTop: 24,
    gap: 12,
  },
  sectionTitle: {
    color: TEXT_DARK,
    fontSize: 20,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  receiveButton: {
    marginTop: 8,
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 12,
    alignItems: "center",
  },
  receiveButtonText: {
    color: TEXT_ON_DARK,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  receivedBadge: {
    marginTop: 8,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: SUCCESS_GREEN,
  },
  receivedBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
