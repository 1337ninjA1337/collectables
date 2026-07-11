import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";

import { CurrencyInput, getDefaultCurrencyForLanguage, parseCurrencyValue } from "@/components/currency-input";
import { getUserPreferredCurrency, setUserPreferredCurrency } from "@/lib/locale-helpers";
import { SkeletonItemDetail } from "@/components/skeleton";

import { PhotoPreview } from "@/components/photo-preview";
import { ReactionBar } from "@/components/reaction-bar";
import { Screen, useResponsive } from "@/components/screen";
import { useAppTheme, type AppTheme } from "@/components/use-app-theme";
import { trackEvent } from "@/lib/analytics";
import { hasReplacedPhotoSet } from "@/lib/analytics-helpers";
import { isRisingEdge } from "@/lib/use-transition-event";
import { buildDeepLink } from "@/lib/deep-link";
import { useAuth } from "@/lib/auth-context";
import { uploadImages } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { formatCostAmount } from "@/lib/item-cost";
import { useI18n } from "@/lib/i18n-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { usePremium } from "@/lib/premium-context";
import { fetchItemById } from "@/lib/supabase-profiles";
import { useToast } from "@/lib/toast-context";
import { CollectableItem, ItemCondition, ItemTag, MarketplaceMode } from "@/lib/types";
import { FONT_DISPLAY, FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import {
  ACCENT_DEEP,
  AMBER_ACCENT,
  AMBER_MUTED_4,
  AMBER_SOFT,
  BORDER,
  BORDER_2,
  CARD_BG,
  CARD_BG_3,
  CARD_BG_12,
  DANGER,
  DANGER_DEEP_6,
  DANGER_SOFT_4,
  HERO_DARK,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_10,
  PLACEHOLDER,
  RADIUS_ITEM_AIRY,
  SHADOW_SOFT,
  SPACING_GUTTER,
  SUCCESS_GREEN,
  SUCCESS_GREEN_2,
  TAG_BLUE,
  TAG_BROWN,
  TAG_CYAN,
  TAG_GOLD,
  TAG_PURPLE,
  TAG_RUST,
  TAG_SAGE,
  TAG_TEAL,
  TAG_TERRACOTTA,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_3,
  TEXT_DARK_4,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";

const TAG_COLORS = [
  AMBER_ACCENT, TAG_RUST, TAG_SAGE, TAG_BLUE, TAG_PURPLE,
  TAG_TERRACOTTA, TAG_CYAN, TAG_GOLD, TAG_BROWN, TAG_TEAL,
];

export default function ItemDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { getItemById, getCollectionById, deleteItem, updateItem, refresh, convertItemCost } = useCollections();
  const { t, language } = useI18n();
  const theme = useAppTheme();
  const { width, contentMaxWidth } = useResponsive();
  // Edge-to-edge hero: fill the content column plus the screen gutters the
  // Screen wrapper adds, capped at the device width so desktop doesn't overflow.
  const heroWidth = Math.min(width, (contentMaxWidth ?? width) + SPACING_GUTTER * 2);
  const toast = useToast();
  const {
    findListingByItemId,
    myActiveListingCount,
    addListing,
    removeListing,
  } = useMarketplace();
  const { isPremium, ready: premiumReady } = usePremium();
  const localItem = getItemById(params.id);
  const [remoteItem, setRemoteItem] = useState<CollectableItem | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
      if (params.id && params.id !== "[id]") {
        const fresh = await fetchItemById(params.id);
        if (fresh) setRemoteItem(fresh);
      }
    } finally { setRefreshing(false); }
  }, [refresh, params.id]);

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAcquiredFrom, setEditAcquiredFrom] = useState("");
  const [editAcquiredAt, setEditAcquiredAt] = useState("");
  const [editVariants, setEditVariants] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editCurrency, setEditCurrencyState] = useState(() => getDefaultCurrencyForLanguage(language));
  const [editCondition, setEditCondition] = useState<ItemCondition | "">("");
  const [editTags, setEditTags] = useState<ItemTag[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [newLocalPhotos, setNewLocalPhotos] = useState<string[]>([]);

  const [listingSheetOpen, setListingSheetOpen] = useState(false);
  const [listingMode, setListingMode] = useState<MarketplaceMode>("trade");
  const [listingPrice, setListingPrice] = useState("");
  const [listingCurrency, setListingCurrencyState] = useState(() => getDefaultCurrencyForLanguage(language));
  function setListingCurrency(next: string) {
    setListingCurrencyState(next);
    void setUserPreferredCurrency(next);
  }
  function setEditCurrency(next: string) {
    setEditCurrencyState(next);
    void setUserPreferredCurrency(next);
  }
  useEffect(() => {
    let cancelled = false;
    void getUserPreferredCurrency().then((stored) => {
      if (cancelled || !stored) return;
      setListingCurrencyState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [listingNotes, setListingNotes] = useState("");

  useEffect(() => {
    if (!localItem && params.id && params.id !== "[id]") {
      setLoadingRemote(true);
      fetchItemById(params.id)
        .then((i) => setRemoteItem(i))
        .catch(() => {})
        .finally(() => setLoadingRemote(false));
    }
  }, [localItem, params.id]);

  const item = localItem ?? remoteItem;

  if (loadingRemote && !item) {
    return (
      <Screen>
        <SkeletonItemDetail />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <Text style={styles.emptyTitle}>{t("itemNotFound")}</Text>
      </Screen>
    );
  }

  const activeItem = item;
  const collection = getCollectionById(activeItem.collectionId);
  const isOwner = user?.id === activeItem.createdByUserId;
  const existingListing = findListingByItemId(activeItem.id);
  const overFreeCap = premiumReady && !isPremium && !existingListing && myActiveListingCount >= 1;

  function enterEditMode() {
    setEditTitle(activeItem.title);
    setEditDescription(activeItem.description);
    setEditAcquiredFrom(activeItem.acquiredFrom);
    setEditAcquiredAt(activeItem.acquiredAt);
    setEditVariants(activeItem.variants);
    setEditCost(typeof activeItem.cost === "number" ? String(activeItem.cost) : "");
    setEditCurrencyState(activeItem.costCurrency ?? getDefaultCurrencyForLanguage(language));
    void getUserPreferredCurrency().then((stored) => {
      if (!activeItem.costCurrency && stored) setEditCurrencyState(stored);
    });
    setEditCondition(activeItem.condition ?? "");
    setEditTags(activeItem.tags ?? []);
    setEditTagInput("");
    setEditPhotos([...activeItem.photos]);
    setNewLocalPhotos([]);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function pickEditPhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error(t("noAccessPhotos"), t("noAccess"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 5,
    });
    if (!result.canceled) {
      const uris = result.assets.map((a) => a.uri);
      setNewLocalPhotos(uris);
      setEditPhotos(uris);
    }
  }

  async function handleSaveEdit() {
    if (!editTitle.trim()) {
      toast.error(t("requiredFieldsMissing"), t("needMoreData"));
      return;
    }
    setSaving(true);
    try {
      const previousPhotos = activeItem.photos;
      const hadPhotosBefore = previousPhotos.length > 0;
      let finalPhotos = editPhotos;
      if (newLocalPhotos.length > 0) {
        finalPhotos = await uploadImages(newLocalPhotos);
      }
      const parsedCost = editCost.trim() ? Number(editCost.replace(",", ".")) : null;
      await updateItem(activeItem.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        acquiredFrom: editAcquiredFrom.trim(),
        acquiredAt: editAcquiredAt.trim(),
        variants: editVariants.trim(),
        cost: parsedCost !== null && !Number.isNaN(parsedCost) ? parsedCost : null,
        costCurrency: parsedCost !== null && !Number.isNaN(parsedCost) ? editCurrency : null,
        condition: editCondition || undefined,
        tags: editTags.length > 0 ? editTags : undefined,
        photos: finalPhotos,
      });
      if (isRisingEdge(hadPhotosBefore, finalPhotos.length > 0)) {
        trackEvent("item_photo_attached", {
          itemId: activeItem.id,
          collectionId: activeItem.collectionId,
        });
      } else if (hasReplacedPhotoSet(previousPhotos, finalPhotos)) {
        trackEvent("item_photos_replaced", {
          itemId: activeItem.id,
          collectionId: activeItem.collectionId,
          photoCount: finalPhotos.length,
        });
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const label = editTagInput.trim();
    if (label && !editTags.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
      setEditTags([...editTags, { label, color: TAG_COLORS[editTags.length % TAG_COLORS.length] }]);
      setEditTagInput("");
    }
  }

  async function confirmAndDeleteItem() {
    await deleteItem(activeItem.id);
    router.replace(collection ? `/collection/${collection.id}` : "/");
  }

  function openListingSheet() {
    setListingMode("trade");
    setListingPrice("");
    setListingCurrency("USD");
    setListingNotes("");
    setListingSheetOpen(true);
  }

  function closeListingSheet() {
    setListingSheetOpen(false);
  }

  function handleSubmitListing() {
    if (overFreeCap) return;
    let finalPrice: number | null = null;
    if (listingMode === "sell") {
      finalPrice = parseCurrencyValue(listingPrice);
      if (finalPrice === null) {
        toast.error(t("marketplacePriceInvalid"), t("marketplacePriceLabel"));
        return;
      }
    }
    const result = addListing({
      itemId: activeItem.id,
      mode: listingMode,
      askingPrice: finalPrice,
      currency: listingCurrency,
      notes: listingNotes,
      isPremium,
    });
    if (!result) {
      toast.error(t("marketplaceListingFailed"), t("marketplaceUpgradeHint"));
      return;
    }
    trackEvent("listing_created", {
      mode: listingMode,
      hasPrice: finalPrice !== null,
    });
    closeListingSheet();
    toast.success(t("marketplaceListingCreated"));
  }

  function handleRemoveListing() {
    if (!existingListing) return;
    removeListing(existingListing.id);
    toast.success(t("marketplaceListingRemoved"));
  }

  function handleDelete() {
    const message = `${t("deleteItemTitle")} ${t("deleteItemText")}`;

    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) {
        void confirmAndDeleteItem();
      }
      return;
    }

    Alert.alert(t("deleteItemTitle"), t("deleteItemText"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          void confirmAndDeleteItem();
        },
      },
    ]);
  }

  if (editing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("editItem") }} />
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{t("editItem")}</Text>
        </View>

        <EditField label={t("itemTitleLabel")} value={editTitle} onChangeText={setEditTitle} required />
        <EditField label={t("acquiredDateLabel")} value={editAcquiredAt} onChangeText={setEditAcquiredAt} />
        <EditField label={t("sourceLabel")} value={editAcquiredFrom} onChangeText={setEditAcquiredFrom} />
        <EditField label={t("descriptionLabel")} value={editDescription} onChangeText={setEditDescription} multiline />
        <EditField label={t("variantsLabel")} value={editVariants} onChangeText={setEditVariants} multiline />
        <View style={styles.editFieldGroup}>
          <Text style={styles.editLabel}>{t("costLabel")}</Text>
          <CurrencyInput
            value={editCost}
            currency={editCurrency}
            onChangeValue={setEditCost}
            onChangeCurrency={setEditCurrency}
            placeholder={t("costPlaceholder")}
          />
        </View>

        <View style={styles.editFieldGroup}>
          <Text style={styles.editLabel}>{t("conditionLabel")}</Text>
          <View style={styles.conditionRow}>
            {(["new", "excellent", "good", "fair"] as const).map((c) => {
              const selected = editCondition === c;
              return (
                <Pressable
                  key={c}
                  style={{...styles.conditionChip, ...(selected ? styles.conditionChipSelected : {})}}
                  onPress={() => setEditCondition(selected ? "" : c)}
                >
                  <Text style={{...styles.conditionChipText, ...(selected ? styles.conditionChipTextSelected : {})}}>
                    {t(`condition${c[0].toUpperCase()}${c.slice(1)}` as "conditionNew" | "conditionExcellent" | "conditionGood" | "conditionFair")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.editFieldGroup}>
          <Text style={styles.editLabel}>{t("tagsLabel")}</Text>
          {editTags.length > 0 ? (
            <View style={styles.tagsRow}>
              {editTags.map((tag, i) => (
                <Pressable key={i} style={{...styles.editTagChip, backgroundColor: tag.color}} onPress={() => setEditTags(editTags.filter((_, j) => j !== i))}>
                  <Text style={styles.editTagChipText}>{tag.label}</Text>
                  <Text style={styles.editTagChipRemove}>x</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.tagInputRow}>
            <MaskedTextInput
              style={styles.tagInput}
              value={editTagInput}
              onChangeText={setEditTagInput}
              placeholder={t("tagsPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              onSubmitEditing={addTag}
            />
            <Pressable
              style={{...styles.tagAddButton, ...(editTagInput.trim() ? {} : { opacity: 0.4 })}}
              onPress={addTag}
            >
              <Text style={styles.tagAddButtonText}>{t("tagsAdd")}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.editFieldGroup}>
          <Text style={styles.editLabel}>{t("photosLabel")}</Text>
          <Pressable style={styles.photoButton} onPress={() => void pickEditPhotos()}>
            <Text style={styles.photoButtonText}>{t("editPhotos")}</Text>
          </Pressable>
          <PhotoPreview photos={editPhotos} onChange={(p) => { setEditPhotos(p); setNewLocalPhotos(p); }} maxPhotos={5} />
        </View>

        <Pressable
          style={{...styles.saveButton, ...(saving ? styles.saveButtonDisabled : {})}}
          onPress={() => void handleSaveEdit()}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>{saving ? t("saving") : t("saveChanges")}</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={cancelEdit}>
          <Text style={styles.cancelButtonText}>{t("cancelEdit")}</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: activeItem.title }} />
      <View style={styles.photoHero}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {activeItem.photos.length > 0 ? (
            activeItem.photos.map((photo) => (
              <Image key={photo} source={{ uri: photo }} style={{ ...styles.heroImage, width: heroWidth }} />
            ))
          ) : (
            <View style={{ ...styles.heroImage, width: heroWidth, backgroundColor: placeholderColor(activeItem.id) }} />
          )}
        </ScrollView>
        {activeItem.condition ? (
          <View style={styles.heroBadges}>
            <View style={styles.conditionBadge}>
              <Text style={styles.conditionBadgeText}>
                {t(`condition${activeItem.condition[0].toUpperCase()}${activeItem.condition.slice(1)}` as "conditionNew" | "conditionExcellent" | "conditionGood" | "conditionFair")}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.titleBlock}>
        <Text style={{ ...styles.itemTitle, color: theme.text }}>{activeItem.title}</Text>
        <Text style={{ ...styles.itemMeta, color: theme.meta }}>{t("collectionField", { name: collection?.name ?? t("collectionMissing") })}</Text>
        <Text style={{ ...styles.itemMeta, color: theme.meta }}>{t("addedBy", { name: activeItem.createdBy })}</Text>
      </View>

      {activeItem.description ? (
        <Text style={{ ...styles.description, color: theme.muted }}>{activeItem.description}</Text>
      ) : null}

      <View style={styles.actionsRow}>
        {isOwner ? (
          <Pressable style={styles.editButton} onPress={enterEditMode}>
            <Text style={styles.editButtonText}>{t("editItem")}</Text>
          </Pressable>
        ) : null}
        <Pressable style={{ ...styles.ghostButton, borderColor: theme.border }} onPress={() => setShareOpen(true)}>
          <Text style={{ ...styles.ghostButtonText, color: theme.text }}>{t("share")}</Text>
        </Pressable>
        {isOwner ? (
          <Pressable style={styles.ghostDangerButton} onPress={handleDelete}>
            <Text style={styles.ghostDangerText}>{t("deleteItem")}</Text>
          </Pressable>
        ) : null}
      </View>

      {isOwner ? (
        existingListing ? (
          <View style={styles.listingStatusGroup}>
            <View style={styles.listingStatusBadge}>
              <Text style={styles.listingStatusText}>
                {existingListing.mode === "sell"
                  ? t("marketplaceListedForSale")
                  : t("marketplaceListedForTrade")}
              </Text>
            </View>
            <Pressable style={styles.listingRemoveButton} onPress={handleRemoveListing}>
              <Text style={styles.listingRemoveText}>{t("marketplaceRemoveListing")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.listingStatusGroup}>
            <Pressable
              style={{ ...styles.listingButton, ...(overFreeCap ? styles.listingButtonDisabled : {}) }}
              onPress={openListingSheet}
              disabled={overFreeCap}
            >
              <Text style={styles.listingButtonText}>{t("marketplaceListOnMarketplace")}</Text>
            </Pressable>
            {overFreeCap ? (
              <Text style={styles.listingHint}>{t("marketplaceUpgradeHint")}</Text>
            ) : null}
          </View>
        )
      ) : null}

      <View style={{ ...styles.metaCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        {activeItem.acquiredFrom ? (
          <MetaRow label={t("acquiredHow")} value={activeItem.acquiredFrom} theme={theme} />
        ) : null}
        {activeItem.acquiredAt ? (
          <MetaRow label={t("acquiredDate")} value={activeItem.acquiredAt} theme={theme} />
        ) : null}
        {activeItem.variants ? (
          <MetaRow label={t("variants")} value={activeItem.variants} theme={theme} />
        ) : null}
        {typeof activeItem.cost === "number" && Number.isFinite(activeItem.cost) ? (() => {
          const conv = convertItemCost(activeItem, collection?.currency ?? undefined);
          const amount = conv.amount ?? (activeItem.cost as number);
          const isApprox =
            conv.converted && activeItem.costCurrency != null && activeItem.costCurrency !== conv.currency;
          const display = isApprox
            ? t("itemValueApprox", { amount: formatCostAmount(amount), currency: conv.currency })
            : `${formatCostAmount(amount)} ${conv.currency}`;
          const original = `${formatCostAmount(activeItem.cost as number)}${activeItem.costCurrency ? ` ${activeItem.costCurrency}` : ""}`;
          return (
            <View style={styles.metaRow}>
              <Text style={{ ...styles.metaRowLabel, color: theme.meta }}>{t("costLabel")}</Text>
              <Pressable
                onLongPress={() => toast.info(original)}
                accessibilityLabel={`${t("costLabel")}: ${original}`}
                {...(Platform.OS === "web" ? ({ title: original } as object) : null)}
              >
                <Text style={{ ...styles.metaRowValue, color: theme.text }}>{display}</Text>
              </Pressable>
            </View>
          );
        })() : null}
        <MetaRow label={t("photosLabel")} value={String(activeItem.photos.length)} theme={theme} />
      </View>

      {activeItem.tags && activeItem.tags.length > 0 ? (
        <View style={{ ...styles.metaCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
          <Text style={{ ...styles.metaRowLabel, color: theme.meta }}>{t("tagsLabel")}</Text>
          <View style={styles.tagsRow}>
            {activeItem.tags.map((tag, i) => (
              <View key={i} style={{...styles.tagBadge, backgroundColor: tag.color}}>
                <Text style={styles.tagBadgeText}>{tag.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <ReactionBar targetType="item" targetId={activeItem.id} />

      <Modal
        visible={listingSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={closeListingSheet}
      >
        <Pressable style={styles.shareBackdrop} onPress={closeListingSheet}>
          <Pressable style={styles.shareSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>{t("marketplaceListingTitle")}</Text>
            <Text style={styles.shareHint}>{t("marketplaceListingHint")}</Text>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editLabel}>{t("marketplaceModeLabel")}</Text>
              <View style={styles.conditionRow}>
                {(["trade", "sell"] as const).map((m) => {
                  const selected = listingMode === m;
                  return (
                    <Pressable
                      key={m}
                      style={{ ...styles.conditionChip, ...(selected ? styles.conditionChipSelected : {}) }}
                      onPress={() => setListingMode(m)}
                    >
                      <Text style={{ ...styles.conditionChipText, ...(selected ? styles.conditionChipTextSelected : {}) }}>
                        {m === "trade" ? t("marketplaceModeTrade") : t("marketplaceModeSell")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {listingMode === "sell" ? (
              <View style={styles.editFieldGroup}>
                <Text style={styles.editLabel}>{t("marketplacePriceLabel")}</Text>
                <CurrencyInput
                  value={listingPrice}
                  currency={listingCurrency}
                  onChangeValue={setListingPrice}
                  onChangeCurrency={setListingCurrency}
                  placeholder={t("marketplacePricePlaceholder")}
                />
              </View>
            ) : null}

            <View style={styles.editFieldGroup}>
              <Text style={styles.editLabel}>{t("marketplaceNotesLabel")}</Text>
              <MaskedTextInput
                value={listingNotes}
                onChangeText={setListingNotes}
                placeholder={t("marketplaceNotesPlaceholder")}
                placeholderTextColor={PLACEHOLDER}
                multiline
                textAlignVertical="top"
                style={{ ...styles.editInput, ...styles.editInputMultiline }}
              />
            </View>

            {overFreeCap ? (
              <Text style={styles.listingHint}>{t("marketplaceUpgradeHint")}</Text>
            ) : null}

            <View style={styles.shareActions}>
              <Pressable
                style={{ ...styles.shareCopyButton, ...(overFreeCap ? styles.saveButtonDisabled : {}) }}
                onPress={handleSubmitListing}
                disabled={overFreeCap}
              >
                <Text style={styles.shareCopyButtonText}>{t("marketplaceSubmitListing")}</Text>
              </Pressable>
            </View>
            <Pressable style={styles.shareCancelButton} onPress={closeListingSheet}>
              <Text style={styles.shareCancelText}>{t("cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.shareBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.shareSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>{t("shareTitle")}</Text>
            <Text style={styles.shareHint}>{t("shareItemHint")}</Text>
            <View style={styles.shareLinkBox}>
              <Text style={styles.shareLinkText} numberOfLines={1}>{buildDeepLink(`item/${activeItem.id}`)}</Text>
            </View>
            <View style={styles.shareActions}>
              <Pressable
                style={{...styles.shareCopyButton, ...(linkCopied ? styles.shareCopyButtonDone : {})}}
                onPress={() => {
                  const link = buildDeepLink(`item/${activeItem.id}`);
                  if (Platform.OS === "web" && navigator.clipboard) {
                    navigator.clipboard.writeText(link).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    });
                  }
                }}
              >
                <Text style={{...styles.shareCopyButtonText, ...(linkCopied ? styles.shareCopyButtonTextDone : {})}}>
                  {linkCopied ? t("linkCopied") : t("copyLink")}
                </Text>
              </Pressable>
              {Platform.OS !== "web" ? (
                <Pressable
                  style={styles.shareNativeButton}
                  onPress={() => {
                    const link = buildDeepLink(`item/${activeItem.id}`);
                    Share.share({ message: `${activeItem.title}\n${link}`, url: link });
                  }}
                >
                  <Text style={styles.shareNativeButtonText}>{t("shareVia")}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable style={styles.shareCancelButton} onPress={() => setShareOpen(false)}>
              <Text style={styles.shareCancelText}>{t("cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function MetaRow({ label, value, theme }: { label: string; value: string; theme: AppTheme }) {
  return (
    <View style={styles.metaRow}>
      <Text style={{ ...styles.metaRowLabel, color: theme.meta }}>{label}</Text>
      <Text style={{ ...styles.metaRowValue, color: theme.text }}>{value}</Text>
    </View>
  );
}

function EditField({
  label,
  value,
  onChangeText,
  multiline = false,
  required = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  multiline?: boolean;
  required?: boolean;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={styles.editFieldGroup}>
      <Text style={styles.editLabel}>
        {label}
        {required ? <Text style={styles.editRequired}> *</Text> : null}
      </Text>
      <MaskedTextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={PLACEHOLDER}
        multiline={multiline}
        keyboardType={keyboardType ?? "default"}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          ...styles.editInput,
          ...(multiline ? styles.editInputMultiline : {}),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  photoHero: {
    marginHorizontal: -SPACING_GUTTER,
    height: 280,
    overflow: "hidden",
    backgroundColor: AMBER_MUTED_4,
  },
  heroImage: {
    height: 280,
    backgroundColor: AMBER_MUTED_4,
  },
  heroBadges: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    gap: 8,
  },
  titleBlock: {
    gap: 6,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: FONT_BODY,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  editButton: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 16,
    alignItems: "center",
  },
  editButtonText: {
    color: TEXT_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  ghostButton: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: "transparent",
    paddingVertical: 16,
    alignItems: "center",
  },
  ghostButtonText: {
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  ghostDangerButton: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DANGER_SOFT_4,
    backgroundColor: "transparent",
    paddingVertical: 16,
    alignItems: "center",
  },
  ghostDangerText: {
    color: DANGER_DEEP_6,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareBackdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.4)",
    justifyContent: "flex-end",
  },
  shareSheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
  },
  shareHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: AMBER_SOFT,
  },
  shareTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareHint: {
    color: MUTED_2,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
  shareLinkBox: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  shareLinkText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  shareActions: {
    flexDirection: "row",
    gap: 10,
  },
  shareCopyButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: HERO_DARK,
    paddingVertical: 14,
    alignItems: "center",
  },
  shareCopyButtonDone: {
    backgroundColor: SUCCESS_GREEN_2,
  },
  shareCopyButtonText: {
    color: TEXT_ON_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareCopyButtonTextDone: {
    color: "#fff",
  },
  shareNativeButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
  },
  shareNativeButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareCancelButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  shareCancelText: {
    color: TEXT_DARK,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  itemTitle: {
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 38,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  itemMeta: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
  metaCard: {
    borderRadius: RADIUS_ITEM_AIRY,
    padding: 18,
    borderWidth: 1,
    gap: 14,
  },
  metaRow: {
    gap: 4,
  },
  metaRowLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  metaRowValue: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: FONT_BODY,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagBadge: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  tagBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  conditionBadge: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: HERO_DARK,
  },
  conditionBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_BOLD,
  },
  hero: {
    backgroundColor: BORDER_2,
    borderRadius: 28,
    padding: 20,
    gap: 8,
  },
  heroTitle: {
    fontSize: 28,
    color: TEXT_DARK_4,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  editFieldGroup: {
    gap: 10,
  },
  editLabel: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editRequired: {
    color: DANGER,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editInput: {
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: TEXT_DARK,
    fontSize: 16,
    fontFamily: FONT_BODY,
  },
  editInputMultiline: {
    minHeight: 100,
  },
  conditionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  conditionChip: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  conditionChipSelected: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  conditionChipText: {
    color: MUTED_2,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  conditionChipTextSelected: {
    color: TEXT_ON_DARK,
  },
  editTagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editTagChipText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  editTagChipRemove: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  tagInputRow: {
    flexDirection: "row",
    gap: 10,
  },
  tagInput: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: TEXT_DARK,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  tagAddButton: {
    borderRadius: 22,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 18,
    paddingVertical: 12,
    justifyContent: "center",
  },
  tagAddButtonText: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  photoButton: {
    borderRadius: 20,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
  },
  photoButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  saveButton: {
    borderRadius: 24,
    paddingVertical: 18,
    alignItems: "center",
    backgroundColor: HERO_DARK,
  },
  saveButtonDisabled: {
    opacity: 0.75,
  },
  saveButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  cancelButton: {
    borderRadius: 22,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  listingStatusGroup: {
    gap: 8,
  },
  listingButton: {
    borderRadius: 20,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 16,
    alignItems: "center",
  },
  listingButtonDisabled: {
    opacity: 0.5,
  },
  listingButtonText: {
    color: TEXT_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  listingHint: {
    color: ACCENT_DEEP,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  listingStatusBadge: {
    borderRadius: 999,
    backgroundColor: SUCCESS_GREEN,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  listingStatusText: {
    color: TEXT_ON_DARK,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  listingRemoveButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DANGER_SOFT_4,
    backgroundColor: CARD_BG_12,
    paddingVertical: 14,
    alignItems: "center",
  },
  listingRemoveText: {
    color: DANGER_DEEP_6,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
