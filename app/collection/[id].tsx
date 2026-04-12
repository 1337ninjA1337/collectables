import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { applyItemFilters, EMPTY_FILTERS, ItemFilterBar, type ItemFilters } from "@/components/item-filters";
import { QrCode } from "@/components/qr-code";
import { buildDeepLink } from "@/lib/deep-link";
import { VisibilityBadge } from "@/components/visibility-badge";
import { SkeletonCollectionDetail } from "@/components/skeleton";
import { NestableDraggableFlatList, RenderItemParams, ScaleDecorator } from "../../components/DraggableList";

import { ItemCard } from "@/components/item-card";
import { Screen } from "@/components/screen";
import { SelectableItemRow } from "@/components/selectable-item-row";
import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import { exportCollectionToPdf } from "@/lib/export-pdf";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { fetchCollectionById, fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { useToast } from "@/lib/toast-context";
import { CollectableItem, Collection } from "@/lib/types";

export default function CollectionDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const {
    collections,
    getCollectionById,
    getItemsForCollection,
    deleteCollection,
    deleteItems,
    moveItems,
    isCollectionFollowed,
    followCollection,
    unfollowCollection,
    reorderItemsInCollection,
    refresh,
  } = useCollections();
  const [refreshing, setRefreshing] = useState(false);
  const { t } = useI18n();
  const toast = useToast();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [itemFilters, setItemFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [exporting, setExporting] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
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

  const collection = localCollection ?? remoteCollection;
  const localItems = getItemsForCollection(params.id);

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
  const allItems = localItems.length > 0 ? localItems : remoteItems;
  const items = useMemo(() => applyItemFilters(allItems, itemFilters), [allItems, itemFilters]);

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

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  return (
    <Screen nestable refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: activeCollection.name }} />
      <View style={{...styles.hero, ...(!activeCollection.coverPhoto ? { backgroundColor: placeholderColor(activeCollection.id) } : {})}}>
        {activeCollection.coverPhoto ? <Image source={{ uri: activeCollection.coverPhoto }} style={styles.heroImage} /> : null}
        <View style={styles.heroOverlay} />
        <View style={styles.heroContent}>
          <VisibilityBadge collection={activeCollection} variant="hero" />
          <Text style={styles.heroTitle}>{activeCollection.name}</Text>
          <Text style={styles.heroText}>{activeCollection.description}</Text>
          <Text style={styles.heroMeta}>
            {activeCollection.role === "owner"
              ? t("accessOpenFor", { count: activeCollection.sharedWith.length })
              : t("viewingCollectionOf", { name: activeCollection.ownerName })}
          </Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{allItems.length}</Text>
          <Text style={styles.summaryLabel}>{t("itemsInside")}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{allItems.reduce((total, item) => total + item.photos.length, 0)}</Text>
          <Text style={styles.summaryLabel}>{t("photosSaved")}</Text>
        </View>
      </View>

      {(() => {
        const total = allItems.reduce(
          (sum, item) => sum + (typeof item.cost === "number" ? item.cost : 0),
          0,
        );
        return total > 0 ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{total}</Text>
            <Text style={styles.summaryLabel}>{t("totalCost")}</Text>
          </View>
        ) : null;
      })()}

      {user?.id === activeCollection.ownerUserId ? (
        <View style={styles.ownerActions}>
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
          <Pressable style={styles.qrButton} onPress={() => setQrOpen(true)}>
            <Text style={styles.qrButtonText}>{t("shareQr")}</Text>
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
          <Pressable style={styles.qrButton} onPress={() => setQrOpen(true)}>
            <Text style={styles.qrButtonText}>{t("shareQr")}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.listWrap}>
        <Text style={styles.listTitle}>{t("collectionItems")}</Text>
        {allItems.length > 0 ? (
          <ItemFilterBar filters={itemFilters} onChange={setItemFilters} />
        ) : null}
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
        ) : isOwner && !selectionMode ? (
          <NestableDraggableFlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItemRow}
            onDragEnd={({ data }) =>
              reorderItemsInCollection(activeCollection.id, data.map((i) => i.id))
            }
            contentContainerStyle={styles.draggableList}
          />
        ) : isOwner && selectionMode ? (
          <View style={styles.selectList}>
            {items.map((item) => (
              <SelectableItemRow
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onToggle={toggleSelect}
              />
            ))}
          </View>
        ) : (
          items.map((item) => <ItemCard key={item.id} item={item} />)
        )}
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

      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setQrOpen(false)}>
          <Pressable style={styles.qrCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("shareQrTitle")}</Text>
            <Text style={styles.qrHint}>{t("shareQrHint")}</Text>
            <View style={styles.qrWrap}>
              <QrCode value={buildDeepLink(`collection/${activeCollection.id}`)} size={240} />
            </View>
            <Text style={styles.qrCollectionName} numberOfLines={1}>{activeCollection.name}</Text>
            <Text style={styles.qrLink} numberOfLines={1}>{buildDeepLink(`collection/${activeCollection.id}`)}</Text>
            <Pressable style={styles.modalCancel} onPress={() => setQrOpen(false)}>
              <Text style={styles.modalCancelText}>{t("cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 280,
    borderRadius: 30,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: "#cfb394",
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26, 18, 14, 0.35)",
  },
  heroContent: {
    padding: 20,
    gap: 8,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "800",
  },
  heroText: {
    color: "#f8eee3",
    lineHeight: 22,
    fontSize: 15,
  },
  heroMeta: {
    color: "#ffd7ab",
    fontWeight: "700",
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 24,
    padding: 18,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 6,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: "#2d2117",
  },
  summaryLabel: {
    color: "#715d4d",
    lineHeight: 21,
  },
  listWrap: {
    gap: 12,
  },
  draggableList: {
    gap: 12,
  },
  ownerActions: {
    gap: 12,
  },
  exportButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#c4a87a",
    backgroundColor: "#fff8ee",
    alignItems: "center",
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
  qrButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#c4a87a",
    backgroundColor: "#fff4e5",
    alignItems: "center",
  },
  qrButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
  qrCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 28,
    padding: 24,
    margin: 20,
    alignItems: "center",
    gap: 10,
    maxWidth: 360,
    alignSelf: "center",
  },
  qrHint: {
    color: "#6b5647",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  qrWrap: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  qrCollectionName: {
    color: "#2f2318",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
  },
  qrLink: {
    color: "#8f6947",
    fontSize: 12,
    maxWidth: 260,
  },
  addButton: {
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: "#261b14",
    alignItems: "center",
  },
  addButtonText: {
    color: "#fff4e8",
    fontSize: 16,
    fontWeight: "800",
  },
  deleteButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#d9a0a0",
    backgroundColor: "#fff3f3",
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#8d2b2b",
    fontSize: 15,
    fontWeight: "800",
  },
  unfollowButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#e4c29a",
    backgroundColor: "#fff1df",
    alignItems: "center",
  },
  unfollowButtonText: {
    color: "#2a1d15",
    fontSize: 15,
    fontWeight: "800",
  },
  listTitle: {
    color: "#2d2117",
    fontSize: 22,
    fontWeight: "800",
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2d2117",
  },
  selectButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#e4c29a",
    backgroundColor: "#fff1df",
    alignItems: "center",
  },
  selectButtonText: {
    color: "#2a1d15",
    fontSize: 15,
    fontWeight: "800",
  },
  selectList: {
    gap: 12,
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
    backgroundColor: "#261b14",
    borderRadius: 22,
    padding: 14,
    gap: 12,
    shadowColor: "#1a0e06",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 10,
  },
  bulkBarCount: {
    color: "#ffd7ab",
    fontSize: 14,
    fontWeight: "800",
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
    backgroundColor: "#3d2c1f",
    alignItems: "center",
  },
  bulkBarButtonDisabled: {
    opacity: 0.45,
  },
  bulkBarButtonDanger: {
    backgroundColor: "#8d2b2b",
  },
  bulkBarButtonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#6b4d35",
  },
  bulkBarButtonText: {
    color: "#fff4e8",
    fontSize: 13,
    fontWeight: "800",
  },
  bulkBarButtonDangerText: {
    color: "#ffe6e0",
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
    backgroundColor: "#fffaf3",
    borderRadius: 22,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#2d2117",
  },
  modalList: {
    gap: 8,
    maxHeight: 360,
  },
  modalRow: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  modalRowText: {
    color: "#2a1d15",
    fontSize: 15,
    fontWeight: "700",
  },
  modalCancel: {
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalCancelText: {
    color: "#6a4d35",
    fontSize: 14,
    fontWeight: "800",
  },
});
