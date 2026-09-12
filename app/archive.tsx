import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { DangerIconButton } from "@/components/danger-icon-button";
import { EmptyState } from "@/components/empty-state";
import { LoadMoreButton } from "@/components/load-more-button";
import { Screen } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { announceMessage } from "@/lib/announce";
import { useCollections } from "@/lib/collections-context";
import { confirmDialog } from "@/lib/confirm-dialog";
import {
  AMBER_ACCENT,
  BORDER,
  CARD_BG,
  HERO_DARK,
  MUTED,
  MUTED_2,
  RADIUS_CARD_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_CARD,
  SPACING_INLINE,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
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
 */
export default function ArchiveScreen() {
  const { archivedItems, unarchiveItem, deleteItem, getCollectionById } = useCollections();
  const { t } = useI18n();
  const theme = useAppTheme();
  const toast = useToast();
  const [working, setWorking] = useState(false);

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

  const renderRow = useCallback(
    ({ item }: { item: CollectableItem }) => {
      const collection = getCollectionById(item.collectionId);
      const photo = item.photos[0];
      return (
        <View
          style={{ ...styles.row, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}
        >
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
    [getCollectionById, theme, t, busy, handleRestore, handleDelete],
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
        ListHeaderComponent={
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{t("archiveTitle")}</Text>
            <Text style={styles.heroText}>{t("archiveSubtitle")}</Text>
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
        ListFooterComponent={<LoadMoreButton remaining={remaining} onPress={loadMore} />}
        renderItem={renderRow}
        onEndReached={remaining > 0 ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews={Platform.OS === "ios"}
      />
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
  row: {
    flexDirection: "row",
    alignItems: "center",
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
});
