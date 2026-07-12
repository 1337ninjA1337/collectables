import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";

import { EmptyState } from "@/components/empty-state";
import { SkeletonProfile } from "@/components/skeleton";

import { CollectionCard } from "@/components/collection-card";
import { Screen } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { uploadImage } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { purchasesForUser, salesForUser } from "@/lib/marketplace-helpers";
import {
  AMBER_LIGHT,
  AMBER_MUTED_5,
  AMBER_SOFT,
  BORDER,
  BORDER_2,
  CARD_BG,
  CARD_BG_3,
  DANGER_DEEP_2,
  HERO_DARK,
  HERO_DARK_2,
  MUTED_2,
  MUTED_8,
  MUTED_18,
  MUTED_19,
  PLACEHOLDER,
  PURE_WHITE,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { FONT_DISPLAY_EDITORIAL } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { useToast } from "@/lib/toast-context";
import { fetchCollectionsByUserId, fetchPublicCollectionsByUserId, fetchItemsByCollectionId, fetchWishlistItemsByUserId } from "@/lib/supabase-profiles";
import { placeholderColor } from "@/lib/placeholder-color";
import { CollectableItem, Collection, MarketplaceListing, UserProfile } from "@/lib/types";

const DEFAULT_EN_PROFILE_BIO = "I collect things worth saving beautifully and sharing with friends.";

export default function ProfileScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const theme = useAppTheme();
  const toast = useToast();
  const {
    getProfileById,
    getMyProfile,
    getRelationship,
    ensureProfilesLoaded,
    addFriend,
    removeFriend,
    followProfile,
    unfollowProfile,
    updateMyProfile,
    deleteProfile,
    isAdmin,
    friends,
  } = useSocial();
  const { collections, getItemsForCollection, getCollectionTotalCost, deleteUserContent, wishlistItems, getItemById } = useCollections();
  const { listings } = useMarketplace();
  const cachedProfile = getProfileById(params.id);
  const myProfile = getMyProfile();
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [profileIdDraft, setProfileIdDraft] = useState("");
  const [editingHandle, setEditingHandle] = useState(false);
  const [remoteCollections, setRemoteCollections] = useState<Collection[]>([]);
  const [remoteItemCounts, setRemoteItemCounts] = useState<Record<string, number>>({});
  const [remoteWishlist, setRemoteWishlist] = useState<CollectableItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const isSelf = myProfile?.id === params.id;
  const isFriend = friends.includes(params.id);

  useFocusEffect(
    useCallback(() => {
      if (!params.id || params.id === "[id]") return;

      let active = true;
      const needsProfileFetch = !cachedProfile;
      if (needsProfileFetch) setLoadingRemote(true);

      const profilePromise = needsProfileFetch
        ? ensureProfilesLoaded([params.id])
        : Promise.resolve();

      const collectionsPromise = isSelf
        ? fetchCollectionsByUserId(params.id)
        : fetchPublicCollectionsByUserId(params.id);

      const wishlistPromise = (isSelf || isFriend)
        ? fetchWishlistItemsByUserId(params.id)
        : Promise.resolve([]);

      Promise.all([profilePromise, collectionsPromise, wishlistPromise])
        .then(([, cols, wish]) => {
          if (!active) return;
          setRemoteCollections(cols);
          setRemoteWishlist(wish);
          return loadItemCounts(cols, () => active);
        })
        .catch(() => {})
        .finally(() => {
          if (active && needsProfileFetch) setLoadingRemote(false);
        });

      return () => {
        active = false;
      };
    }, [cachedProfile, params.id, isSelf, isFriend, ensureProfilesLoaded]),
  );

  async function loadItemCounts(cols: Collection[], isActive: () => boolean = () => true) {
    const counts: Record<string, number> = {};
    const results = await Promise.all(
      cols.map((c) => fetchItemsByCollectionId(c.id).then((items) => ({ id: c.id, count: items.length })))
    );
    if (!isActive()) return;
    results.forEach((r) => { counts[r.id] = r.count; });
    setRemoteItemCounts(counts);
  }

  const handleRefresh = useCallback(async () => {
    if (!params.id || params.id === "[id]") return;
    setRefreshing(true);
    try {
      ensureProfilesLoaded([params.id]);
      const [cols, wish] = await Promise.all([
        isSelf ? fetchCollectionsByUserId(params.id) : fetchPublicCollectionsByUserId(params.id),
        (isSelf || isFriend) ? fetchWishlistItemsByUserId(params.id) : Promise.resolve([]),
      ]);
      setRemoteCollections(cols);
      setRemoteWishlist(wish);
      await loadItemCounts(cols);
    } catch {} finally { setRefreshing(false); }
  }, [params.id, isSelf, isFriend, ensureProfilesLoaded]);

  const profile = cachedProfile;
  const activeProfile = profile;
  const relationship = activeProfile ? getRelationship(activeProfile.id) : "none" as const;
  const localProfileCollections = activeProfile
    ? collections.filter((collection) => collection.ownerUserId === activeProfile.id)
    : [];
  // Use remote collections if no local ones found (other user's profile)
  const profileCollections = localProfileCollections.length > 0 ? localProfileCollections : remoteCollections;
  const visibleWishlist = isSelf ? wishlistItems : remoteWishlist;
  const myPurchases = useMemo<MarketplaceListing[]>(
    () => (isSelf && activeProfile ? purchasesForUser(listings, activeProfile.id) : []),
    [isSelf, activeProfile, listings],
  );
  const mySales = useMemo<MarketplaceListing[]>(
    () => (isSelf && activeProfile ? salesForUser(listings, activeProfile.id) : []),
    [isSelf, activeProfile, listings],
  );
  const localizedBio = activeProfile
    ? (activeProfile.bio === DEFAULT_EN_PROFILE_BIO ? t("defaultProfileBio") : activeProfile.bio)
    : "";

  useEffect(() => {
    if (activeProfile) {
      setBioDraft(activeProfile.bio === DEFAULT_EN_PROFILE_BIO ? t("defaultProfileBio") : activeProfile.bio);
      setProfileIdDraft(activeProfile.username);
    }
  }, [activeProfile?.bio, activeProfile?.username, t]);

  if (loadingRemote && !activeProfile) {
    return (
      <Screen>
        <SkeletonProfile />
      </Screen>
    );
  }

  if (!activeProfile) {
    return (
      <Screen>
        <Text style={{ ...styles.emptyTitle, color: theme.text }}>{t("profileNotFound")}</Text>
      </Screen>
    );
  }

  async function pickAvatarFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error(t("noAccessCover"), t("noAccess"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      const localUri = result.assets[0]?.uri;
      if (localUri) {
        const cloudUrl = await uploadImage(localUri);
        await updateMyProfile({ avatar: cloudUrl });
      }
    }
  }

  async function takeAvatarPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.error(t("noAccessCamera"), t("noAccess"));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled) {
      const localUri = result.assets[0]?.uri;
      if (localUri) {
        const cloudUrl = await uploadImage(localUri);
        await updateMyProfile({ avatar: cloudUrl });
      }
    }
  }

  function handleChangeAvatar() {
    if (Platform.OS === "web") {
      void pickAvatarFromGallery();
      return;
    }
    Alert.alert(t("changeProfilePhoto"), undefined, [
      { text: t("pickFromGallery"), onPress: () => void pickAvatarFromGallery() },
      { text: t("takePhoto"), onPress: () => void takeAvatarPhoto() },
      { text: t("cancel"), style: "cancel" },
    ]);
  }

  async function handleSaveBio() {
    await updateMyProfile({
      bio: bioDraft.trim() || localizedBio,
    });
  }

  async function handleSaveProfileId() {
    if (!activeProfile) return;
    await updateMyProfile({
      username: profileIdDraft.trim() || activeProfile.username,
    });
    setEditingHandle(false);
  }

  async function performAdminDelete() {
    if (!activeProfile) return;
    await deleteUserContent(activeProfile.id);
    await deleteProfile(activeProfile.id);
    router.replace("/people");
  }

  function handleAdminDelete() {
    if (!activeProfile || !isAdmin || relationship === "self") {
      return;
    }

    const title = t("adminDeleteProfileTitle");
    const message = t("adminDeleteProfileText", { name: activeProfile.displayName });

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(`${title}\n\n${message}`) ?? false;
      if (confirmed) {
        void performAdminDelete();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => void performAdminDelete(),
      },
    ]);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: activeProfile.displayName }} />
      <View style={styles.hero}>
        {relationship === "self" ? (
          <Pressable
            style={styles.settingsIcon}
            onPress={() => router.push("/settings")}
            accessibilityLabel={t("settings")}
          >
            <Ionicons name="settings-outline" size={22} color={TEXT_ON_DARK_4} />
          </Pressable>
        ) : null}
        <Image source={{ uri: activeProfile.avatar }} style={styles.avatar} />
        {relationship === "self" ? (
          <Pressable style={styles.editAvatarButton} onPress={handleChangeAvatar}>
            <Text style={styles.editAvatarButtonText}>{t("changeProfilePhoto")}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.name}>{activeProfile.displayName}</Text>
        <View style={styles.handleRow}>
          {editingHandle && relationship === "self" ? (
            <>
              <Text style={styles.handlePrefix}>@</Text>
              <MaskedTextInput
                value={profileIdDraft}
                onChangeText={setProfileIdDraft}
                placeholder={t("profileIdPlaceholder")}
                placeholderTextColor={MUTED_19}
                autoCapitalize="none"
                style={styles.handleInput}
              />
              <Pressable style={styles.handleAction} onPress={() => void handleSaveProfileId()}>
                <Text style={styles.handleActionText}>OK</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.username}>@{activeProfile.username}</Text>
              {relationship === "self" ? (
                <Pressable style={styles.handleAction} onPress={() => setEditingHandle(true)}>
                  <Text style={styles.handleActionText}>Edit</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
        <Text style={styles.bio}>{localizedBio}</Text>
      </View>

      {relationship === "self" ? (
        <View style={styles.selfTools}>
          <View style={{ ...styles.languageCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
            <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("descriptionLabel")}</Text>
            <Text style={{ ...styles.sectionText, color: theme.meta }}>{t("descriptionPlaceholder")}</Text>
            <MaskedTextInput
              value={bioDraft}
              onChangeText={setBioDraft}
              placeholder={t("descriptionPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              multiline
              textAlignVertical="top"
              style={{ ...styles.bioInput, backgroundColor: theme.page, borderColor: theme.border, color: theme.text }}
            />
            <Pressable style={styles.saveBioButton} onPress={() => void handleSaveBio()}>
              <Text style={styles.saveBioButtonText}>{t("saveProfileDescription")}</Text>
            </Pressable>
          </View>

        </View>
      ) : (
        <View style={styles.actions}>
          {isAdmin ? (
            <Pressable style={styles.adminAction} onPress={handleAdminDelete}>
              <Text style={styles.adminActionText}>{t("adminDeleteProfile")}</Text>
            </Pressable>
          ) : null}
          {relationship === "friend" ? (
            <>
              <Pressable
                style={styles.primaryAction}
                onPress={() => router.push(`/chat/${activeProfile.id}` as never)}
              >
                <Text style={styles.primaryActionText}>{t("chatSend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("removeFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void unfollowProfile(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("unfollow")}</Text>
              </Pressable>
            </>
          ) : relationship === "request_sent" ? (
            <>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{t("requestSent")}</Text>
              </View>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("cancelInvitation")}</Text>
              </Pressable>
            </>
          ) : relationship === "request_received" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("acceptRequest")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("rejectRequest")}</Text>
              </Pressable>
            </>
          ) : relationship === "following" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("addFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void unfollowProfile(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("unfollow")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("addFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void followProfile(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("follow")}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("profileCollections")}</Text>
        {profileCollections.length > 0 ? (
          profileCollections.map((collection) => {
            const total = getCollectionTotalCost(collection.id);
            return (
              <CollectionCard
                key={collection.id}
                collection={collection}
                count={getItemsForCollection(collection.id).length || remoteItemCounts[collection.id] || 0}
                totalCost={total.amount}
                totalCostCurrency={total.currency}
              />
            );
          })
        ) : (
          <EmptyState
            icon="🔒"
            title={t("emptyProfileCollectionsTitle")}
            hint={t("emptyProfileCollectionsHint")}
            actionLabel={t("findPeople")}
            onAction={() => router.push("/people")}
          />
        )}
      </View>

      {isSelf ? (
        <View style={styles.section}>
          <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("marketplaceHistoryTitle")}</Text>
          {myPurchases.length === 0 && mySales.length === 0 ? (
            <EmptyState icon="🛍️" title={t("marketplaceHistoryEmpty")} />
          ) : (
            <>
              <Text style={styles.historyLabel}>{t("marketplaceHistoryPurchasesLabel")}</Text>
              {myPurchases.length > 0 ? (
                myPurchases.map((listing) => (
                  <MarketplaceHistoryRow
                    key={listing.id}
                    listing={listing}
                    item={getItemById(listing.itemId)}
                    counterparty={getProfileById(listing.ownerUserId)}
                  />
                ))
              ) : (
                <Text style={{ ...styles.historyEmpty, color: theme.meta }}>{t("marketplaceMyPurchasesEmpty")}</Text>
              )}
              <Text style={styles.historyLabel}>{t("marketplaceHistorySalesLabel")}</Text>
              {mySales.length > 0 ? (
                mySales.map((listing) => (
                  <MarketplaceHistoryRow
                    key={listing.id}
                    listing={listing}
                    item={getItemById(listing.itemId)}
                    counterparty={listing.buyerUserId ? getProfileById(listing.buyerUserId) : undefined}
                  />
                ))
              ) : (
                <Text style={{ ...styles.historyEmpty, color: theme.meta }}>{t("marketplaceMySalesEmpty")}</Text>
              )}
            </>
          )}
        </View>
      ) : null}

      {(isSelf || isFriend) && (
        <View style={styles.section}>
          <Text style={{ ...styles.sectionTitle, color: theme.text }}>{t("profileWishlist")}</Text>
          {visibleWishlist.length > 0 ? (
            visibleWishlist.map((item) => (
              <Link key={item.id} href={`/item/${item.id}`} asChild>
                <Pressable style={{ ...styles.wishlistCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
                  {item.photos?.[0] ? (
                    <Image source={{ uri: item.photos[0] }} style={styles.wishlistThumb} />
                  ) : (
                    <View style={[styles.wishlistThumb, { backgroundColor: placeholderColor(item.id) }]} />
                  )}
                  <View style={styles.wishlistInfo}>
                    <Text style={{ ...styles.wishlistName, color: theme.text }} numberOfLines={1}>{item.title}</Text>
                    {item.description ? (
                      <Text style={{ ...styles.wishlistDesc, color: theme.muted }} numberOfLines={2}>{item.description}</Text>
                    ) : null}
                  </View>
                </Pressable>
              </Link>
            ))
          ) : (
            <EmptyState
              icon="🎁"
              title={t("emptyProfileWishlistTitle")}
              hint={t("emptyProfileWishlistHint")}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

function MarketplaceHistoryRow({
  listing,
  item,
  counterparty,
}: {
  listing: MarketplaceListing;
  item: CollectableItem | undefined;
  counterparty: UserProfile | undefined;
}) {
  const { t } = useI18n();
  const theme = useAppTheme();
  const photo = item?.photos?.find(Boolean);
  const title = item?.title ?? t("marketplaceUnknownItem");
  const counterpartyHandle = counterparty
    ? `@${counterparty.username ?? counterparty.publicId ?? counterparty.id}`
    : t("unknownUser");
  const modeLabel = listing.mode === "trade" ? t("marketplaceModeTrade") : t("marketplaceModeSell");
  const priceLabel =
    listing.mode === "sell" && typeof listing.askingPrice === "number"
      ? `${listing.askingPrice} ${listing.currency}`
      : null;

  return (
    <Link href={`/listing/${listing.id}` as never} asChild>
      <Pressable style={{ ...styles.wishlistCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.wishlistThumb} />
        ) : (
          <View style={[styles.wishlistThumb, { backgroundColor: placeholderColor(listing.id) }]} />
        )}
        <View style={styles.wishlistInfo}>
          <Text style={{ ...styles.wishlistName, color: theme.text }} numberOfLines={1}>{title}</Text>
          <Text style={{ ...styles.wishlistDesc, color: theme.muted }} numberOfLines={1}>{counterpartyHandle}</Text>
          <View style={styles.historyMetaRow}>
            <Text style={styles.historyMode}>{modeLabel}</Text>
            {priceLabel ? <Text style={{ ...styles.historyPrice, color: theme.text }}>{priceLabel}</Text> : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: RADIUS_HERO_LG,
    backgroundColor: HERO_DARK,
    padding: 24,
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  settingsIcon: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 244, 229, 0.12)",
    borderWidth: 1,
    borderColor: MUTED_18,
    zIndex: 2,
  },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: AMBER_MUTED_5,
  },
  editAvatarButton: {
    borderRadius: RADIUS_PILL,
    backgroundColor: "rgba(255, 244, 229, 0.12)",
    borderWidth: 1,
    borderColor: MUTED_18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  editAvatarButtonText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
  },
  name: {
    color: TEXT_ON_DARK,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  username: {
    color: AMBER_LIGHT,
    fontWeight: "700",
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  handlePrefix: {
    color: AMBER_LIGHT,
    fontWeight: "700",
    fontSize: 16,
  },
  handleInput: {
    minWidth: 120,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: MUTED_18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: TEXT_ON_DARK,
    fontSize: 15,
    fontWeight: "700",
  },
  handleAction: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: MUTED_18,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  handleActionText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
  },
  bio: {
    color: TEXT_ON_DARK_SOFT,
    lineHeight: 22,
    textAlign: "center",
  },
  languageCard: {
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: 12,
  },
  selfTools: {
    gap: 14,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
  },
  secondaryAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryActionText: {
    color: HERO_DARK_2,
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: RADIUS_PILL,
    backgroundColor: BORDER_2,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusBadgeText: {
    color: MUTED_8,
    fontWeight: "800",
  },
  adminAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: DANGER_DEEP_2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  adminActionText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  sectionText: {
    color: MUTED_2,
    lineHeight: 22,
  },
  bioInput: {
    minHeight: 120,
    borderRadius: 20,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: TEXT_DARK,
    fontSize: 15,
    lineHeight: 22,
  },
  saveBioButton: {
    alignSelf: "flex-start",
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  saveBioButtonText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: TEXT_DARK_3,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  wishlistCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  wishlistThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  wishlistInfo: {
    flex: 1,
    gap: 2,
  },
  wishlistName: {
    fontSize: 15,
    fontWeight: "700",
    color: TEXT_DARK,
  },
  wishlistDesc: {
    fontSize: 13,
    color: MUTED_2,
    lineHeight: 18,
  },
  historyLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: HERO_DARK_2,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  historyEmpty: {
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
  },
  historyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  historyMode: {
    fontSize: 12,
    fontWeight: "800",
    color: HERO_DARK_2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  historyPrice: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT_DARK,
  },
});
