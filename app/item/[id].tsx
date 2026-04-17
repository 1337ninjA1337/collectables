import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SkeletonItemDetail } from "@/components/skeleton";

import { PhotoPreview } from "@/components/photo-preview";
import { QrCode } from "@/components/qr-code";
import { ReactionBar } from "@/components/reaction-bar";
import { Screen } from "@/components/screen";
import { buildDeepLink } from "@/lib/deep-link";
import { useAuth } from "@/lib/auth-context";
import { uploadImages } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { fetchItemById } from "@/lib/supabase-profiles";
import { useToast } from "@/lib/toast-context";
import { CollectableItem, ItemCondition, ItemTag } from "@/lib/types";

const TAG_COLORS = [
  "#d89c5b", "#c47a5a", "#7a9e7e", "#5b8fd8", "#9b7ec8",
  "#d4765b", "#5bbbd8", "#c4a35b", "#8b6b5b", "#6b8f8f",
];

export default function ItemDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { getItemById, getCollectionById, deleteItem, updateItem, refresh } = useCollections();
  const { t } = useI18n();
  const toast = useToast();
  const localItem = getItemById(params.id);
  const [remoteItem, setRemoteItem] = useState<CollectableItem | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
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
  const [editCondition, setEditCondition] = useState<ItemCondition | "">("");
  const [editTags, setEditTags] = useState<ItemTag[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [newLocalPhotos, setNewLocalPhotos] = useState<string[]>([]);

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

  function enterEditMode() {
    setEditTitle(activeItem.title);
    setEditDescription(activeItem.description);
    setEditAcquiredFrom(activeItem.acquiredFrom);
    setEditAcquiredAt(activeItem.acquiredAt);
    setEditVariants(activeItem.variants);
    setEditCost(typeof activeItem.cost === "number" ? String(activeItem.cost) : "");
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
        condition: editCondition || undefined,
        tags: editTags.length > 0 ? editTags : undefined,
        photos: finalPhotos,
      });
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
        <EditField label={t("costLabel")} value={editCost} onChangeText={setEditCost} keyboardType="numeric" />

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
            <TextInput
              style={styles.tagInput}
              value={editTagInput}
              onChangeText={setEditTagInput}
              placeholder={t("tagsPlaceholder")}
              placeholderTextColor="#9b8571"
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
        {activeItem.photos.length > 0 ? (
          activeItem.photos.map((photo) => (
            <Image key={photo} source={{ uri: photo }} style={styles.galleryImage} />
          ))
        ) : (
          <View style={{...styles.galleryImage, backgroundColor: placeholderColor(activeItem.id)}} />
        )}
      </ScrollView>

      <View style={styles.headerCard}>
        <Text style={styles.itemTitle}>{activeItem.title}</Text>
        <Text style={styles.itemMeta}>{t("collectionField", { name: collection?.name ?? t("collectionMissing") })}</Text>
        <Text style={styles.itemMeta}>{t("addedBy", { name: activeItem.createdBy })}</Text>
      </View>

      {isOwner ? (
        <Pressable style={styles.editButton} onPress={enterEditMode}>
          <Text style={styles.editButtonText}>{t("editItem")}</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.qrButton} onPress={() => setQrOpen(true)}>
        <Text style={styles.qrButtonText}>{t("shareQr")}</Text>
      </Pressable>

      {isOwner ? (
        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>{t("deleteItem")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("acquiredHow")}</Text>
        <Text style={styles.sheetValue}>{activeItem.acquiredFrom}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("acquiredDate")}</Text>
        <Text style={styles.sheetValue}>{activeItem.acquiredAt}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("description")}</Text>
        <Text style={styles.sheetValue}>{activeItem.description}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("variants")}</Text>
        <Text style={styles.sheetValue}>{activeItem.variants}</Text>
      </View>

      {activeItem.tags && activeItem.tags.length > 0 ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{t("tagsLabel")}</Text>
          <View style={styles.tagsRow}>
            {activeItem.tags.map((tag, i) => (
              <View key={i} style={{...styles.tagBadge, backgroundColor: tag.color}}>
                <Text style={styles.tagBadgeText}>{tag.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {activeItem.condition ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{t("conditionLabel")}</Text>
          <View style={styles.conditionBadgeRow}>
            <View style={styles.conditionBadge}>
              <Text style={styles.conditionBadgeText}>
                {t(`condition${activeItem.condition[0].toUpperCase()}${activeItem.condition.slice(1)}` as "conditionNew" | "conditionExcellent" | "conditionGood" | "conditionFair")}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {typeof activeItem.cost === "number" ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{t("costLabel")}</Text>
          <Text style={styles.sheetValue}>{activeItem.cost}</Text>
        </View>
      ) : null}

      <ReactionBar targetType="item" targetId={activeItem.id} />

      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <Pressable style={styles.qrBackdrop} onPress={() => setQrOpen(false)}>
          <Pressable style={styles.qrCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.qrTitle}>{t("shareQrItemTitle")}</Text>
            <Text style={styles.qrHint}>{t("shareQrItemHint")}</Text>
            <View style={styles.qrWrap}>
              <QrCode value={buildDeepLink(`item/${activeItem.id}`)} size={240} />
            </View>
            <Text style={styles.qrItemName} numberOfLines={1}>{activeItem.title}</Text>
            <Text style={styles.qrLink} numberOfLines={1}>{buildDeepLink(`item/${activeItem.id}`)}</Text>
            <Pressable style={styles.qrCancel} onPress={() => setQrOpen(false)}>
              <Text style={styles.qrCancelText}>{t("cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
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
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#9b8571"
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
  gallery: {
    gap: 12,
    paddingRight: 20,
  },
  galleryImage: {
    width: 280,
    height: 320,
    borderRadius: 28,
    backgroundColor: "#ddc9af",
  },
  headerCard: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: "#2a1e17",
    gap: 6,
  },
  editButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#c4a87a",
    backgroundColor: "#fff4e5",
    paddingVertical: 16,
    alignItems: "center",
  },
  editButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
  deleteButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d99393",
    backgroundColor: "#fff1f1",
    paddingVertical: 16,
    alignItems: "center",
  },
  qrButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#c4a87a",
    backgroundColor: "#fff4e5",
    paddingVertical: 16,
    alignItems: "center",
  },
  qrButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
  qrBackdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  qrCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 28,
    padding: 24,
    margin: 20,
    alignItems: "center",
    gap: 10,
    maxWidth: 360,
  },
  qrTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2f2318",
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
  qrItemName: {
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
  qrCancel: {
    marginTop: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 12,
    paddingHorizontal: 28,
    backgroundColor: "#fff",
  },
  qrCancelText: {
    color: "#2f2318",
    fontWeight: "800",
    fontSize: 14,
  },
  deleteButtonText: {
    color: "#8a2727",
    fontSize: 15,
    fontWeight: "800",
  },
  itemTitle: {
    color: "#fff7ed",
    fontSize: 29,
    fontWeight: "800",
  },
  itemMeta: {
    color: "#dfc8b2",
    fontSize: 14,
    lineHeight: 21,
  },
  sheet: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 8,
  },
  sheetLabel: {
    color: "#8f6947",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  sheetValue: {
    color: "#2f2318",
    fontSize: 16,
    lineHeight: 24,
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
  },
  conditionBadgeRow: {
    flexDirection: "row",
  },
  conditionBadge: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: "#261b14",
  },
  conditionBadgeText: {
    color: "#fff7ef",
    fontSize: 14,
    fontWeight: "700",
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2d2117",
  },
  hero: {
    backgroundColor: "#f0e2cf",
    borderRadius: 28,
    padding: 20,
    gap: 8,
  },
  heroTitle: {
    fontSize: 28,
    color: "#2b2017",
    fontWeight: "800",
  },
  editFieldGroup: {
    gap: 10,
  },
  editLabel: {
    color: "#624a35",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  editRequired: {
    color: "#d92f2f",
    fontWeight: "800",
  },
  editInput: {
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#2f2318",
    fontSize: 16,
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
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  conditionChipSelected: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  conditionChipText: {
    color: "#6b5647",
    fontSize: 14,
    fontWeight: "700",
  },
  conditionChipTextSelected: {
    color: "#fff7ef",
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
  },
  editTagChipRemove: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "800",
  },
  tagInputRow: {
    flexDirection: "row",
    gap: 10,
  },
  tagInput: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#2f2318",
    fontSize: 15,
  },
  tagAddButton: {
    borderRadius: 22,
    backgroundColor: "#261b14",
    paddingHorizontal: 18,
    paddingVertical: 12,
    justifyContent: "center",
  },
  tagAddButtonText: {
    color: "#fff7ef",
    fontSize: 14,
    fontWeight: "800",
  },
  photoButton: {
    borderRadius: 20,
    backgroundColor: "#d89c5b",
    paddingVertical: 14,
    alignItems: "center",
  },
  photoButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 15,
  },
  saveButton: {
    borderRadius: 24,
    paddingVertical: 18,
    alignItems: "center",
    backgroundColor: "#261b14",
  },
  saveButtonDisabled: {
    opacity: 0.75,
  },
  saveButtonText: {
    color: "#fff5ea",
    fontSize: 16,
    fontWeight: "800",
  },
  cancelButton: {
    borderRadius: 22,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
});
