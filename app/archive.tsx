import { Stack, router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ARCHIVE_ROW_HEIGHT, ArchiveRow } from "@/components/archive-row";
import { BulkBar } from "@/components/bulk-bar";
import { EmptyState } from "@/components/empty-state";
import { LoadMoreButton } from "@/components/load-more-button";
import { Screen } from "@/components/screen";
import { announceMessage } from "@/lib/announce";
import { useCollections } from "@/lib/collections-context";
import { confirmDialog } from "@/lib/confirm-dialog";
import {
  ACCENT_DEEP,
  HERO_DARK,
  MUTED_22,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_ON_DARK,
  TEXT_ON_DARK_MUTED,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_DISPLAY } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import { flatListStyles } from "@/lib/flat-list-styles";
import { CollectableItem } from "@/lib/types";
import { CHUNK_PAGE_SIZE_ROWS, useChunkedList } from "@/lib/use-chunked-list";
import { useMinimumVisible } from "@/lib/use-minimum-visible";

/**
 * The trash, and the only way out of it.
 *
 * `archiveItem` is offered by the sold-listing prompt as the SAFE answer next
 * to Delete — "keep it for stats and audit history" — and until `unarchiveItem`
 * shipped it was the irreversible one: an archived item leaves every listing,
 * total, count, recent-items strip and search in the app, and no screen listed
 * archived rows. The undo on that prompt's toast covers the accidental case,
 * which is the common one; this covers the other one, where somebody wants a
 * thing back a week later.
 *
 * Every row offers both resolutions the prompt did, in the same order and with
 * the same weight: Restore is the primary action, Delete is the destructive
 * one behind a confirm. What this screen deliberately does NOT offer is a
 * "delete all" — a screen whose whole purpose is recovering from a mistake is
 * the worst possible place to put a one-tap way to make a bigger one.
 *
 * Selection mode is the answer to the asymmetry that opened up when the bulk
 * bar learned to archive: one gesture on the collection screen can put thirty
 * rows in here, and this screen took them out one at a time. The whole case
 * for archiving over deleting is that the way back is cheap, which stops
 * being true at thirty taps. So the bar comes here too — with Restore, and
 * with the "delete all" it still does not offer, which is the same answer as
 * before and now has to be stated by what is NOT passed to `<BulkBar>`.
 *
 * The row itself is `<ArchiveRow>`, memoized, for the reason selection mode
 * made pressing: this screen builds a `selectedById` map so a row reads a
 * boolean rather than the parent's Set, and an inline row throws that away —
 * every visible row re-renders on every toggle. It also owns the height the
 * `getItemLayout` below reads, because that number is a fact about the row's
 * markup and the two cannot be allowed to drift.
 */
