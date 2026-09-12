import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type ProfilerOnRenderCallback } from "react";
import { Alert, FlatList, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { LoadMoreButton } from "@/components/load-more-button";
import { applyItemFilters, applySortMode, EMPTY_FILTERS, ItemFilterBar, type ItemFilters, type ItemSortMode } from "@/components/item-filters";
import { VisibilityBadge } from "@/components/visibility-badge";
import { SkeletonCollectionDetail } from "@/components/skeleton";
import { NestableDraggableFlatList, RenderItemParams, ScaleDecorator } from "../../components/DraggableList";

import { COMPACT_ITEM_CARD_HEIGHT, ItemCard } from "@/components/item-card";
import { ReactionBar } from "@/components/reaction-bar";
import { CostBadge } from "@/components/cost-badge";
import { CollectionShareSheet } from "@/components/collection-share-sheet";
import { CurrencySheet } from "@/components/currency-sheet";
import { DangerSection } from "@/components/danger-section";
import { EditCollectionModal } from "@/components/edit-collection-modal";
import { MoveCollectionModal } from "@/components/move-collection-modal";
import { Screen, useResponsive } from "@/components/screen";
import { BulkBar } from "@/components/bulk-bar";
import { SELECTABLE_ROW_HEIGHT, SelectableItemRow } from "@/components/selectable-item-row";
import { useMinimumVisible } from "@/lib/use-minimum-visible";
import { useAuth } from "@/lib/auth-context";
import { uploadImage } from "@/lib/cloudinary";
import { withCloudinaryThumbUrl } from "@/lib/cloudinary-url";
import { useCollections } from "@/lib/collections-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { openListingsForItems } from "@/lib/marketplace-helpers";
import { announceMessage } from "@/lib/announce";
import { byId, orderWithUnrenderedTail, planDragCommit } from "@/lib/drag-reorder";
import { reorderActionProps } from "@/lib/reorder-actions";
import { announceReorder } from "@/lib/reorder-announcement";
import { flatListStyles } from "@/lib/flat-list-styles";
import { useChunkedList } from "@/lib/use-chunked-list";
import { useItemSortPref } from "@/lib/use-item-sort-pref";
import { exportCollectionToPdf } from "@/lib/export-pdf";
import { useI18n } from "@/lib/i18n-context";
import { getDefaultLocaleForLanguage } from "@/lib/locale-helpers";
import { placeholderColor } from "@/lib/placeholder-color";
import { usePremium } from "@/lib/premium-context";
import { clampVisibilityForSave } from "@/lib/premium-helpers";
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
  CARD_BG_13,
  HERO_DARK,
  HERO_DARK_2,
  MUTED_3,
  MUTED_5,
  PURE_WHITE,
  RADIUS_CARD,
  RADIUS_CARD_SM,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
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
import { PHOTO_SCRIM_GRADIENT } from "@/lib/gradients";

export default function CollectionDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const {
    collections,
    getCollectionById,
    getItemsForCollection,
    getCollectionTotalCost,
    convertItemCost,
    deleteCollection,
    deleteItems,
    archiveItems,
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
  const { t, language } = useI18n();
  const toast = useToast();
  const { isPremium } = usePremium();
  const theme = useAppTheme();
  const [selectionMode, setSelectionMode] = useState(false);
  // Owners default to the card GRID (the trading cards tile 2/3/4 across).
  // Drag-to-reorder needs a single column — react-native-draggable-flatlist has
  // no multi-column mode, and a wrapped grid would hand onDragEnd a row order
  // that doesn't match what the user sees — so reordering is an explicit mode
  // the owner opts into from the actions row, mirroring how selection mode
  // already takes over the list.
  const [reorderMode, setReorderMode] = useState(false);
  const { myListings, removeListing } = useMarketplace();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [itemFilters, setItemFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  // The sort — and ONLY the sort — survives leaving the screen. A query or a
  // tag filter is the question the user is asking right now; the sort is how
  // they like to read this collection, and re-picking it on every visit is two
  // taps behind a sheet. See lib/item-sort-prefs.ts.
  const [restoredSort, rememberSort] = useItemSortPref(params.id);
  // Applied once, and never over a choice the user has already made: the read
  // is async, so a user who opens the sheet and picks a sort in the meantime
  // must not have it replaced by the one the store was still fetching.
  const sortRestoredRef = useRef(false);
  const applyFilters = useCallback(
    (next: ItemFilters) => {
      sortRestoredRef.current = true;
      setItemFilters(next);
      rememberSort(next.sort);
    },
    [rememberSort],
  );
  useEffect(() => {
    sortRestoredRef.current = false;
  }, [params.id]);
  useEffect(() => {
    if (restoredSort === null || sortRestoredRef.current) return;
    sortRestoredRef.current = true;
    if (restoredSort === "default") return;
    setItemFilters((current) => ({ ...current, sort: restoredSort }));
  }, [restoredSort]);
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
  // The collator follows the language the user PINNED in the app, not the
  // device's. Without this the comparator falls back to the JS runtime default
  // — the device locale on native, but often `en-US` on a server-rendered web
  // preview — so a Russian user reading the app in Polish could see an
  // alphabetical order that disagrees with every label around it.
  const sortLocale = useMemo(() => getDefaultLocaleForLanguage(language), [language]);
  // applySortMode runs AFTER the price/date/source/query filter pass so the
  // sort (title, cost or acquisition date) applies to the already-narrowed
  // result set. Memoized
  // on [filteredItems, itemFilters.sort, sortLocale] so a sort-mode change
  // reuses the existing filtered slice without re-running the filter
  // predicate, and a language switch re-sorts under the new collation rules.
  const items = useMemo(
    () => applySortMode(filteredItems, itemFilters.sort, sortLocale),
    [filteredItems, itemFilters.sort, sortLocale],
  );
  // Chunked rendering: mount only the first page of item cards (~20) up-front
  // so iOS RAM stays bounded as the collection grows. `useChunkedList` resets
  // its window automatically when the `items` reference changes (filter or
  // sort swap) because `items` is memoized on `[filteredItems, itemFilters.sort]`
  // above and `filteredItems` is memoized on `[allItems, itemFilters]`.
  const { visibleItems, hasMore, remaining, loadMore } = useChunkedList(items);
  // The page as it is NOW, for a keyboard move that fires after the render
  // that drew the row — a `loadMore` or a cloud merge between a screen reader
  // focusing a row and the action firing would otherwise commit the order the
  // user is no longer looking at. See ReorderRows in lib/reorder-actions.ts.
  const visibleItemsRef = useRef(visibleItems);
  visibleItemsRef.current = visibleItems;

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

  // Responsive masonry column count: 2 on mobile (and always on native —
  // useResponsive's tablet/desktop breakpoints are web-only), 3 on tablet,
  // 4 on desktop, so wide layouts stop wasting horizontal space. The count
  // must thread through numColumns, getMasonryRowLayout's row math AND the
  // FlatList `key` — React Native forbids changing numColumns on a mounted
  // list, so a breakpoint flip (web window resize) remounts via the key.
  const { isTablet, isDesktop } = useResponsive();
  const masonryColumnCount = isDesktop ? 4 : isTablet ? 3 : 2;

  // Viewer-branch getItemLayout: compact cards are fixed-height
  // (COMPACT_ITEM_CARD_HEIGHT — see item-card.tsx for the derivation, which
  // is what makes this legal: the title reserves a 2-line block and the cost
  // badge renders inside a fixed slot). With `numColumns` set FlatList still
  // calls getItemLayout per ITEM index, so the vertical position divides by
  // the column count (masonryColumnCount — the same value numColumns gets).
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
        (COMPACT_ITEM_CARD_HEIGHT + SPACING_LIST) *
          Math.floor(index / masonryColumnCount),
      index,
    }),
    [viewerHeaderHeight, masonryColumnCount],
  );

  // VM-F (viewer branch): same hoist for the masonry FlatList — the inline
  // arrow allocated a fresh wrapper closure every parent render, defeating
  // the new React.memo on `<ItemCard>`. No deps: the closure only touches
  // `styles` (module scope) and the row's own `item`. The cell's `flex: 1`
  // rides on ItemCard's forwarded `style` prop — the old per-item wrapper
  // View cost one extra node per cell × hundreds of cells.
  const renderMasonryItem = useCallback(
    ({ item }: { item: CollectableItem }) => (
      <ItemCard item={item} compact style={styles.masonryItem} />
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

  /**
   * The open listings inside the current selection.
   *
   * The single-item archive and the single-item delete each retire one before
   * letting the item go; the bulk delete asked nothing, so thirty rows left
   * storage and thirty standing offers stayed on every buyer's device. Both
   * bulk resolutions read this: it says how many to warn about, which ids to
   * remove, and whether to bother.
   */
  const selectedOpenListings = useMemo(
    () => openListingsForItems(myListings, Array.from(selectedIds)),
    [myListings, selectedIds],
  );

  /** The sentence the confirms gain when the selection includes a listing. */
  const listedWarning = useCallback(
    () =>
      selectedOpenListings.length > 0
        ? ` ${t("bulkListedWarning", { count: selectedOpenListings.length })}`
        : "",
    [selectedOpenListings, t],
  );

  const retireSelectedListings = useCallback(() => {
    for (const listing of selectedOpenListings) removeListing(listing.id);
  }, [selectedOpenListings, removeListing]);

  const performBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // The listings first, for the same reason the single-item paths do it:
    // an item removed first is one whose listing removal can be lost.
    retireSelectedListings();
    await deleteItems(ids);
    toast.success(t("itemsDeleted", { count: ids.length }));
    exitSelectionMode();
  }, [selectedIds, retireSelectedListings, deleteItems, toast, t, exitSelectionMode]);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    const title = t("deleteItemsTitle", { count });
    const message = `${t("deleteItemsText")}${listedWarning()}`;

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
  }, [selectedIds, t, listedWarning, performBulkDelete]);

  const performBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    retireSelectedListings();
    await archiveItems(ids);
    toast.success(t("itemsArchived", { count: ids.length }));
    exitSelectionMode();
  }, [selectedIds, retireSelectedListings, archiveItems, toast, t, exitSelectionMode]);

  /**
   * Archiving a selection asks only when it would withdraw a listing.
   *
   * The single-item action takes no confirm for an unlisted item — archiving
   * is reversible from the item's own banner and from `app/archive.tsx` — and
   * the bulk version keeps that rule rather than inventing a stricter one for
   * the same act done thirty times. What is NOT reversible is the listing
   * removal, which is exactly when this asks.
   */
  const handleBulkArchive = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (selectedOpenListings.length === 0) {
      void performBulkArchive();
      return;
    }
    const title = t("archiveItemsTitle", { count });
    const message = `${t("archiveItemsText")}${listedWarning()}`;

    if (Platform.OS === "web") {
      if (globalThis.confirm(`${title}\n\n${message}`)) {
        void performBulkArchive();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      { text: t("archiveAction"), onPress: () => void performBulkArchive() },
    ]);
  }, [selectedIds, selectedOpenListings, t, listedWarning, performBulkArchive]);

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
      mediaTypes: ["images"],
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
      mediaTypes: ["images"],
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
      // Defence in depth, and unreachable through the UI on purpose:
      // `openEditModal` seeds `editVisibility` from the collection, and the
      // sheet's locked chip returns before changing it, so a free user cannot
      // arrive here having selected "private" on a public collection. Kept
      // because the day that stops being true this is the only thing between a
      // bypassed chip and a private collection on a free account — and routed
      // through `clampVisibilityForSave` because the three clauses spelled out
      // here were a third copy of the sheet's rule, already free to drift.
      const finalVisibility: CollectionVisibility = clampVisibilityForSave(
        isPremium,
        editVisibility,
        collection.visibility ?? "private",
      );
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

  // HM-C4: <CurrencySheet> is memoized, so both handlers it receives must be
  // referentially stable. Quick-swap path: persist on the spot so the total
  // card re-renders in the new currency without a follow-up modal save.
  const handleCurrencySelect = useCallback(
    (code: string) => {
      setEditCurrency(code);
      setCurrencySheetOpen(false);
      if (currencySheetMode === "quick" && collection) {
        void updateCollection(collection.id, { currency: code });
      }
    },
    [currencySheetMode, collection, updateCollection],
  );

  const closeCurrencySheet = useCallback(() => setCurrencySheetOpen(false), []);

  // HM-B handler promotion: the four handlers pageHeader closes over move
  // above the early returns as useCallbacks (hook-order invariant), which
  // means none may touch the post-narrow `activeCollection` — each guards on
  // the still-nullable `collection` instead, mirroring `handleOpenMove`.
  /**
   * The open listings for everything in this collection.
   *
   * `deleteCollection` removes the collection AND every item in it, which
   * makes it the largest departure path in the app — and it was the one the
   * listing rule never reached, because the sweep that found the others read
   * mutations taking an item id and this one takes a collection id. Deleting a
   * collection of thirty left thirty standing offers on every buyer's device,
   * each pointing at an item that no longer exists anywhere.
   */
  const collectionOpenListings = useMemo(
    () => openListingsForItems(myListings, allItems.map((item) => item.id)),
    [myListings, allItems],
  );

  const confirmAndDeleteCollection = useCallback(async () => {
    if (!collection) return;
    // Before the delete, for the same reason every other departure path does
    // it first: the items are gone afterwards and so is the list to read.
    for (const listing of collectionOpenListings) removeListing(listing.id);
    await deleteCollection(collection.id);
    router.replace("/");
  }, [collection, collectionOpenListings, removeListing, deleteCollection]);

  const handleDeleteCollection = useCallback(() => {
    // The same counted sentence the bulk confirms use: this is the bulk delete
    // with the selection implied, so a separate string would be the same
    // warning written twice.
    const body =
      collectionOpenListings.length > 0
        ? `${t("deleteCollectionText")} ${t("bulkListedWarning", { count: collectionOpenListings.length })}`
        : t("deleteCollectionText");
    const message = `${t("deleteCollectionTitle")} ${body}`;

    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) {
        void confirmAndDeleteCollection();
      }
      return;
    }

    Alert.alert(t("deleteCollectionTitle"), body, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          void confirmAndDeleteCollection();
        },
      },
    ]);
  }, [t, collectionOpenListings, confirmAndDeleteCollection]);

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
      }, {
        // The same two answers the summary card and every `<CostBadge>` on
        // this screen are already showing. The export used to sum the raw
        // `cost` fields itself, so the one artifact a user keeps was the one
        // place that converted nothing, printed no currency and ignored the
        // collection's own `currency` override.
        total: getCollectionTotalCost(collection.id),
        itemCost: (item) => convertItemCost(item, collection.currency ?? undefined),
      });
      toast.success(t("exportPdfDone"));
    } catch {
      toast.error(t("exportPdfFailed"));
    } finally {
      setExporting(false);
    }
  }, [collection, allItems, getCollectionTotalCost, convertItemCost, t, toast]);

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
  // Reorder mode is silently inert while a sort is active (see the
  // `isDragBranch` derivation below: onDragEnd re-writes `sortOrder` from the
  // VISIBLE order, so dragging a sorted list — by title, cost or acquisition
  // date — would corrupt the manual one). Without this notice the owner taps "Reorder", the button lights up,
  // and nothing becomes draggable — indistinguishable from a broken button.
  // Gated on reorderMode so a sorted owner who never asked to reorder isn't
  // nagged. Derives ownership locally: this memo lives above the early returns
  // that narrow `collection`, so `isOwner` isn't in scope yet.
  const reorderBlockedBySort =
    !!collection &&
    user?.id === collection.ownerUserId &&
    !selectionMode &&
    reorderMode &&
    itemFilters.sort !== "default";

  // The notice above is `accessibilityRole="alert"`, which announces itself on
  // Android and on web and does NOT on iOS, where VoiceOver reads an alert only
  // when it happens to reach it. It also lives in the list header, which a user
  // deep in a long collection has scrolled past. So the moment the gate closes
  // is said out loud as well: without it a screen-reader owner taps "Reorder",
  // the two move actions are simply absent from every row, and nothing anywhere
  // explains why — the same "indistinguishable from a broken button" the notice
  // was added for, in the one place the notice cannot reach.
  //
  // On the transition only. `reorderBlockedBySort` is recomputed every render,
  // and announcing on each would interrupt the reader mid-sentence for as long
  // as the sort is on.
  useEffect(() => {
    if (!reorderBlockedBySort) return;
    announceMessage(t("reorderBlockedBySort"));
  }, [reorderBlockedBySort, t]);

  // Not routed through `applyFilters`: the functional updater is what keeps
  // this changing ONLY the sort, and taking `itemFilters` as a dep to build
  // the object instead would give the callback a new identity on every
  // keystroke in the search box — the identity HM-A's memo depends on.
  const applySort = useCallback(
    (sort: ItemSortMode) => {
      sortRestoredRef.current = true;
      rememberSort(sort);
      setItemFilters((current) => ({ ...current, sort }));
    },
    [rememberSort],
  );
  const resetSort = useCallback(() => applySort("default"), [applySort]);

  /**
   * Reorder mode does the thing the owner asked for.
   *
   * The notice below explains why dragging is off while a sort is on, which
   * fixed the broken-button feel and left the owner two taps from the state
   * they requested: tap Reorder, read, tap Reset. Clearing the sort on the way
   * IN is the direct path — and now that the sort persists across visits, the
   * notice would otherwise be arguing about a choice made weeks ago.
   *
   * With an undo, because this discards something the owner chose: the toast
   * carries the mode back, and an actionable toast gets a longer window than a
   * reporting one (lib/toast-timing.ts). The notice keeps its job for the case
   * it was written for — a sort applied WHILE reorder mode is already on.
   */
  const toggleReorderMode = useCallback(() => {
    const entering = !reorderMode;
    setReorderMode(entering);
    if (!entering || itemFilters.sort === "default") return;
    const previous = itemFilters.sort;
    applySort("default");
    // The clear is announced by `toast.show` itself now — every toast is —
    // so there is no hand-written call here. The UNDO still needs one: it
    // shows no toast of its own, and a user who presses it and hears nothing
    // has only the list they cannot see as evidence that it worked.
    toast.show({
      type: "info",
      message: t("sortClearedForReorder"),
      action: {
        label: t("undo"),
        onPress: () => {
          applySort(previous);
          announceMessage(t("sortRestored"));
        },
      },
    });
  }, [applySort, itemFilters.sort, reorderMode, t, toast]);

  const listTitleAndFilters = useMemo(
    () => (
      <>
        <Text style={styles.listTitle}>{t("collectionItems")}</Text>
        {allItems.length > 0 ? (
          <ItemFilterBar filters={itemFilters} onChange={applyFilters} />
        ) : null}
        {reorderBlockedBySort ? (
          <View style={styles.reorderNotice} accessibilityRole="alert">
            <Text style={styles.reorderNoticeText}>{t("reorderBlockedBySort")}</Text>
            <Pressable
              style={styles.reorderNoticeAction}
              onPress={resetSort}
              accessibilityRole="button"
              accessibilityLabel={t("reorderResetSort")}
            >
              <Text style={styles.reorderNoticeActionText}>{t("reorderResetSort")}</Text>
            </Pressable>
          </View>
        ) : null}
      </>
    ),
    [allItems.length, applyFilters, itemFilters, reorderBlockedBySort, resetSort, t],
  );

  // Manual Load-more CTA — only for the nestable drag-mode fallback, where
  // the NestableDraggableFlatList doesn't own scroll (the outer ScrollView
  // does) so `onEndReached` can't fire reliably. The two scroll-owning
  // FlatList branches (viewer VM-D, selection BB-B) paginate automatically
  // via the hasMore-gated `onEndReached` wiring on each list instead.
  // `loadMore` is referentially stable while the `items` identity is
  // unchanged (useCallback inside useChunkedList), so this memo only
  // re-fires when pagination state actually moves.
  // `hasMore` left the deps with the button: `<LoadMoreButton>` renders
  // nothing at a `remaining` of zero, which is the same fact — `hasMore` IS
  // `items.length > visibleItems.length`, and both numbers are already here.
  const loadMoreCta = useMemo(
    () => (
      <LoadMoreButton remaining={remaining} onPress={loadMore} />
    ),
    [loadMore, remaining],
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
          <LinearGradient {...PHOTO_SCRIM_GRADIENT} style={styles.heroOverlay} />
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
            <Pressable
              style={styles.editCollectionButton}
              onPress={openEditModal}
              accessibilityRole="button"
            >
              <Text style={styles.editCollectionButtonText}>{t("editCollection")}</Text>
            </Pressable>
            <Link href={{ pathname: "/create", params: { collectionId: collection.id } }} asChild>
              <Pressable style={styles.addButton}>
                <Text style={styles.addButtonText}>{t("addItemToCollection")}</Text>
              </Pressable>
            </Link>
            {allItems.length > 0 && !selectionMode ? (
              <Pressable
                style={styles.selectButton}
                onPress={enterSelectionMode}
                accessibilityRole="button"
              >
                <Text style={styles.selectButtonText}>{t("selectItems")}</Text>
              </Pressable>
            ) : null}
            {allItems.length > 0 && !selectionMode ? (
              <Pressable
                style={reorderMode ? styles.reorderButtonActive : styles.reorderButton}
                onPress={toggleReorderMode}
                accessibilityRole="button"
                accessibilityState={{ selected: reorderMode }}
              >
                <Text style={reorderMode ? styles.reorderButtonActiveText : styles.reorderButtonText}>
                  {reorderMode ? t("reorderItemsDone") : t("reorderItems")}
                </Text>
              </Pressable>
            ) : null}
            {allItems.length > 0 ? (
              <Pressable
                style={{...styles.exportButton, ...(exporting ? styles.exportButtonDisabled : {})}}
                onPress={() => void handleExportPdf()}
                disabled={exporting}
                accessibilityState={{ disabled: exporting }}
                accessibilityRole="button"
              >
                <Text style={styles.exportButtonText}>{exporting ? t("exportPdfGenerating") : t("exportPdf")}</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.shareButton}
              onPress={() => setShareOpen(true)}
              accessibilityRole="button"
            >
              <Text style={styles.shareButtonText}>{t("share")}</Text>
            </Pressable>
            <DangerSection
              shape="block"
              actionLabel={t("deleteCollection")}
              onAction={handleDeleteCollection}
            />
          </View>
        ) : (
          <View style={styles.ownerActions}>
            {isCollectionFollowed(collection.id) ? (
              <Pressable
                style={styles.unfollowButton}
                onPress={() => void unfollowCollection(collection.id)}
                accessibilityRole="button"
              >
                <Text style={styles.unfollowButtonText}>{t("unfollowCollection")}</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.addButton}
                onPress={() => void followCollection(collection.id)}
                accessibilityRole="button"
              >
                <Text style={styles.addButtonText}>{t("followCollection")}</Text>
              </Pressable>
            )}
            {allItems.length > 0 ? (
              <Pressable
                style={{...styles.exportButton, ...(exporting ? styles.exportButtonDisabled : {})}}
                onPress={() => void handleExportPdf()}
                disabled={exporting}
                accessibilityState={{ disabled: exporting }}
                accessibilityRole="button"
              >
                <Text style={styles.exportButtonText}>{exporting ? t("exportPdfGenerating") : t("exportPdf")}</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.shareButton}
              onPress={() => setShareOpen(true)}
              accessibilityRole="button"
            >
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
    reorderMode,
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

  // Keeps the pull-to-refresh spinner legible when refresh() resolves from
  // cache — see lib/minimum-visible-helpers.ts for why this is a trailing
  // hold and not a leading debounce.
  const showRefreshing = useMinimumVisible(refreshing);

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

  // Drag-to-reorder is reachable only when the owner opts into reorder mode AND
  // the list is unsorted: onDragEnd re-writes `sortOrder` from the VISIBLE order,
  // so dragging under ANY non-default sort (title, cost or acquisition date)
  // would silently corrupt the manual order. Either gate failing hands the owner back to the read-only card grid.
  const isDragBranch = isOwner && !selectionMode && reorderMode && itemFilters.sort === "default";

  // The whole order to persist after one row moves — from the drag, and from
  // the keyboard actions on each row, which is why this is a function and no
  // longer three lines inside `onDragEnd`.
  //
  // `reorderItemsInCollection` renumbers `sortOrder` from the list it is
  // handed, and the list on screen is a paginated WINDOW. Writing back only
  // the visible slice would renumber it 0..N-1 and shuffle it past everything
  // below the page boundary — corrupting the manual order of rows the user
  // never saw. `orderWithUnrenderedTail` appends that unrendered tail in the
  // order it already had; see `lib/drag-reorder.ts`.
  const commitItemOrder = (page: CollectableItem[]) => {
    reorderItemsInCollection(activeCollection.id, orderWithUnrenderedTail(page, items));
  };

  /**
   * The reorder a long press cannot do, on the rows a collector actually
   * reorders.
   *
   * Gated on `isDragBranch` rather than on `isOwner` alone: under a non-default
   * sort the visible order is not the manual one, so committing it — from a
   * keyboard just as much as from a drag — corrupts what the owner arranged.
   * The screen already says so in the reorder-blocked notice; these actions
   * disappear for the same reason, and `enabled` is how that reaches
   * `reorderActionProps` in `lib/reorder-actions.ts`, which owns the rest of
   * the wiring for both screens.
   *
   * Both routes speak. The pick-up and the landing were feedback a sighted user
   * got for free — a dimmed row, a row in a new place — and nothing else, so
   * reorder mode was silent to exactly the user the actions were added for.
   * See `lib/reorder-announcement.ts`, which also decides when NOT to speak.
   */
  const renderItemRow = ({ item, drag, isActive, getIndex }: RenderItemParams<CollectableItem>) => {
    const index = getIndex();
    const reorderActions = reorderActionProps({
      rows: () => visibleItemsRef.current,
      index,
      enabled: isDragBranch,
      label: t,
      commit: commitItemOrder,
      announce: (key, at, total) => announceReorder(t, key, at, total),
      // A viewer gets no long press at all — not one that announces a pick-up
      // they cannot perform.
      drag: isOwner ? drag : undefined,
      // By id, not by reference: a cloud merge rebuilds the objects, so the
      // same item comes back as a new one and only the id survives.
      identify: { row: item, keyOf: byId },
    });

    return (
      <ScaleDecorator>
        <Pressable
          disabled={isActive}
          accessibilityState={{ disabled: isActive }}
          delayLongPress={150}
          {...reorderActions}
        >
          <ItemCard item={item} />
        </Pressable>
      </ScaleDecorator>
    );
  };

  // VM-D: When the viewer/read-only branch (the multi-column FlatList case)
  // is active, hoist the outer scroll INTO the FlatList itself so iOS can
  // recycle off-screen rows. Pre-VM-D the inner FlatList lived inside a
  // ScrollView with its scrolling disabled and every item card mounted up-
  // front — virtualization can't kick in unless the FlatList owns the scroll. The
  // drag-mode and selection-mode branches stay on `<Screen nestable>` since
  // drag needs `NestableScrollContainer`'s gesture coordination and selection
  // renders a non-virtualized vertical list (VM-E migrates selection too).
  const isViewerFlatListBranch =
    items.length > 0 && (!isOwner || (!selectionMode && !isDragBranch));

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
        onSelect={handleCurrencySelect}
        onClose={closeCurrencySheet}
      />
    </>
  );

  if (isViewerFlatListBranch) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: activeCollection.name }} />
        <FlatList
          // numColumns can't change on a mounted list (RN throws) — the key
          // remounts the list when a web resize crosses a breakpoint.
          key={`viewer-masonry-${masonryColumnCount}`}
          data={visibleItems}
          numColumns={masonryColumnCount}
          keyExtractor={(item) => item.id}
          columnWrapperStyle={styles.masonryRow}
          contentContainerStyle={flatListStyles.viewerFlatListContent}
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
              refreshing={showRefreshing}
              onRefresh={handleRefresh}
              tintColor={ACCENT_DEEP}
              colors={[ACCENT_DEEP]}
            />
          }
          style={flatListStyles.viewerFlatList}
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
            style={flatListStyles.viewerFlatList}
          />
        </Profiler>
        <BulkBar
          count={selectedIds.size}
          onMove={handleOpenMove}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onCancel={exitSelectionMode}
        />
        {modalsBlock}
      </Screen>
    );
  }

  return (
    <Screen nestable refreshing={showRefreshing} onRefresh={handleRefresh}>
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
            onAction={() => applyFilters(EMPTY_FILTERS)}
            compact
          />
        ) : isDragBranch ? (
          // See the `isDragBranch` derivation above: reorder mode must be on
          // AND the sort must be default, otherwise onDragEnd would re-write
          // `sortOrder` from the visible (sorted) order and silently
          // corrupt the manual drag order. When either gate falls through the
          // early-return above hands owners back to the card-grid branch.
          <NestableDraggableFlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItemRow}
            // The tail-append rule lives in `commitItemOrder` now, because the
            // keyboard actions on each row need the same one. See
            // `orderWithUnrenderedTail`.
            // `data` is the list's copy of what it DREW. `planDragCommit`
            // re-reads the visible rows so a merge that landed mid-gesture is
            // not reverted by the commit; see lib/drag-reorder.ts.
            onDragEnd={({ data, to }) => {
              const plan = planDragCommit({
                data,
                to,
                rows: visibleItemsRef.current,
                keyOf: byId,
              });
              if (!plan) return;
              commitItemOrder(plan.rows);
              announceReorder(t, "reorderMoved", plan.to, plan.rows.length);
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
  // Reorder toggle — same chrome as the select chip, filled when the mode is on
  // so the owner can see at a glance that the list has left grid layout.
  reorderButton: {
    borderRadius: RADIUS_CARD,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    backgroundColor: CARD_BG_3,
    alignItems: "center",
  },
  reorderButtonText: {
    color: HERO_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  reorderButtonActive: {
    borderRadius: RADIUS_CARD,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: HERO_DARK_2,
    backgroundColor: HERO_DARK_2,
    alignItems: "center",
  },
  reorderButtonActiveText: {
    color: TEXT_ON_DARK_4,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  reorderNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING_INLINE,
    flexWrap: "wrap",
    borderRadius: RADIUS_CARD_SM,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    backgroundColor: CARD_BG_3,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  reorderNoticeText: {
    flex: 1,
    minWidth: 180,
    color: MUTED_3,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_BODY,
  },
  reorderNoticeAction: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: ACCENT_DEEP,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  reorderNoticeActionText: {
    color: ACCENT_DEEP,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
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
  // VM-D's viewerFlatList / viewerFlatListContent moved to the shared
  // `lib/flat-list-styles.ts` (WLF-A) so other screens adopting the
  // scroll-owning-FlatList pattern import them instead of copying.
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
