import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type ProfilerOnRenderCallback } from "react";
import { Alert, FlatList, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { applyItemFilters, applySortMode, EMPTY_FILTERS, ItemFilterBar, type ItemFilters } from "@/components/item-filters";
import { VisibilityBadge } from "@/components/visibility-badge";
import { SkeletonCollectionDetail } from "@/components/skeleton";
import { NestableDraggableFlatList, RenderItemParams, ScaleDecorator } from "../../components/DraggableList";

import { COMPACT_ITEM_CARD_HEIGHT, ItemCard } from "@/components/item-card";
import { ReactionBar } from "@/components/reaction-bar";
import { CostBadge } from "@/components/cost-badge";
import { CollectionShareSheet } from "@/components/collection-share-sheet";
import { CurrencySheet } from "@/components/currency-sheet";
import { EditCollectionModal } from "@/components/edit-collection-modal";
import { MoveCollectionModal } from "@/components/move-collection-modal";
import { Screen } from "@/components/screen";
import { BulkBar } from "@/components/bulk-bar";
import { SELECTABLE_ROW_HEIGHT, SelectableItemRow } from "@/components/selectable-item-row";
import { useAuth } from "@/lib/auth-context";
import { uploadImage } from "@/lib/cloudinary";
import { withCloudinaryThumbUrl } from "@/lib/cloudinary-url";
import { useCollections } from "@/lib/collections-context";
import { useChunkedList } from "@/lib/use-chunked-list";
import { exportCollectionToPdf } from "@/lib/export-pdf";
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
import {
  ACCENT_DEEP,
  AMBER_LIGHT_2,
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
  DANGER_DEEP_4,
  DANGER_SOFT_2,
  HERO_DARK,
  HERO_DARK_2,
  MUTED_3,
  MUTED_5,
  PURE_WHITE,
  RADIUS_CARD,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  SHADOW_SOFT,
  SPACING_AIRY,
  SPACING_CARD,
  SPACING_GUTTER,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK_3,
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

  // The per-row `selected` lookup reads a plain-object map instead of
  // calling `selectedIds.has()` inside renderItem — the map is rebuilt once
  // per selection change (new Set reference each toggle), so every visible
  // row pays a hidden-class property read rather than `Set.prototype.has`'s
  // generic dispatch. Same complexity, smaller constant factor on large
  // chunked windows.
  // __DEV__-only Profiler telemetry for the selection-mode FlatList: logs
  // each commit's actualDuration to Metro so a future refactor that
  // re-introduces an unmemoized renderItem (or breaks the row memo) shows
  // up as ballooning per-toggle commit times the moment it lands. The
  // logging is double-gated — `__DEV__` compiles the body away in prod
  // bundles, and `selectedIds.size > 0` keeps idle browsing quiet. The
  // <Profiler> wrapper itself stays mounted in prod, where React's
  // production build treats it as a passthrough (no timings collected).
  // Hoisted above the early returns for the usual hook-order reason.
  const onSelectionProfilerRender = useCallback<ProfilerOnRenderCallback>(
    (id, phase, actualDuration) => {
      if (__DEV__ && selectedIds.size > 0) {
        console.log(`[profiler] ${id} ${phase} actualDuration=${actualDuration.toFixed(2)}ms`);
      }
    },
    [selectedIds],
  );

  const selectedById = useMemo(
    () => Object.fromEntries(Array.from(selectedIds, (id) => [id, true])),
    [selectedIds],
  );

  // BB-B: selection rows are fixed-height (SELECTABLE_ROW_HEIGHT, see
  // selectable-item-row.tsx for the derivation), so FlatList can be told the
  // geometry up-front and skip the per-row onLayout measurement pass. Now
  // that the selection FlatList owns its scroll and renders pageHeader via
  // ListHeaderComponent, every row offset is shifted by the measured header
  // height plus the contentContainer gap between header and first row —
  // the header is measured via onLayout because the hero block's height is
  // dynamic (cover image, description length, i18n). The per-row stride
  // still includes the `selectList` gap (SPACING_CARD); dropping either gap
  // term would drift the windowing math by 12px per row.
  const [selectionHeaderHeight, setSelectionHeaderHeight] = useState(0);
  const onSelectionHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setSelectionHeaderHeight(e.nativeEvent.layout.height);
  }, []);
  const getSelectableRowLayout = useCallback(
    (_data: unknown, index: number) => ({
      length: SELECTABLE_ROW_HEIGHT,
      offset: selectionHeaderHeight + SPACING_CARD + (SELECTABLE_ROW_HEIGHT + SPACING_CARD) * index,
      index,
    }),
    [selectionHeaderHeight],
  );

  // VM-F: hoist the selection-mode FlatList renderItem into a `useCallback`
  // so React.memo on `<SelectableItemRow>` (the row-component memo) can
  // actually skip re-render work for rows whose `selected` flag didn't
  // change between toggles. Pre-VM-F the inline arrow `({ item }) => (...)`
  // allocated a fresh closure every parent render, defeating the row memo.
  // The dep list intentionally carries `selectedById` (rebuilt whenever the
  // selection Set's reference changes) so `<SelectableItemRow>`'s `selected`
  // boolean prop is recomputed; the row memo then compares props and skips
  // for rows whose boolean didn't change. Pair with `extraData={selectedIds}`
  // on the FlatList so virtualization knows to consider re-rendering when
  // the selection set mutates even though `data={visibleItems}` reference is
  // stable across a single toggle. Hoisted above the early returns for the
  // same hook-order reason as `toggleSelect`.
  const renderSelectableRow = useCallback(
    ({ item }: { item: CollectableItem }) => (
      <SelectableItemRow
        item={item}
        selected={!!selectedById[item.id]}
        onToggle={toggleSelect}
      />
    ),
    [selectedById, toggleSelect],
  );

  // Viewer-branch getItemLayout: compact cards are fixed-height
  // (COMPACT_ITEM_CARD_HEIGHT — see item-card.tsx for the derivation, which
  // is what makes this legal: the title reserves a 2-line block and the cost
  // badge renders inside a fixed slot). With `numColumns={2}` FlatList still
  // calls getItemLayout per ITEM index, so the vertical position divides by
  // the column count (the literal 2 must match the numColumns prop below).
  // Same measured-header + row-gap shape as `getSelectableRowLayout`: the
  // ListHeaderComponent's height is dynamic (cover image, i18n) so it's
  // measured via onLayout, and the stride includes the contentContainer's
  // SPACING_LIST row gap.
  const [viewerHeaderHeight, setViewerHeaderHeight] = useState(0);
  const onViewerHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setViewerHeaderHeight(e.nativeEvent.layout.height);
  }, []);
  const getMasonryRowLayout = useCallback(
    (_data: unknown, index: number) => ({
      length: COMPACT_ITEM_CARD_HEIGHT,
      offset:
        viewerHeaderHeight +
        SPACING_LIST +
        (COMPACT_ITEM_CARD_HEIGHT + SPACING_LIST) * Math.floor(index / 2),
      index,
    }),
    [viewerHeaderHeight],
  );

  // VM-F (viewer branch): same hoist for the masonry FlatList — the inline
  // arrow allocated a fresh wrapper closure every parent render, defeating
  // the new React.memo on `<ItemCard>`. No deps: the closure only touches
  // `styles` (module scope) and the row's own `item`.
  const renderMasonryItem = useCallback(
    ({ item }: { item: CollectableItem }) => (
      <View style={styles.masonryItem}>
        <ItemCard item={item} compact />
      </View>
    ),
    [],
  );

  // Handler-stack useCallback promotion: the selection-mode handler stack
  // follows `toggleSelect`'s pattern so the bulk-bar buttons and header
  // select chip receive referentially stable callbacks. Hoisted above the
  // early returns because hooks must run unconditionally — which also means
  // none of these may touch `activeCollection` (narrowed only after the
  // returns); everything they close over is state, context, or the still-
  // nullable `collection`.
  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const performBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await deleteItems(ids);
    toast.success(t("itemsDeleted", { count: ids.length }));
    exitSelectionMode();
  }, [selectedIds, deleteItems, toast, t, exitSelectionMode]);

  const handleBulkDelete = useCallback(() => {
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
  }, [selectedIds, t, performBulkDelete]);

  // Hoisted alongside the handlers that close over it; `collection` is still
  // nullable up here so the self-exclusion uses optional chaining instead of
  // the post-narrow `activeCollection`. Memoized so `handleOpenMove`'s dep
  // doesn't churn every render off a fresh filter() array.
  const otherOwnedCollections = useMemo(
    () => collections.filter((c) => c.role === "owner" && c.id !== collection?.id),
    [collections, collection],
  );

  const handleOpenMove = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (otherOwnedCollections.length === 0) {
      toast.info(t("noOtherCollections"));
      return;
    }
    setMoveModalOpen(true);
  }, [selectedIds, otherOwnedCollections, toast, t]);

  // HM-C1: <MoveCollectionModal> is memoized, so both handlers it receives
  // must be referentially stable useCallbacks (same reason as the bulk-bar's
  // handler stack). Hoisted above the early returns per the hook-order
  // invariant; neither touches the post-narrow `activeCollection`.
  const handleMoveTo = useCallback(
    async (targetCollectionId: string) => {
      const ids = Array.from(selectedIds);
      setMoveModalOpen(false);
      if (ids.length === 0) return;
      await moveItems(ids, targetCollectionId);
      toast.success(t("itemsMoved", { count: ids.length }));
      exitSelectionMode();
    },
    [selectedIds, moveItems, toast, t, exitSelectionMode],
  );

  const closeMoveModal = useCallback(() => setMoveModalOpen(false), []);

  // HM-C2: <CollectionShareSheet> is memoized, so its handlers must be
  // referentially stable. Hoisted above the early returns (hook-order
  // invariant); both share mutations guard on the still-nullable
  // `collection` instead of the post-narrow `activeCollection`.
  const handleShareWithFriend = useCallback(
    (friendId: string) => {
      if (!collection) return;
      shareCollectionWithUser(collection.id, friendId);
    },
    [collection, shareCollectionWithUser],
  );

  const handleUnshareWithUser = useCallback(
    (viewerId: string) => {
      if (!collection) return;
      unshareCollectionWithUser(collection.id, viewerId);
    },
    [collection, unshareCollectionWithUser],
  );

  const closeShareSheet = useCallback(() => setShareOpen(false), []);

  // HM-C3: <EditCollectionModal> is memoized, so every handler it receives
  // must be referentially stable. Hoisted above the early returns
  // (hook-order invariant); `handleSaveEdit` guards on the still-nullable
  // `collection` instead of the post-narrow `activeCollection`.
  const pickEditCoverFromGallery = useCallback(async () => {
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
  }, [toast, t]);

  const pickEditCoverFromCamera = useCallback(async () => {
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
  }, [toast, t]);

  const pickEditCover = useCallback(async () => {
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
  }, [pickEditCoverFromGallery, pickEditCoverFromCamera, t]);

  const handleSaveEdit = useCallback(async () => {
    if (!collection) return;
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
        (collection.visibility ?? "private") !== "private"
          ? "public"
          : editVisibility;
      await updateCollection(collection.id, {
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
  }, [collection, editName, editDescription, editCoverUri, editCoverChanged, editVisibility, editCurrency, isPremium, updateCollection, toast, t]);

  // The edit-mode path defers the save to the modal submit so Cancel still
  // works. Without the mode flag, every pick would persist immediately and
  // break Cancel semantics.
  const openEditCurrencySheet = useCallback(() => {
    setCurrencyQuery("");
    setCurrencySheetMode("edit");
    setCurrencySheetOpen(true);
  }, []);

  const closeEditModal = useCallback(() => setEditModalOpen(false), []);

  // HM-B handler promotion: the four handlers pageHeader closes over move
  // above the early returns as useCallbacks (hook-order invariant), which
  // means none may touch the post-narrow `activeCollection` — each guards on
  // the still-nullable `collection` instead, mirroring `handleOpenMove`.
  const confirmAndDeleteCollection = useCallback(async () => {
    if (!collection) return;
    await deleteCollection(collection.id);
    router.replace("/");
  }, [collection, deleteCollection]);

  const handleDeleteCollection = useCallback(() => {
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
  }, [t, confirmAndDeleteCollection]);

  const handleExportPdf = useCallback(async () => {
    if (!collection) return;
    setExporting(true);
    try {
      await exportCollectionToPdf(collection, allItems, {
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
  }, [collection, allItems, t, toast]);

  const openEditModal = useCallback(() => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description);
    setEditCoverUri(collection.coverPhoto);
    setEditCoverChanged(false);
    setEditVisibility(collection.visibility ?? "private");
    setEditCurrency(collection.currency ?? "");
    setEditModalOpen(true);
  }, [collection]);

  // HM-A (header memoization): the lightweight list-header/footer fragments
  // are useMemo'd so the ListHeaderComponent's children keep a stable element
  // identity across scroll-driven parent re-renders — React bails out of
  // reconciling a subtree whose element reference didn't change between
  // passes. Hoisted above the loading/not-found early returns for the usual
  // hook-order reason; neither fragment may touch the post-narrow
  // `activeCollection` up here (pageHeader/modalsBlock stay un-memoized below
  // for exactly that reason — see HM-B/HM-C in .tasks/.tasks.md).
  const listTitleAndFilters = useMemo(
    () => (
      <>
        <Text style={styles.listTitle}>{t("collectionItems")}</Text>
        {allItems.length > 0 ? (
          <ItemFilterBar filters={itemFilters} onChange={setItemFilters} />
        ) : null}
      </>
    ),
    [allItems.length, itemFilters, t],
  );

  // Manual Load-more CTA — only for the nestable drag-mode fallback, where
  // the NestableDraggableFlatList doesn't own scroll (the outer ScrollView
  // does) so `onEndReached` can't fire reliably. The two scroll-owning
  // FlatList branches (viewer VM-D, selection BB-B) paginate automatically
  // via the hasMore-gated `onEndReached` wiring on each list instead.
  // `loadMore` is referentially stable while the `items` identity is
  // unchanged (useCallback inside useChunkedList), so this memo only
  // re-fires when pagination state actually moves.
  const loadMoreCta = useMemo(
    () =>
      hasMore ? (
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
      ) : null,
    [hasMore, loadMore, items.length, visibleItems.length, t],
  );

  // HM-B: hero + summary + total + reactions + owner-actions — the JSX that
  // sits above the items list in BOTH render paths, wrapped in a single View
  // with a vertical gap so the viewer-FlatList path (where
  // ListHeaderComponent doesn't get the outer ScrollView's `gap: 18`) keeps
  // the original visual rhythm. useMemo'd so the ListHeaderComponent's
  // heaviest child — the hero `<Image>` mounts a Cloudinary fetch — keeps a
  // stable element identity across scroll-driven parent re-renders. Lives
  // above the early returns (hook-order invariant), so the factory guards on
  // the still-nullable `collection` and derives ownership locally instead of
  // reading the post-narrow `activeCollection`/`isOwner` bindings.
  const pageHeader = useMemo(() => {
    if (!collection) return null;
    const owner = user?.id === collection.ownerUserId;
    return (
      <View style={styles.pageHeader}>
        <View style={{...styles.hero, ...(!collection.coverPhoto ? { backgroundColor: placeholderColor(collection.id) } : {})}}>
          {collection.coverPhoto ? (
            <Image
              source={{ uri: withCloudinaryThumbUrl(collection.coverPhoto, { width: 1200, height: 900, mode: "fill" }) }}
              style={styles.heroImage}
            />
          ) : null}
          <LinearGradient
            colors={["rgba(34, 24, 17, 0.08)", "rgba(34, 24, 17, 0.55)"]}
            style={styles.heroOverlay}
          />
          <View style={styles.heroContent}>
            <VisibilityBadge collection={collection} variant="hero" />
            <Text style={styles.heroTitle}>{collection.name}</Text>
            <Text style={styles.heroText}>{collection.description}</Text>
            {collection.role === "owner" && collection.visibility !== "public" ? (
              <Text style={styles.heroMeta}>
                {t("accessOpenFor", { count: collection.sharedWith.length })}
              </Text>
            ) : collection.role !== "owner" ? (
              <Text style={styles.heroMeta}>
                {t("viewingCollectionOf", { name: collection.ownerName })}
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
          const total = getCollectionTotalCost(collection.id);
          if (total.amount <= 0) return null;
          // Owners get tap-to-swap on the total card — opens the currency sheet
          // pre-seeded with the active currency. Saves on the spot, no need to
          // dig into the 3-dot edit modal. Non-owners see a plain View.
          const openCurrencyPicker = () => {
            setEditCurrency(collection.currency ?? total.currency);
            setCurrencyQuery("");
            setCurrencySheetMode("quick");
            setCurrencySheetOpen(true);
          };
          return owner ? (
            <Pressable
              style={styles.summaryCard}
              onPress={openCurrencyPicker}
              accessibilityRole="button"
              accessibilityLabel={t("collectionCurrencyA11y", { currency: total.currency })}
            >
              <CostBadge amount={total.amount} currency={total.currency} style={styles.summaryNumber} />
              <Text style={styles.summaryLabel}>{t("totalCost")}</Text>
            </Pressable>
          ) : (
            <View style={styles.summaryCard}>
              <CostBadge amount={total.amount} currency={total.currency} style={styles.summaryNumber} />
              <Text style={styles.summaryLabel}>{t("totalCost")}</Text>
            </View>
          );
        })()}

        <ReactionBar targetType="collection" targetId={collection.id} />

        {owner ? (
          <View style={styles.ownerActions}>
            <Pressable style={styles.editCollectionButton} onPress={openEditModal}>
              <Text style={styles.editCollectionButtonText}>{t("editCollection")}</Text>
            </Pressable>
            <Link href={{ pathname: "/create", params: { collectionId: collection.id } }} asChild>
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
            {isCollectionFollowed(collection.id) ? (
              <Pressable style={styles.unfollowButton} onPress={() => void unfollowCollection(collection.id)}>
                <Text style={styles.unfollowButtonText}>{t("unfollowCollection")}</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.addButton} onPress={() => void followCollection(collection.id)}>
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
  }, [
    collection,
    allItems,
    theme,
    user?.id,
    exporting,
    selectionMode,
    t,
    getCollectionTotalCost,
    isCollectionFollowed,
    followCollection,
    unfollowCollection,
    openEditModal,
    enterSelectionMode,
    handleExportPdf,
    handleDeleteCollection,
  ]);

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

  const modalsBlock = (
    <>
      <MoveCollectionModal
        visible={moveModalOpen}
        collections={otherOwnedCollections}
        onMove={handleMoveTo}
        onClose={closeMoveModal}
      />

      <CollectionShareSheet
        visible={shareOpen}
        collectionId={activeCollection.id}
        collectionName={activeCollection.name}
        sharedWithUserIds={sharedWithUserIds}
        isOwner={isOwner}
        friends={friends}
        getProfileById={getProfileById}
        onShare={handleShareWithFriend}
        onUnshare={handleUnshareWithUser}
        onClose={closeShareSheet}
      />

      <EditCollectionModal
        visible={editModalOpen}
        name={editName}
        description={editDescription}
        coverUri={editCoverUri}
        visibility={editVisibility}
        currency={editCurrency}
        saving={editSaving}
        isPremium={isPremium}
        savedVisibility={activeCollection.visibility}
        onChangeName={setEditName}
        onChangeDescription={setEditDescription}
        onChangeVisibility={setEditVisibility}
        onPickCover={pickEditCover}
        onOpenCurrencySheet={openEditCurrencySheet}
        onSave={handleSaveEdit}
        onClose={closeEditModal}
      />

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
            <View style={styles.viewerListHeader} onLayout={onViewerHeaderLayout}>
              {pageHeader}
              <View style={styles.listWrap}>{listTitleAndFilters}</View>
            </View>
          }
          renderItem={renderMasonryItem}
          getItemLayout={getMasonryRowLayout}
          // Native pagination: auto-extend the chunked window as the user
          // scrolls within half a viewport of the end — replaces the manual
          // Load-more CTA the nested-ScrollView era needed. `undefined` once
          // the window covers every item so FlatList stops calling back.
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.5}
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

  // BB-B: selection mode owns its scroll. Pre-BB-B the selection FlatList
  // sat inside `<Screen nestable>` with `scrollEnabled={false}`, so no real
  // virtualization could kick in and the absolutely-pinned bulk-bar created
  // an iOS touch fall-through near the bar. Mirrors VM-D's early-return
  // shape: the FlatList owns scroll, pageHeader + title/filters ride in
  // ListHeaderComponent, the bulk-bar spacer rides in ListFooterComponent
  // (the spacer keeps the last rows scrollable clear of the bar; pagination
  // is onEndReached-driven so no Load-more CTA), and <BulkBar> is a sibling
  // OUTSIDE the FlatList's render tree so its touches never race the list's
  // responder.
  if (isOwner && selectionMode && allItems.length > 0) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: activeCollection.name }} />
        <Profiler id="selection-flatlist" onRender={onSelectionProfilerRender}>
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            renderItem={renderSelectableRow}
            extraData={selectedIds}
            getItemLayout={getSelectableRowLayout}
            contentContainerStyle={styles.selectList}
            ListHeaderComponent={
              <View style={styles.viewerListHeader} onLayout={onSelectionHeaderLayout}>
                {pageHeader}
                <View style={styles.listWrap}>{listTitleAndFilters}</View>
              </View>
            }
            ListFooterComponent={<View style={styles.bulkBarSpacer} />}
            onEndReached={hasMore ? loadMore : undefined}
            onEndReachedThreshold={0.5}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            // BB-C: windowSize 7 (not the nested-era 5) — now that this
            // FlatList owns its scroll, the window is what prevents blank
            // rows during fast flicks; 5 viewports was tuned for the old
            // nested shape where the outer ScrollView mounted everything
            // anyway. 7 trades ~2 extra offscreen rows of memory for
            // flick-resilience; the viewer branch keeps 5 because its
            // 2-column masonry mounts twice the cards per viewport.
            windowSize={7}
            removeClippedSubviews={Platform.OS === "ios"}
            style={styles.viewerFlatList}
          />
        </Profiler>
        <BulkBar
          count={selectedIds.size}
          onMove={handleOpenMove}
          onDelete={handleBulkDelete}
          onCancel={exitSelectionMode}
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
        ) : null}
        {loadMoreCta}
      </View>



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
    gap: SPACING_INLINE,
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
    gap: SPACING_CARD,
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
    gap: SPACING_CARD,
  },
  loadMore: {
    borderRadius: RADIUS_CARD,
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
    gap: SPACING_CARD,
  },
  exportButton: {
    borderRadius: RADIUS_CARD,
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
    borderRadius: RADIUS_CARD,
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
  addButton: {
    borderRadius: RADIUS_CARD,
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
    borderRadius: RADIUS_CARD,
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
    borderRadius: RADIUS_CARD,
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
    borderRadius: RADIUS_CARD,
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
    gap: SPACING_CARD,
  },
  masonryList: {
    gap: SPACING_LIST,
  },
  masonryRow: {
    gap: SPACING_LIST,
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
    gap: SPACING_LIST,
  },
  bulkBarSpacer: {
    height: 120,
  },
  editCollectionButton: {
    borderRadius: RADIUS_CARD,
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
});