export default function ArchiveScreen() {
  const { archivedItems, unarchiveItem, unarchiveItems, deleteItem, getCollectionById, refresh } =
    useCollections();
  const { t } = useI18n();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);

  // The trailing hold every other list screen uses: a refresh that resolves
  // from cache is instant, and a spinner that flashes reads as a glitch.
  const showRefreshing = useMinimumVisible(refreshing);

  // Same trailing hold the other screens use: a restore that resolves from
  // local state is instant, and a control that flickers disabled reads as a
  // glitch rather than as progress. See lib/minimum-visible-helpers.ts.
  const busy = useMinimumVisible(working);

  /**
   * The window, for the same reason every other list in the app has one: each
   * row mounts a remote cover photo, and this list has no ceiling — nothing
   * prunes it, every sale adds to it, and the bulk bar can now put thirty rows
   * in it with one gesture.
   *
   * `archivedItems` is memoised in the provider on `localItems` alone, which
   * is the stable reference `useChunkedList` requires: a fresh array per
   * render would snap the window back to one page every time and make
   * `loadMore` a no-op. A restore genuinely does change that reference, and
   * the reset is right there — the row left the list, so the window the user
   * had grown is describing a list that no longer exists.
   */
  const { visibleItems, remaining, loadMore } = useChunkedList(archivedItems, CHUNK_PAGE_SIZE_ROWS);

  const handleRestore = useCallback(
    async (itemId: string) => {
      setWorking(true);
      try {
        await unarchiveItem(itemId);
        toast.success(t("archiveRestored"));
        // Said as well as shown: the row leaves this list when it is restored,
        // so a screen-reader user's only other evidence is a list that got one
        // shorter — which is exactly what a delete looks like too.
        announceMessage(t("archiveRestored"));
      } finally {
        setWorking(false);
      }
    },
    [unarchiveItem, toast, t],
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      const ok = await confirmDialog({
        title: t("deleteItemTitle"),
        body: t("deleteItemText"),
        confirmLabel: t("deleteItem"),
        cancelLabel: t("cancel"),
        destructive: true,
      });
      if (!ok) return;
      setWorking(true);
      try {
        await deleteItem(itemId);
        toast.success(t("archiveDeleted"));
      } finally {
        setWorking(false);
      }
    },
    [deleteItem, toast, t],
  );

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // A lookup rather than `selectedIds.has()` inside renderItem, for the reason
  // the collection screen's selection list gives: the row reads a boolean off
  // an object rebuilt once per toggle instead of the parent's Set reference
  // reaching every row.
  const selectedById = useMemo(
    () => Object.fromEntries(Array.from(selectedIds, (id) => [id, true])) as Record<string, boolean>,
    [selectedIds],
  );

  /**
   * Restore a selection, and take no confirm for it.
   *
   * Nothing here is destructive — every row it touches goes back where it was,
   * and the way to undo it is the archive action that put it here. The
   * destructive resolution on this screen stays one row at a time, behind the
   * confirm it has always had.
   *
   * `ids` is read BEFORE the await for the same reason the collection screen
   * reads its listing count before one: `exitSelectionMode` empties the
   * selection three lines below, and a count composed after it would be zero.
   */
  const performBulkRestore = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setWorking(true);
    try {
      await unarchiveItems(ids);
      const message = t("itemsRestored", { count: ids.length });
      toast.success(message);
      // Said as well as shown, like the single-row restore: the rows leave
      // this list, and a list that got thirty shorter is what a bulk delete
      // would look like too.
      announceMessage(message);
      exitSelectionMode();
    } finally {
      setWorking(false);
    }
  }, [selectedIds, unarchiveItems, toast, t, exitSelectionMode]);

  // The sync wrapper `<BulkBar>` is handed, so its memo sees one stable
  // reference instead of a fresh arrow per parent render.
  const handleBulkRestore = useCallback(() => {
    void performBulkRestore();
  }, [performBulkRestore]);

  const renderRow = useCallback(
    ({ item }: { item: CollectableItem }) => (
      <ArchiveRow
        item={item}
        collectionName={getCollectionById(item.collectionId)?.name}
        selectionMode={selectionMode}
        selected={!!selectedById[item.id]}
        busy={busy}
        onToggle={toggleSelect}
        onRestore={handleRestore}
        onDelete={handleDelete}
      />
    ),
    [getCollectionById, busy, handleRestore, handleDelete, selectionMode, selectedById, toggleSelect],
  );

  /*
   * `<Screen scroll={false}>` with the list owning the scroll — the pattern
   * `lib/flat-list-styles.ts` describes, established on collection detail.
   *
   * The window shipped first and bounded how many rows START mounted; nothing
   * recycled them, so five presses of Load more held a hundred rows and a
   * hundred remote cover photos. Virtualization is what bounds the CEILING,
   * and this is the list with no ceiling of its own: nothing prunes an
   * archive, every sale adds to it, and one gesture on the bulk bar can put
   * thirty rows in it.
   *
   * The window stays. `onEndReached` grows it as the user scrolls and
   * `<LoadMoreButton>` is the footer for the platforms and gestures where a
   * scroll-to-end never fires — the same pairing collection detail uses.
   */
  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: t("archiveTitle") }} />
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        style={flatListStyles.viewerFlatList}
        contentContainerStyle={flatListStyles.viewerFlatListContent}
        extraData={selectedIds}
        ListHeaderComponent={
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{t("archiveTitle")}</Text>
            <Text style={styles.heroText}>{t("archiveSubtitle")}</Text>
            {archivedItems.length > 0 && !selectionMode ? (
              <Pressable
                style={styles.selectChip}
                onPress={enterSelectionMode}
                accessibilityRole="button"
                accessibilityLabel={t("selectItems")}
              >
                <Text style={styles.selectChipText}>{t("selectItems")}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="🗄"
            title={t("archiveEmptyTitle")}
            hint={t("archiveEmptyHint")}
            actionLabel={t("goHome")}
            onAction={() => router.replace("/")}
          />
        }
        ListFooterComponent={
          <>
            <LoadMoreButton remaining={remaining} onPress={loadMore} />
            {/* The bar floats over the list, so the last row needs somewhere
                to scroll to — the same spacer the collection screen keeps as
                a page concern rather than folding into the component. */}
            {selectionMode ? <View style={styles.bulkBarSpacer} /> : null}
          </>
        }
        renderItem={renderRow}
        // Every row is exactly ARCHIVE_ROW_HEIGHT plus the list's row gap, so the list
        // can place one without measuring it — which is what lets it skip to
        // an offset instead of mounting everything above it. Collection detail
        // passes one for the same reason; this list did not, so FlatList
        // measured every row as it mounted.
        getItemLayout={(_, index) => ({
          length: ARCHIVE_ROW_HEIGHT + SPACING_LIST,
          offset: (ARCHIVE_ROW_HEIGHT + SPACING_LIST) * index,
          index,
        })}
        onEndReached={remaining > 0 ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews={Platform.OS === "ios"}
        // The one list screen with no pull-to-refresh. An archive is synced
        // like everything else, so two devices reconcile it the same way — and
        // without this the only way to see that was to leave the screen and
        // come back.
        refreshControl={
          <RefreshControl
            refreshing={showRefreshing}
            onRefresh={handleRefresh}
            tintColor={ACCENT_DEEP}
            colors={[ACCENT_DEEP]}
          />
        }
      />
      {selectionMode ? (
        // Restore and Cancel, and nothing else. The omission is the screen's
        // oldest argument: a place you come to after a mistake is the worst
        // possible place for a one-tap way to make a bigger one, so there is
        // no bulk delete here even though `<BulkBar>` can render one.
        <BulkBar count={selectedIds.size} onRestore={handleBulkRestore} onCancel={exitSelectionMode} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: HERO_DARK,
    borderRadius: RADIUS_ITEM_AIRY,
    padding: 20,
    gap: SPACING_INLINE,
  },
  heroTitle: {
    fontSize: 28,
    color: TEXT_ON_DARK,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  heroText: {
    color: TEXT_ON_DARK_MUTED,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  selectChip: {
    alignSelf: "flex-start",
    borderRadius: RADIUS_PILL,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: MUTED_22,
  },
  selectChipText: {
    color: TEXT_ON_DARK,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  bulkBarSpacer: {
    height: 120,
  },
});
