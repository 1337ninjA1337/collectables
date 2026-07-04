import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { applyItemFilters, applySortMode, EMPTY_FILTERS, ItemFilterBar, type ItemFilters } from "@/components/item-filters";
import { buildDeepLink } from "@/lib/deep-link";
import { VisibilityBadge } from "@/components/visibility-badge";
import { SkeletonCollectionDetail } from "@/components/skeleton";
import { NestableDraggableFlatList, RenderItemParams, ScaleDecorator } from "../../components/DraggableList";

import { ItemCard } from "@/components/item-card";
import { ReactionBar } from "@/components/reaction-bar";
import { CurrencySheet } from "@/components/currency-sheet";
import { Screen } from "@/components/screen";
import { SelectableItemRow } from "@/components/selectable-item-row";
import { useAuth } from "@/lib/auth-context";
import { uploadImage } from "@/lib/cloudinary";
import { withCloudinaryThumbUrl } from "@/lib/cloudinary-url";
import { useCollections } from "@/lib/collections-context";
import { useChunkedList } from "@/lib/use-chunked-list";
import { exportCollectionToPdf } from "@/lib/export-pdf";
import { formatCostAmount } from "@/lib/format-cost";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { usePremium } from "@/lib/premium-context";
import { useSocial } from "@/lib/social-context";
import { fetchCollectionById, fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { useToast } from "@/lib/toast-context";
import { CollectableItem, Collection, CollectionVisibility } from "@/lib/types";
import { useAppTheme } from "@/components/use-app-theme";
import { LinearGradient } from "expo-linear-gradient";
import { FONT_DISPLAY, FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { CLARITY_MASK_PROPS } from "@/lib/clarity-mask";
import {
  ACCENT_DEEP,
  AMBER_ACCENT,
  AMBER_LIGHT_2,
  AMBER_MUTED_2,
  AMBER_MUTED_7,
  AMBER_MUTED_8,
  AMBER_SOFT,
  BORDER,
  BORDER_7,
  CARD_BG,
  CARD_BG_3,
  CARD_BG_9,
  CARD_BG_10,
  CARD_BG_13,
  DANGER,
  DANGER_DEEP_4,
  DANGER_SOFT_2,
  DANGER_SOFT_5,
  HERO_DARK,
  HERO_DARK_2,
  HERO_DARK_8,
  HERO_DARK_9,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_5,
  MUTED_10,
  MUTED_17,
  MUTED_22,
  MUTED_23,
  PLACEHOLDER,
  PURE_WHITE,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  SHADOW_SOFT,
  SPACING_AIRY,
  SPACING_GUTTER,
  SUCCESS_GREEN_2,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_9,
} from "@/lib/design-tokens";

export default function CollectionDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const {
    collections,
    getCollectionById,
    getItemsForCollection,
    getCollectionTotalCost,
    deleteCollection,
    deleteItems,
    moveItems,
    isCollectionFollowed,
    followCollection,
    unfollowCollection,
    reorderItemsInCollection,
    updateCollection,
    refresh,
    shareCollectionWithUser,
    unshareCollectionWithUser,
    saveSharedCollection,
  } = useCollections();
  const { friends, getProfileById, ensureProfilesLoaded } = useSocial();
  const [refreshing, setRefreshing] = useState(false);
  const { t } = useI18n();
  const toast = useToast();
  const { isPremium } = usePremium();
  const theme = useAppTheme();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [itemFilters, setItemFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [exporting, setExporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCoverUri, setEditCoverUri] = useState("");
  const [editCoverChanged, setEditCoverChanged] = useState(false);
  const [editVisibility, setEditVisibility] = useState<CollectionVisibility>("private");
  const [editCurrency, setEditCurrency] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState("");
  // Tracks how the currency sheet was opened so the same `onSelect` handler
  // can pick the right persistence path: "edit" defers the save until the
  // edit-modal submit (so Cancel still works), "quick" saves on the spot for
  // the tap-to-swap chip on the total-cost summary card.
  const [currencySheetMode, setCurrencySheetMode] = useState<"edit" | "quick">("edit");
  const localCollection = getCollectionById(params.id);
  const [remoteCollection, setRemoteCollection] = useState<Collection | null>(null);
  const [remoteItems, setRemoteItems] = useState<CollectableItem[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  useEffect(() => {
    if (!localCollection && params.id && params.id !== "[id]") {
      setLoadingRemote(true);
      Promise.all([
        fetchCollectionById(params.id),
        fetchItemsByCollectionId(params.id),
      ])
        .then(([c, items]) => {
          setRemoteCollection(c);
          setRemoteItems(items);
        })
        .catch(() => {})
        .finally(() => setLoadingRemote(false));
    }
  }, [localCollection, params.id]);

  // When a user opens a private collection via a shared link, persist them as
  // a viewer so the collection appears alongside their friends' collections.
  // Gated by a per-id ref so an unrelated re-render (e.g. a parent context
  // re-creating `t` / `toast` / `saveSharedCollection`) cannot re-fire the save
  // — that was the iOS Safari crash path: each attempt mounted a toast and
  // queued a network write, blowing the memory budget until Safari aborted
  // with "A problem repeatedly occurred". One attempt per opened collection.
  const hasAttemptedShareSaveRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !remoteCollection) return;
    if (localCollection) return;
    if (hasAttemptedShareSaveRef.current === params.id) return;
    hasAttemptedShareSaveRef.current = params.id;
    let cancelled = false;
    void saveSharedCollection(remoteCollection).then((saved) => {
      if (!cancelled && saved) {
        setRemoteCollection(saved);
        toast.success(t("sharedCollectionSaved"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, remoteCollection, localCollection, params.id, saveSharedCollection, toast, t]);

  const collection = localCollection ?? remoteCollection;
  // `getItemsForCollection` builds a fresh `.filter().sort()` array on every
  // call — without memoizing here, `localItems` (and therefore `allItems` and
  // the `applyItemFilters` memo below) gets a new reference on every render,
  // which would re-trigger the `useChunkedList` identity-reset effect after
  // every `loadMore` press and snap the visible window back to one page.
  const localItems = useMemo(
    () => getItemsForCollection(params.id),
    [getItemsForCollection, params.id],
  );
  const allItems = localItems.length > 0 ? localItems : remoteItems;
  const filteredItems = useMemo(() => applyItemFilters(allItems, itemFilters), [allItems, itemFilters]);
  // applySortMode runs AFTER the price/date/source/query filter pass so the
  // alphabetical sort applies to the already-narrowed result set. Memoized
  // on [filteredItems, itemFilters.sort] so a sort-mode change reuses the
  // existing filtered slice without re-running the filter predicate.
  const items = useMemo(
    () => applySortMode(filteredItems, itemFilters.sort),
    [filteredItems, itemFilters.sort],
  );
  // Chunked rendering: mount only the first page of item cards (~20) up-front
  // so iOS RAM stays bounded as the collection grows. `useChunkedList` resets
  // its window automatically when the `items` reference changes (filter or
  // sort swap) because `items` is memoized on `[filteredItems, itemFilters.sort]`
  // above and `filteredItems` is memoized on `[allItems, itemFilters]`.
  const { visibleItems, hasMore, loadMore } = useChunkedList(items);

  // Resolve profile details for every viewer listed on the collection so the
  // share sheet can show non-friends (link-granted viewers) alongside friends.
  // Memoised so the `?? []` fallback returns the SAME array reference between
  // renders when `collection?.sharedWithUserIds` is undefined — otherwise the
  // dependency array sees a new `[]` every render and the effect re-fires.
  const sharedWithUserIds = useMemo(
    () => collection?.sharedWithUserIds ?? [],
    [collection?.sharedWithUserIds],
  );
  useEffect(() => {
    if (!shareOpen || sharedWithUserIds.length === 0) return;
    ensureProfilesLoaded(sharedWithUserIds);
  }, [shareOpen, sharedWithUserIds, ensureProfilesLoaded]);

  // VM-F: stable `useCallback` (empty deps — `setSelectedIds` is React-stable)
  // so `<SelectableItemRow>`'s `onToggle` prop is referentially equal across
  // renders, letting the row's React.memo wrapper skip re-render work.
  // Hoisted above the loading/not-found early returns below so the hook
  // order stays stable across the loading→loaded transition; otherwise the
  // first paint (early-return branch) skips the hook and the second paint
  // adds it, tripping React's "Rendered more hooks than during the previous
  // render" invariant.
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // VM-F: hoist the selection-mode FlatList renderItem into a `useCallback`
  // so React.memo on `<SelectableItemRow>` (the row-component memo) can
  // actually skip re-render work for rows whose `selected` flag didn't
  // change between toggles. Pre-VM-F the inline arrow `({ item }) => (...)`
  // allocated a fresh closure every parent render, defeating the row memo.
  // The dep list intentionally carries `selectedIds` (each toggle produces a
  // new Set reference) so `<SelectableItemRow>`'s `selected` boolean prop is
  // recomputed; the row memo then compares props and skips for rows whose
  // boolean didn't change. Pair with `extraData={selectedIds}` on the
  // FlatList so virtualization knows to consider re-rendering when the
  // selection set mutates even though `data={visibleItems}` reference is
  // stable across a single toggle. Hoisted above the early returns for the
  // same hook-order reason as `toggleSelect`.
  const renderSelectableRow = useCallback(
    ({ item }: { item: CollectableItem }) => (
      <SelectableItemRow
        item={item}
        selected={selectedIds.has(item.id)}
        onToggle={toggleSelect}
      />
    ),
    [selectedIds, toggleSelect],
  );

  if (loadingRemote && !collection) {
    return (
      <Screen>
        <SkeletonCollectionDetail />
      </Screen>
    );
  }

  if (!collection) {
    return (
      <Screen>
        <Text style={styles.emptyTitle}>{t("collectionNotFound")}</Text>
      </Screen>
    );
  }

  const activeCollection = collection;

  async function confirmAndDeleteCollection() {
    await deleteCollection(activeCollection.id);
    router.replace("/");
  }

  function handleDeleteCollection() {
    const message = `${t("deleteCollectionTitle")} ${t("deleteCollectionText")}`;

    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) {
        void confirmAndDeleteCollection();
      }
      return;
    }

    Alert.alert(t("deleteCollectionTitle"), t("deleteCollectionText"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          void confirmAndDeleteCollection();
        },
      },
    ]);
  }

  const isOwner = user?.id === activeCollection.ownerUserId;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      if (params.id && params.id !== "[id]") {
        const [c, items] = await Promise.all([
          fetchCollectionById(params.id),
          fetchItemsByCollectionId(params.id),
        ]);
        setRemoteCollection(c);
        setRemoteItems(items);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const otherOwnedCollections = collections.filter(
    (c) => c.role === "owner" && c.id !== activeCollection.id,
  );

  function enterSelectionMode() {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function performBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await deleteItems(ids);
    toast.success(t("itemsDeleted", { count: ids.length }));
    exitSelectionMode();
  }

  function handleBulkDelete() {
    const count = selectedIds.size;
    if (count === 0) return;
    const title = t("deleteItemsTitle", { count });
    const message = t("deleteItemsText");

    if (Platform.OS === "web") {
      if (globalThis.confirm(`${title}\n\n${message}`)) {
        void performBulkDelete();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      { text: t("delete"), style: "destructive", onPress: () => void performBulkDelete() },
    ]);
  }

  function handleOpenMove() {
    if (selectedIds.size === 0) return;
    if (otherOwnedCollections.length === 0) {
      toast.info(t("noOtherCollections"));
      return;
    }
    setMoveModalOpen(true);
  }

  async function handleMoveTo(targetCollectionId: string) {
    const ids = Array.from(selectedIds);
    setMoveModalOpen(false);
    if (ids.length === 0) return;
    await moveItems(ids, targetCollectionId);
    toast.success(t("itemsMoved", { count: ids.length }));
    exitSelectionMode();
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      await exportCollectionToPdf(activeCollection, allItems, {
        acquiredHow: t("acquiredHow"),
        acquiredDate: t("acquiredDate"),
        description: t("description"),
        variants: t("variants"),
        costLabel: t("costLabel"),
        totalCost: t("totalCost"),
        exportPdfItemCount: t("exportPdfItemCount", { count: allItems.length }),
        photosSaved: t("photosSaved"),
      });
      toast.success(t("exportPdfDone"));
    } catch {
      toast.error(t("exportPdfFailed"));
    } finally {
      setExporting(false);
    }
  }

  function openEditModal() {
    setEditName(activeCollection.name);
    setEditDescription(activeCollection.description);
    setEditCoverUri(activeCollection.coverPhoto);
    setEditCoverChanged(false);
    setEditVisibility(activeCollection.visibility ?? "private");
    setEditCurrency(activeCollection.currency ?? "");
    setEditModalOpen(true);
  }

  async function pickEditCover() {
    if (Platform.OS !== "web") {
      Alert.alert(t("collectionCoverLabel"), undefined, [
        {
          text: t("pickFromGallery"),
          onPress: () => void pickEditCoverFromGallery(),
        },
        {
          text: t("takePhoto"),
          onPress: () => void pickEditCoverFromCamera(),
        },
        { text: t("cancel"), style: "cancel" },
      ]);
      return;
    }
    await pickEditCoverFromGallery();
  }

  async function pickEditCoverFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error(t("noAccessCover"), t("noAccess"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      setEditCoverUri(result.assets[0].uri);
      setEditCoverChanged(true);
    }
  }

  async function pickEditCoverFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.error(t("noAccessCamera"), t("noAccess"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      setEditCoverUri(result.assets[0].uri);
      setEditCoverChanged(true);
    }
  }

  async function handleSaveEdit() {
    if (!editName.trim()) {
      toast.error(t("requiredFieldsMissing"), t("needTitle"));
      return;
    }
    setEditSaving(true);
    try {
      let finalCover = editCoverUri;
      if (editCoverChanged && editCoverUri) {
        finalCover = await uploadImage(editCoverUri);
      }
      // Defense-in-depth: even if the locked chip is bypassed, a non-premium
      // user can never flip a public collection to private (matches the
      // creation gate). An already-private collection is left untouched.
      const finalVisibility: CollectionVisibility =
        !isPremium &&
        editVisibility === "private" &&
        (activeCollection.visibility ?? "private") !== "private"
          ? "public"
          : editVisibility;
      await updateCollection(activeCollection.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        coverPhoto: finalCover,
        visibility: finalVisibility,
        // Empty picker selection = clear the override and fall back to the
        // user's app-wide displayCurrency in `getCollectionTotalCost`.
        currency: editCurrency.trim() || null,
      });
      setEditModalOpen(false);
    } finally {
      setEditSaving(false);
    }
  }

  const renderItemRow = ({ item, drag, isActive }: RenderItemParams<CollectableItem>) => (
    <ScaleDecorator>
      <Pressable
        onLongPress={isOwner ? drag : undefined}
        disabled={isActive}
        delayLongPress={150}
      >
        <ItemCard item={item} />
      </Pressable>
    </ScaleDecorator>
  );

  // VM-D: When the viewer/read-only branch (the FlatList numColumns=2 case)
  // is active, hoist the outer scroll INTO the FlatList itself so iOS can
  // recycle off-screen rows. Pre-VM-D the inner FlatList lived inside a
  // ScrollView with its scrolling disabled and every item card mounted up-
  // front — virtualization can't kick in unless the FlatList owns the scroll. The
  // drag-mode and selection-mode branches stay on `<Screen nestable>` since
  // drag needs `NestableScrollContainer`'s gesture coordination and selection
  // renders a non-virtualized vertical list (VM-E migrates selection too).
  const isViewerFlatListBranch =
    items.length > 0 && (!isOwner || (!selectionMode && itemFilters.sort !== "default"));

  // Hero + summary + total + reactions + owner-actions — the JSX that sits
  // above the items list in BOTH render paths. Wrapped in a single View with
  // a vertical gap so the viewer-FlatList path (where ListHeaderComponent
  // doesn't get the outer ScrollView's `gap: 18`) keeps the original visual
  // rhythm.
  const pageHeader = (
    <View style={styles.pageHeader}>
      <View style={{...styles.hero, ...(!activeCollection.coverPhoto ? { backgroundColor: placeholderColor(activeCollection.id) } : {})}}>
        {activeCollection.coverPhoto ? (
          <Image
            source={{ uri: withCloudinaryThumbUrl(activeCollection.coverPhoto, { width: 1200, height: 900, mode: "fill" }) }}
            style={styles.heroImage}
          />
        ) : null}
        <LinearGradient
          colors={["rgba(34, 24, 17, 0.08)", "rgba(34, 24, 17, 0.55)"]}
          style={styles.heroOverlay}
        />
        <View style={styles.heroContent}>
          <VisibilityBadge collection={activeCollection} variant="hero" />
          <Text style={styles.heroTitle}>{activeCollection.name}</Text>
          <Text style={styles.heroText}>{activeCollection.description}</Text>
          {activeCollection.role === "owner" && activeCollection.visibility !== "public" ? (
            <Text style={styles.heroMeta}>
              {t("accessOpenFor", { count: activeCollection.sharedWith.length })}
            </Text>
          ) : activeCollection.role !== "owner" ? (
            <Text style={styles.heroMeta}>
              {t("viewingCollectionOf", { name: activeCollection.ownerName })}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={{ ...styles.summaryCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
          <Text style={{ ...styles.summaryNumber, color: theme.text }}>{allItems.length}</Text>
          <Text style={{ ...styles.summaryLabel, color: theme.meta }}>{t("itemsInside")}</Text>
        </View>
        <View style={{ ...styles.summaryCard, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
          <Text style={{ ...styles.summaryNumber, color: theme.text }}>{allItems.reduce((total, item) => total + item.photos.length, 0)}</Text>
          <Text style={{ ...styles.summaryLabel, color: theme.meta }}>{t("photosSaved")}</Text>
        </View>
      </View>

      {(() => {
        const total = getCollectionTotalCost(activeCollection.id);
        if (total.amount <= 0) return null;
        // Owners get tap-to-swap on the total card — opens the currency sheet
        // pre-seeded with the active currency. Saves on the spot, no need to
        // dig into the 3-dot edit modal. Non-owners see a plain View.
        const openCurrencyPicker = () => {
          setEditCurrency(activeCollection.currency ?? total.currency);
          setCurrencyQuery("");
          setCurrencySheetMode("quick");
          setCurrencySheetOpen(true);
        };
        return isOwner ? (
          <Pressable
            style={styles.summaryCard}
            onPress={openCurrencyPicker}
            accessibilityRole="button"
            accessibilityLabel={t("collectionCurrencyA11y", { currency: total.currency })}
          >
            <Text style={styles.summaryNumber}>{formatCostAmount(total.amount)} {total.currency}</Text>
            <Text style={styles.summaryLabel}>{t("totalCost")}</Text>
          </Pressable>
        ) : (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{formatCostAmount(total.amount)} {total.currency}</Text>
            <Text style={styles.summaryLabel}>{t("totalCost")}</Text>
          </View>
        );
      })()}

      <ReactionBar targetType="collection" targetId={activeCollection.id} />

      {user?.id === activeCollection.ownerUserId ? (
        <View style={styles.ownerActions}>
          <Pressable style={styles.editCollectionButton} onPress={openEditModal}>
            <Text style={styles.editCollectionButtonText}>{t("editCollection")}</Text>
          </Pressable>
          <Link href={{ pathname: "/create", params: { collectionId: activeCollection.id } }} asChild>
            <Pressable style={styles.addButton}>
              <Text style={styles.addButtonText}>{t("addItemToCollection")}</Text>
            </Pressable>
          </Link>
          {allItems.length > 0 && !selectionMode ? (
            <Pressable style={styles.selectButton} onPress={enterSelectionMode}>
              <Text style={styles.selectButtonText}>{t("selectItems")}</Text>
            </Pressable>
          ) : null}
          {allItems.length > 0 ? (
            <Pressable
              style={{...styles.exportButton, ...(exporting ? styles.exportButtonDisabled : {})}}
              onPress={() => void handleExportPdf()}
              disabled={exporting}
            >
              <Text style={styles.exportButtonText}>{exporting ? t("exportPdfGenerating") : t("exportPdf")}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.shareButton} onPress={() => setShareOpen(true)}>
            <Text style={styles.shareButtonText}>{t("share")}</Text>
          </Pressable>
          <Pressable style={styles.deleteButton} onPress={handleDeleteCollection}>
            <Text style={styles.deleteButtonText}>{t("deleteCollection")}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.ownerActions}>
          {isCollectionFollowed(activeCollection.id) ? (
            <Pressable style={styles.unfollowButton} onPress={() => void unfollowCollection(activeCollection.id)}>
              <Text style={styles.unfollowButtonText}>{t("unfollowCollection")}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.addButton} onPress={() => void followCollection(activeCollection.id)}>
              <Text style={styles.addButtonText}>{t("followCollection")}</Text>
            </Pressable>
          )}
          {allItems.length > 0 ? (
            <Pressable
              style={{...styles.exportButton, ...(exporting ? styles.exportButtonDisabled : {})}}
              onPress={() => void handleExportPdf()}
              disabled={exporting}
            >
              <Text style={styles.exportButtonText}>{exporting ? t("exportPdfGenerating") : t("exportPdf")}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.shareButton} onPress={() => setShareOpen(true)}>
            <Text style={styles.shareButtonText}>{t("share")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const listTitleAndFilters = (
    <>
      <Text style={styles.listTitle}>{t("collectionItems")}</Text>
      {allItems.length > 0 ? (
        <ItemFilterBar filters={itemFilters} onChange={setItemFilters} />
      ) : null}
    </>
  );

  const loadMoreCta = hasMore ? (
    <Pressable
      style={styles.loadMore}
      onPress={loadMore}
      accessibilityRole="button"
      accessibilityLabel={t("loadMoreItemsA11y", { count: items.length - visibleItems.length })}
      accessibilityHint={t("loadMoreItemsHint")}
    >
      <Text style={styles.loadMoreText}>
        {t("loadMoreItems", { count: items.length - visibleItems.length })}
      </Text>
    </Pressable>
  ) : null;

  const modalsBlock = (
    <>
      <Modal visible={moveModalOpen} transparent animationType="fade" onRequestClose={() => setMoveModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMoveModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("moveToCollection")}</Text>
            <View style={styles.modalList}>
              {otherOwnedCollections.map((c) => (
                <Pressable key={c.id} style={styles.modalRow} onPress={() => void handleMoveTo(c.id)}>
                  <Text style={styles.modalRowText}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.modalCancel} onPress={() => setMoveModalOpen(false)}>
              <Text style={styles.modalCancelText}>{t("cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.shareBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.shareSheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={styles.shareScrollView} bounces={false}>
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>{t("shareTitle")}</Text>
            <Text style={styles.shareHint}>{t("shareCollectionHint")}</Text>
            <View style={styles.shareLinkBox}>
              <Text style={styles.shareLinkText} numberOfLines={1}>{buildDeepLink(`collection/${activeCollection.id}`)}</Text>
            </View>
            <View style={styles.shareActions}>
              <Pressable
                style={{...styles.shareCopyButton, ...(linkCopied ? styles.shareCopyButtonDone : {})}}
                onPress={() => {
                  const link = buildDeepLink(`collection/${activeCollection.id}`);
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
                    const link = buildDeepLink(`collection/${activeCollection.id}`);
                    Share.share({ message: `${activeCollection.name}\n${link}`, url: link });
                  }}
                >
                  <Text style={styles.shareNativeButtonText}>{t("shareVia")}</Text>
                </Pressable>
              ) : null}
            </View>
            {isOwner && friends.length > 0 ? (
              <View style={styles.shareFriendsSection}>
                <Text style={styles.shareFriendsTitle}>{t("shareWithFriends")}</Text>
                <Text style={styles.shareFriendsHint}>{t("shareWithFriendsHint")}</Text>
                <ScrollView style={styles.shareFriendsList} nestedScrollEnabled>
                  {friends.map((friendId) => {
                    const profile = getProfileById(friendId);
                    if (!profile) return null;
                    const isShared = activeCollection.sharedWithUserIds.includes(friendId);
                    return (
                      <View key={friendId} style={styles.shareFriendRow}>
                        <View style={styles.shareFriendInfo}>
                          {profile.avatar ? (
                            <Image source={{ uri: profile.avatar }} style={styles.shareFriendAvatar} />
                          ) : (
                            <View style={{...styles.shareFriendAvatar, backgroundColor: placeholderColor(friendId)}} />
                          )}
                          <Text style={styles.shareFriendName} numberOfLines={1}>{profile.displayName}</Text>
                        </View>
                        <Pressable
                          style={{...styles.shareFriendButton, ...(isShared ? styles.shareFriendButtonActive : {})}}
                          onPress={() => {
                            if (isShared) {
                              unshareCollectionWithUser(activeCollection.id, friendId);
                            } else {
                              shareCollectionWithUser(activeCollection.id, friendId);
                            }
                          }}
                        >
                          <Text style={{...styles.shareFriendButtonText, ...(isShared ? styles.shareFriendButtonTextActive : {})}}>
                            {isShared ? t("shared") : t("share")}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : isOwner && friends.length === 0 ? (
              <Text style={styles.shareFriendsEmpty}>{t("noFriendsToShare")}</Text>
            ) : null}
            {isOwner && activeCollection.sharedWithUserIds.length > 0 ? (
              <View style={styles.shareFriendsSection}>
                <Text style={styles.shareFriendsTitle}>{t("peopleWithAccess")}</Text>
                <Text style={styles.shareFriendsHint}>{t("peopleWithAccessHint")}</Text>
                <ScrollView style={styles.shareFriendsList} nestedScrollEnabled>
                  {activeCollection.sharedWithUserIds.map((viewerId) => {
                    const profile = getProfileById(viewerId);
                    const displayName = profile?.displayName ?? profile?.username ?? viewerId;
                    return (
                      <View key={viewerId} style={styles.shareFriendRow}>
                        <View style={styles.shareFriendInfo}>
                          {profile?.avatar ? (
                            <Image source={{ uri: profile.avatar }} style={styles.shareFriendAvatar} />
                          ) : (
                            <View style={{...styles.shareFriendAvatar, backgroundColor: placeholderColor(viewerId)}} />
                          )}
                          <Text style={styles.shareFriendName} numberOfLines={1}>{displayName}</Text>
                        </View>
                        <Pressable
                          style={styles.shareFriendButton}
                          onPress={() => unshareCollectionWithUser(activeCollection.id, viewerId)}
                        >
                          <Text style={styles.shareFriendButtonText}>{t("removeAccess")}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
            <Pressable style={styles.shareCancelButton} onPress={() => setShareOpen(false)}>
              <Text style={styles.shareCancelText}>{t("cancel")}</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={editModalOpen} transparent animationType="fade" onRequestClose={() => setEditModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditModalOpen(false)}>
          <Pressable style={styles.editModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("editCollection")}</Text>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editFieldLabel}>
                {t("collectionNameLabel")}<Text style={styles.editFieldRequired}> *</Text>
              </Text>
              <TextInput
                {...CLARITY_MASK_PROPS}
                value={editName}
                onChangeText={setEditName}
                placeholder={t("collectionNamePlaceholder")}
                placeholderTextColor={PLACEHOLDER}
                style={styles.editFieldInput}
              />
            </View>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editFieldLabel}>{t("collectionDescriptionLabel")}</Text>
              <TextInput
                {...CLARITY_MASK_PROPS}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder={t("collectionDescriptionPlaceholder")}
                placeholderTextColor={PLACEHOLDER}
                multiline
                textAlignVertical="top"
                style={{...styles.editFieldInput, ...styles.editFieldInputMultiline}}
              />
            </View>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editFieldLabel}>{t("collectionCoverLabel")}</Text>
              <Pressable style={styles.editCoverButton} onPress={() => void pickEditCover()}>
                <Text style={styles.editCoverButtonText}>{t("editCover")}</Text>
              </Pressable>
              {editCoverUri ? (
                <Image source={{ uri: editCoverUri }} style={styles.editCoverPreview} />
              ) : null}
            </View>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editFieldLabel}>{t("visibilityLabel")}</Text>
              <View style={styles.editVisibilityRow}>
                {(["private", "public"] as const).map((v) => {
                  const selected = editVisibility === v;
                  // Block the public→private transition for non-premium users,
                  // but never lock an already-private collection (so a lapsed
                  // owner keeps it private without being forced to downgrade).
                  const locked =
                    v === "private" &&
                    !isPremium &&
                    (activeCollection.visibility ?? "private") !== "private";
                  return (
                    <Pressable
                      key={v}
                      style={{
                        ...styles.editVisibilityChip,
                        ...(selected ? styles.editVisibilityChipSelected : {}),
                        ...(locked ? styles.editVisibilityChipLocked : {}),
                      }}
                      onPress={() => {
                        if (locked) {
                          toast.error(t("visibilityPrivatePremiumOnly"), t("premiumTitle"));
                          return;
                        }
                        setEditVisibility(v);
                      }}
                    >
                      <Text style={{...styles.editVisibilityChipText, ...(selected ? styles.editVisibilityChipTextSelected : {})}}>
                        {t(v === "public" ? "visibilityPublic" : "visibilityPrivate")}
                        {locked ? " 🔒" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.editVisibilityHint}>
                {!isPremium &&
                editVisibility === "private" &&
                (activeCollection.visibility ?? "private") !== "private"
                  ? t("visibilityPrivatePremiumOnly")
                  : editVisibility === "public"
                    ? t("visibilityPublicHint")
                    : t("visibilityPrivateHint")}
              </Text>
            </View>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editFieldLabel}>{t("currencyLabel")}</Text>
              <Pressable
                style={styles.editCurrencyButton}
                onPress={() => { setCurrencyQuery(""); setCurrencySheetMode("edit"); setCurrencySheetOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel={t("currencyLabel")}
              >
                <Text style={editCurrency ? styles.editCurrencyButtonText : styles.editCurrencyButtonPlaceholder}>
                  {editCurrency || t("collectionCurrencyAuto")}
                </Text>
              </Pressable>
              <Text style={styles.editVisibilityHint}>{t("collectionCurrencyHint")}</Text>
            </View>

            <Pressable
              style={{...styles.editSaveButton, ...(editSaving ? styles.editSaveButtonDisabled : {})}}
              onPress={() => void handleSaveEdit()}
              disabled={editSaving}
            >
              <Text style={styles.editSaveButtonText}>{editSaving ? t("saving") : t("saveChanges")}</Text>
            </Pressable>
            <Pressable style={styles.modalCancel} onPress={() => setEditModalOpen(false)}>
              <Text style={styles.modalCancelText}>{t("cancelEdit")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <CurrencySheet
        visible={currencySheetOpen}
        selectedCode={editCurrency}
        query={currencyQuery}
        onQueryChange={setCurrencyQuery}
        onSelect={(code) => {
          setEditCurrency(code);
          setCurrencySheetOpen(false);
          // Quick-swap path: persist on the spot so the total card re-renders
          // in the new currency without a follow-up modal save.
          if (currencySheetMode === "quick") {
            void updateCollection(activeCollection.id, { currency: code });
          }
        }}
        onClose={() => setCurrencySheetOpen(false)}
      />
    </>
  );

  if (isViewerFlatListBranch) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: activeCollection.name }} />
        <FlatList
          data={visibleItems}
          numColumns={2}
          keyExtractor={(item) => item.id}
          columnWrapperStyle={styles.masonryRow}
          contentContainerStyle={styles.viewerFlatListContent}
          ListHeaderComponent={
            <View style={styles.viewerListHeader}>
              {pageHeader}
              <View style={styles.listWrap}>{listTitleAndFilters}</View>
            </View>
          }
          ListFooterComponent={loadMoreCta}
          renderItem={({ item }) => (
            <View style={styles.masonryItem}>
              <ItemCard item={item} compact />
            </View>
          )}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews={Platform.OS === "ios"}
          refreshControl={
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={handleRefresh}
              tintColor={ACCENT_DEEP}
              colors={[ACCENT_DEEP]}
            />
          }
          style={styles.viewerFlatList}
        />
        {modalsBlock}
      </Screen>
    );
  }

  return (
    <Screen nestable refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: activeCollection.name }} />
      {pageHeader}

      <View style={styles.listWrap}>
        {listTitleAndFilters}
        {allItems.length === 0 ? (
          <EmptyState
            icon="✨"
            title={t("emptyItemsTitle")}
            hint={t("emptyItemsHint")}
            actionLabel={isOwner ? t("emptyItemsCta") : undefined}
            onAction={isOwner ? () => router.push({ pathname: "/create", params: { collectionId: activeCollection.id } }) : undefined}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🔎"
            title={t("emptySearchTitle")}
            hint={t("emptySearchHint")}
            actionLabel={t("filterReset")}
            onAction={() => setItemFilters(EMPTY_FILTERS)}
            compact
          />
        ) : isOwner && !selectionMode && itemFilters.sort === "default" ? (
          // Drag-mode is gated on `itemFilters.sort === "default"` so the user
          // can never drag while alphabetically sorted — otherwise onDragEnd
          // would re-write `sortOrder` based on the visible (alphabetical)
          // order and silently corrupt the manual drag order. When the gate
          // falls through (any non-default sort), the early-return above hands
          // owners back to the viewer-FlatList branch.
          <NestableDraggableFlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItemRow}
            onDragEnd={({ data }) => {
              // Drag-reorder must operate on the full filtered list, not just
              // the visible window — otherwise items below the page boundary
              // would be re-sortOrdered to 0..N-1 alongside the visible slice
              // and shuffle relative to each other. Append the unrendered
              // tail in its existing order so only the visible slice moves.
              const visibleIds = new Set(visibleItems.map((i) => i.id));
              const tail = items.filter((i) => !visibleIds.has(i.id));
              reorderItemsInCollection(activeCollection.id, [...data, ...tail].map((i) => i.id));
            }}
            contentContainerStyle={styles.draggableList}
          />
        ) : isOwner && selectionMode ? (
          // VM-E: selection-mode now renders via `<FlatList>` so the same
          // chunked-window mount discipline that VM-A/B/C/D applies to the
          // viewer branch also bounds selection mode. `scrollEnabled={false}`
          // because the outer `<Screen nestable>` ScrollView owns scrolling
          // — selection mode keeps the bulk-bar pinned at the bottom of the
          // viewport so it can't be hoisted into the FlatList without losing
          // the bulk-bar UX. FlatList still limits the initial mount via
          // `initialNumToRender` and React.memo, so the per-row image fetch
          // cost in selection mode no longer scales linearly with collection
          // size.
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            renderItem={renderSelectableRow}
            extraData={selectedIds}
            scrollEnabled={false}
            contentContainerStyle={styles.selectList}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "ios"}
          />
        ) : null}
        {loadMoreCta}
      </View>

      {selectionMode ? (
        <View style={styles.bulkBarSpacer} />
      ) : null}

      {selectionMode ? (
        <View style={styles.bulkBar} pointerEvents="box-none">
          <View style={styles.bulkBarInner}>
            <Text style={styles.bulkBarCount}>{t("selectedCount", { count: selectedIds.size })}</Text>
            <View style={styles.bulkBarButtons}>
              <Pressable
                style={{...styles.bulkBarButton, ...(selectedIds.size === 0 ? styles.bulkBarButtonDisabled : {})}}
                disabled={selectedIds.size === 0}
                onPress={handleOpenMove}
              >
                <Text style={styles.bulkBarButtonText}>{t("moveToCollection")}</Text>
              </Pressable>
              <Pressable
                style={{...styles.bulkBarButton, ...styles.bulkBarButtonDanger, ...(selectedIds.size === 0 ? styles.bulkBarButtonDisabled : {})}}
                disabled={selectedIds.size === 0}
                onPress={handleBulkDelete}
              >
                <Text style={{...styles.bulkBarButtonText, ...styles.bulkBarButtonDangerText}}>{t("delete")}</Text>
              </Pressable>
              <Pressable style={{...styles.bulkBarButton, ...styles.bulkBarButtonGhost}} onPress={exitSelectionMode}>
                <Text style={styles.bulkBarButtonText}>{t("cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {modalsBlock}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 280,
    borderRadius: RADIUS_HERO_LG,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: AMBER_MUTED_8,
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    padding: SPACING_GUTTER,
    gap: 8,
  },
  heroTitle: {
    color: PURE_WHITE,
    fontSize: 32,
    fontWeight: "700",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  heroText: {
    color: TEXT_ON_DARK_9,
    lineHeight: 22,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  heroMeta: {
    color: AMBER_LIGHT_2,
    fontWeight: "700",
    fontSize: 14,
    fontFamily: FONT_BODY_BOLD,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: RADIUS_ITEM_AIRY,
    padding: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  summaryLabel: {
    color: MUTED_5,
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
  listWrap: {
    gap: SPACING_AIRY,
  },
  draggableList: {
    gap: 12,
  },
  loadMore: {
    borderRadius: 22,
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
  ownerActions: {
    gap: 12,
  },
  exportButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_MUTED_7,
    backgroundColor: CARD_BG_13,
    alignItems: "center",
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_MUTED_7,
    backgroundColor: CARD_BG_9,
    alignItems: "center",
  },
  shareButtonText: {
    color: MUTED_3,
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
  addButton: {
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: HERO_DARK,
    alignItems: "center",
  },
  addButtonText: {
    color: TEXT_ON_DARK_4,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  deleteButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: DANGER_SOFT_2,
    backgroundColor: CARD_BG_10,
    alignItems: "center",
  },
  deleteButtonText: {
    color: DANGER_DEEP_4,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  unfollowButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    backgroundColor: CARD_BG_3,
    alignItems: "center",
  },
  unfollowButtonText: {
    color: HERO_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  listTitle: {
    color: TEXT_DARK_3,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_BOLD,
  },
  selectButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    backgroundColor: CARD_BG_3,
    alignItems: "center",
  },
  selectButtonText: {
    color: HERO_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  selectList: {
    gap: 12,
  },
  masonryList: {
    gap: 10,
  },
  masonryRow: {
    gap: 10,
  },
  masonryItem: {
    flex: 1,
  },
  // VM-D: pageHeader is the View wrapper around hero/summary/total/reactions/
  // owner-actions. Its `gap: 18` matches the outer scroll content gap so the
  // viewer-FlatList path (where ListHeaderComponent doesn't get the outer
  // ScrollView's gap) keeps the same vertical rhythm as the nestable path.
  pageHeader: {
    gap: 18,
  },
  // VM-D: wrap inside ListHeaderComponent so pageHeader + listWrap (title +
  // filters) have the original 18px gap between them inside the FlatList
  // header slot (the FlatList contentContainerStyle gap controls row gaps,
  // not in-header gaps).
  viewerListHeader: {
    gap: 18,
  },
  // VM-D: FlatList itself owns the scroll in the viewer branch — flex:1 so it
  // fills the Screen's inner View vertically.
  viewerFlatList: {
    flex: 1,
  },
  // VM-D: the Screen's inner View (scroll=false) already pads 20px / 32 on
  // bottom around the FlatList, so contentContainerStyle adds only the row
  // gap that previously lived on `masonryList`. Mirrors the 10px row gap of
  // the pre-VM-D inline masonry FlatList so the visual rhythm is preserved.
  viewerFlatListContent: {
    gap: 10,
  },
  bulkBarSpacer: {
    height: 120,
  },
  bulkBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 12,
  },
  bulkBarInner: {
    backgroundColor: HERO_DARK,
    borderRadius: 22,
    padding: 14,
    gap: 12,
    shadowColor: HERO_DARK_9,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 10,
  },
  bulkBarCount: {
    color: AMBER_LIGHT_2,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  bulkBarButtons: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  bulkBarButton: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 100,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: HERO_DARK_8,
    alignItems: "center",
  },
  bulkBarButtonDisabled: {
    opacity: 0.45,
  },
  bulkBarButtonDanger: {
    backgroundColor: DANGER_DEEP_4,
  },
  bulkBarButtonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: MUTED_22,
  },
  bulkBarButtonText: {
    color: TEXT_ON_DARK_4,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  bulkBarButtonDangerText: {
    color: DANGER_SOFT_5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26, 14, 6, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD_BG,
    borderRadius: 22,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  modalList: {
    gap: 8,
    maxHeight: 360,
  },
  modalRow: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  modalRowText: {
    color: HERO_DARK_2,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  modalCancel: {
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalCancelText: {
    color: MUTED_23,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editCollectionButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_MUTED_7,
    backgroundColor: CARD_BG_9,
    alignItems: "center",
  },
  editCollectionButtonText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD_BG,
    borderRadius: 22,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  editFieldGroup: {
    gap: 8,
  },
  editFieldLabel: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editFieldRequired: {
    color: DANGER,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editFieldInput: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXT_DARK,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  editFieldInputMultiline: {
    minHeight: 90,
  },
  editCurrencyButton: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  editCurrencyButtonText: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  editCurrencyButtonPlaceholder: {
    color: PLACEHOLDER,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  editCoverButton: {
    borderRadius: 16,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 12,
    alignItems: "center",
  },
  editCoverButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editCoverPreview: {
    width: "100%",
    height: 160,
    borderRadius: 16,
    backgroundColor: AMBER_MUTED_2,
  },
  editVisibilityRow: {
    flexDirection: "row",
    gap: 10,
  },
  editVisibilityChip: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  editVisibilityChipSelected: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  editVisibilityChipLocked: {
    opacity: 0.55,
  },
  editVisibilityChipText: {
    color: MUTED_2,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  editVisibilityChipTextSelected: {
    color: TEXT_ON_DARK,
  },
  editVisibilityHint: {
    color: MUTED_17,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONT_BODY,
  },
  shareScrollView: {
    gap: 12,
  },
  shareFriendsSection: {
    gap: 10,
    marginTop: 4,
  },
  shareFriendsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareFriendsHint: {
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_BODY,
  },
  shareFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_7,
  },
  shareFriendInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  shareFriendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  shareFriendName: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
    fontFamily: FONT_BODY_BOLD,
  },
  shareFriendButton: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: HERO_DARK,
  },
  shareFriendButtonActive: {
    backgroundColor: SUCCESS_GREEN_2,
  },
  shareFriendButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareFriendButtonTextActive: {
    color: "#fff",
  },
  shareFriendsList: {
    maxHeight: 228,
  },
  shareFriendsEmpty: {
    color: MUTED_17,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
    fontFamily: FONT_BODY,
  },
  editSaveButton: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: HERO_DARK,
  },
  editSaveButtonDisabled: {
    opacity: 0.75,
  },
  editSaveButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
