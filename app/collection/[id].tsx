import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { applyItemFilters, EMPTY_FILTERS, ItemFilterBar, type ItemFilters } from "@/components/item-filters";
import { buildDeepLink } from "@/lib/deep-link";
import { VisibilityBadge } from "@/components/visibility-badge";
import { SkeletonCollectionDetail } from "@/components/skeleton";
import { NestableDraggableFlatList, RenderItemParams, ScaleDecorator } from "../../components/DraggableList";

import { ItemCard } from "@/components/item-card";
import { ReactionBar } from "@/components/reaction-bar";
import { Screen } from "@/components/screen";
import { SelectableItemRow } from "@/components/selectable-item-row";
import { useAuth } from "@/lib/auth-context";
import { uploadImage } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { exportCollectionToPdf } from "@/lib/export-pdf";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { useSocial } from "@/lib/social-context";
import { fetchCollectionById, fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { useToast } from "@/lib/toast-context";
import { CollectableItem, Collection, CollectionVisibility } from "@/lib/types";

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
  const [editSaving, setEditSaving] = useState(false);
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
  useEffect(() => {
    if (!user || !remoteCollection) return;
    if (localCollection) return;
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
  }, [user, remoteCollection, localCollection, saveSharedCollection, toast, t]);

  const collection = localCollection ?? remoteCollection;
  const localItems = getItemsForCollection(params.id);
  const allItems = localItems.length > 0 ? localItems : remoteItems;
  const items = useMemo(() => applyItemFilters(allItems, itemFilters), [allItems, itemFilters]);

  // Resolve profile details for every viewer listed on the collection so the
  // share sheet can show non-friends (link-granted viewers) alongside friends.
  const sharedWithUserIds = collection?.sharedWithUserIds ?? [];
  useEffect(() => {
    if (!shareOpen || sharedWithUserIds.length === 0) return;
    ensureProfilesLoaded(sharedWithUserIds);
  }, [shareOpen, sharedWithUserIds, ensureProfilesLoaded]);

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

  function openEditModal() {
    setEditName(activeCollection.name);
    setEditDescription(activeCollection.description);
    setEditCoverUri(activeCollection.coverPhoto);
    setEditCoverChanged(false);
    setEditVisibility(activeCollection.visibility ?? "private");
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
      await updateCollection(activeCollection.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        coverPhoto: finalCover,
        visibility: editVisibility,
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
          <View style={styles.masonryGrid}>
            <View style={styles.masonryCol}>
              {items.filter((_, i) => i % 2 === 0).map((item) => <ItemCard key={item.id} item={item} compact />)}
            </View>
            <View style={[styles.masonryCol, styles.masonryColOffset]}>
              {items.filter((_, i) => i % 2 === 1).map((item) => <ItemCard key={item.id} item={item} compact />)}
            </View>
          </View>
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
                value={editName}
                onChangeText={setEditName}
                placeholder={t("collectionNamePlaceholder")}
                placeholderTextColor="#9b8571"
                style={styles.editFieldInput}
              />
            </View>

            <View style={styles.editFieldGroup}>
              <Text style={styles.editFieldLabel}>{t("collectionDescriptionLabel")}</Text>
              <TextInput
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder={t("collectionDescriptionPlaceholder")}
                placeholderTextColor="#9b8571"
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
                  return (
                    <Pressable
                      key={v}
                      style={{...styles.editVisibilityChip, ...(selected ? styles.editVisibilityChipSelected : {})}}
                      onPress={() => setEditVisibility(v)}
                    >
                      <Text style={{...styles.editVisibilityChipText, ...(selected ? styles.editVisibilityChipTextSelected : {})}}>
                        {t(v === "public" ? "visibilityPublic" : "visibilityPrivate")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.editVisibilityHint}>
                {editVisibility === "public" ? t("visibilityPublicHint") : t("visibilityPrivateHint")}
              </Text>
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
    fontFamily: 'Syne-ExtraBold',
  },
  heroText: {
    color: "#f8eee3",
    lineHeight: 22,
    fontSize: 15,
    fontFamily: 'DMSans-Regular',
  },
  heroMeta: {
    color: "#ffd7ab",
    fontWeight: "700",
    fontSize: 14,
    fontFamily: 'DMSans-Bold',
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
    fontFamily: 'DMSans-ExtraBold',
  },
  summaryLabel: {
    color: "#715d4d",
    lineHeight: 21,
    fontFamily: 'DMSans-Regular',
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
    fontFamily: 'DMSans-ExtraBold',
  },
  shareButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#c4a87a",
    backgroundColor: "#fff4e5",
    alignItems: "center",
  },
  shareButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
    fontFamily: 'DMSans-ExtraBold',
  },
  shareBackdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.4)",
    justifyContent: "flex-end",
  },
  shareSheet: {
    backgroundColor: "#fffaf3",
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
    backgroundColor: "#e4c29a",
  },
  shareTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2f2318",
    fontFamily: 'DMSans-ExtraBold',
  },
  shareHint: {
    color: "#6b5647",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'DMSans-Regular',
  },
  shareLinkBox: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  shareLinkText: {
    color: "#8f6947",
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
    backgroundColor: "#261b14",
    paddingVertical: 14,
    alignItems: "center",
  },
  shareCopyButtonDone: {
    backgroundColor: "#4a7c59",
  },
  shareCopyButtonText: {
    color: "#fff5ea",
    fontWeight: "800",
    fontSize: 15,
    fontFamily: 'DMSans-ExtraBold',
  },
  shareCopyButtonTextDone: {
    color: "#fff",
  },
  shareNativeButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#d89c5b",
    paddingVertical: 14,
    alignItems: "center",
  },
  shareNativeButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 15,
    fontFamily: 'DMSans-ExtraBold',
  },
  shareCancelButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  shareCancelText: {
    color: "#2f2318",
    fontWeight: "800",
    fontSize: 14,
    fontFamily: 'DMSans-ExtraBold',
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
  masonryGrid: {
    flexDirection: "row",
    gap: 10,
  },
  masonryCol: {
    flex: 1,
    gap: 10,
  },
  masonryColOffset: {
    marginTop: 24,
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
  editCollectionButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#c4a87a",
    backgroundColor: "#fff4e5",
    alignItems: "center",
  },
  editCollectionButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
  editModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fffaf3",
    borderRadius: 22,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  editFieldGroup: {
    gap: 8,
  },
  editFieldLabel: {
    color: "#624a35",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  editFieldRequired: {
    color: "#d92f2f",
    fontWeight: "800",
  },
  editFieldInput: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#2f2318",
    fontSize: 15,
  },
  editFieldInputMultiline: {
    minHeight: 90,
  },
  editCoverButton: {
    borderRadius: 16,
    backgroundColor: "#d89c5b",
    paddingVertical: 12,
    alignItems: "center",
  },
  editCoverButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 14,
  },
  editCoverPreview: {
    width: "100%",
    height: 160,
    borderRadius: 16,
    backgroundColor: "#dbc7ae",
  },
  editVisibilityRow: {
    flexDirection: "row",
    gap: 10,
  },
  editVisibilityChip: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  editVisibilityChipSelected: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  editVisibilityChipText: {
    color: "#6b5647",
    fontSize: 14,
    fontWeight: "700",
  },
  editVisibilityChipTextSelected: {
    color: "#fff7ef",
  },
  editVisibilityHint: {
    color: "#7a6453",
    fontSize: 12,
    lineHeight: 18,
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
    color: "#2f2318",
  },
  shareFriendsHint: {
    color: "#6b5647",
    fontSize: 13,
    lineHeight: 18,
  },
  shareFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0e4d4",
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
    color: "#2f2318",
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  shareFriendButton: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#261b14",
  },
  shareFriendButtonActive: {
    backgroundColor: "#4a7c59",
  },
  shareFriendButtonText: {
    color: "#fff5ea",
    fontSize: 13,
    fontWeight: "800",
  },
  shareFriendButtonTextActive: {
    color: "#fff",
  },
  shareFriendsList: {
    maxHeight: 228,
  },
  shareFriendsEmpty: {
    color: "#7a6453",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  editSaveButton: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "#261b14",
  },
  editSaveButtonDisabled: {
    opacity: 0.75,
  },
  editSaveButtonText: {
    color: "#fff5ea",
    fontSize: 15,
    fontWeight: "800",
  },
});
