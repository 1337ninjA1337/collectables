import { Stack, router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Image, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { BulkBar } from "@/components/bulk-bar";
import { DangerIconButton } from "@/components/danger-icon-button";
import { EmptyState } from "@/components/empty-state";
import { LoadMoreButton } from "@/components/load-more-button";
import { Screen } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { announceMessage } from "@/lib/announce";
import { useCollections } from "@/lib/collections-context";
import { confirmDialog } from "@/lib/confirm-dialog";
import {
  ACCENT_DEEP,
  AMBER_ACCENT,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK,
  MUTED,
  MUTED_2,
  MUTED_22,
  RADIUS_CARD_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_5,
  TEXT_ON_DARK_MUTED,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD, FONT_DISPLAY } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
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
 */
export default function ArchiveScreen() {
  const { archivedItems, unarchiveItem, unarchiveItems, deleteItem, getCollectionById, refresh } =
    useCollections();
  const { t } = useI18n();
  const theme = useAppTheme();
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
    ({ item }: { item: CollectableItem }) => {
      const collection = getCollectionById(item.collectionId);
      const photo = item.photos[0];
      const selected = !!selectedById[item.id];
      const body = (
        <>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.thumb} />
          ) : (
            <View style={{ ...styles.thumb, backgroundColor: placeholderColor(item.id) }} />
          )}
          <View style={styles.rowText}>
            <Text style={{ ...styles.rowTitle, color: theme.text }} numberOfLines={1}>
              {item.title}
            </Text>
            {collection ? (
              <Text style={{ ...styles.rowMeta, color: theme.meta }} numberOfLines={1}>
                {collection.name}
              </Text>
            ) : null}
            {/*
              The ISO prefix, not `toLocaleDateString()`: `acquiredAt` is
              stored and rendered as `YYYY-MM-DD` everywhere else in the app,
              and a date that reads one way on this screen and another on the
              item it came from is worse than a date that is unambiguous in
              every locale.
            */}
            <Text style={{ ...styles.rowMeta, color: theme.meta }}>
              {t("archiveArchivedOn", { date: (item.archivedAt ?? "").slice(0, 10) })}
            </Text>
          </View>
        </>
      );
      const surface = { ...styles.row, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT };

      // A row in a multi-select list is a checkbox and not a button — the same
      // call `<SelectableItemRow>` makes and for the same reason: "button"
      // announces the tap and says nothing about whether the row is in the
      // selection, which is the only state this mode has.
      if (selectionMode) {
        return (
          <Pressable
            style={{ ...surface, ...(selected ? styles.rowSelected : {}) }}
            onPress={() => toggleSelect(item.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={item.title}
          >
            {body}
            <View style={{ ...styles.checkbox, ...(selected ? styles.checkboxOn : {}) }}>
              {selected ? <Text style={styles.check}>✓</Text> : null}
            </View>
          </Pressable>
        );
      }

      return (
        <View style={surface}>
          {body}
          <View style={styles.rowActions}>
            <Pressable
              style={styles.restore}
              onPress={() => void handleRestore(item.id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel={t("archiveRestoreA11y", { title: item.title })}
            >
              <Text style={styles.restoreText}>{t("archiveRestore")}</Text>
            </Pressable>
            <DangerIconButton
              onPress={() => void handleDelete(item.id)}
              disabled={busy}
              accessibilityLabel={t("archiveDeleteA11y", { title: item.title })}
            />
          </View>
        </View>
      );
    },
    [getCollectionById, theme, t, busy, handleRestore, handleDelete, selectionMode, selectedById, toggleSelect],
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
        // Every row is exactly ROW_HEIGHT plus the list's row gap, so the list
        // can place one without measuring it — which is what lets it skip to
        // an offset instead of mounting everything above it. Collection detail
        // passes one for the same reason; this list did not, so FlatList
        // measured every row as it mounted.
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT + SPACING_LIST,
          offset: (ROW_HEIGHT + SPACING_LIST) * index,
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

/**
 * The height of one row, declared rather than implied — so `getItemLayout` and
 * the stylesheet cannot drift apart.
 *
 * A 56px thumbnail in 12px of padding, and the text column is shorter than the
 * thumb: a 15px title and two 12px meta lines, each `numberOfLines={1}`, come
 * to roughly 50. So the thumb sets the height and nothing in the row can grow
 * past it — which is the property that makes a fixed layout honest here and
 * would not hold on a row whose text wraps.
 */
const ROW_HEIGHT = 56 + SPACING_CARD * 2;

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
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: ROW_HEIGHT,
    gap: SPACING_CARD,
    padding: SPACING_CARD,
    borderRadius: RADIUS_CARD_LG,
    borderWidth: 1,
    backgroundColor: CARD_BG,
    borderColor: BORDER,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  rowMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_INLINE,
  },
  restore: {
    borderRadius: RADIUS_PILL,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: AMBER_ACCENT,
  },
  restoreText: {
    color: TEXT_ON_DARK_2,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
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
  // The selected row keeps its height: an amber border replaces the neutral
  // one rather than sitting outside it, because `getItemLayout` promises
  // every row is exactly ROW_HEIGHT and a 2px wrapper would make that a lie
  // for the rows a user has touched.
  rowSelected: {
    borderColor: AMBER_ACCENT,
    backgroundColor: CARD_BG_3,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: AMBER_ACCENT,
    backgroundColor: CARD_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: AMBER_ACCENT,
  },
  check: {
    color: TEXT_ON_DARK_5,
    fontSize: 16,
    fontWeight: "900",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  bulkBarSpacer: {
    height: 120,
  },
});
