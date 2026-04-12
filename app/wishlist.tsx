import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmptyState } from "@/components/empty-state";
import { PhotoPreview } from "@/components/photo-preview";
import { Screen } from "@/components/screen";
import { placeholderColor } from "@/lib/placeholder-color";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import { CollectableItem } from "@/lib/types";

export default function WishlistScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { wishlistItems, collections, addWishlistItem, deleteItem, promoteWishlistItem } = useCollections();
  const ownedCollections = useMemo(
    () => collections.filter((c) => c.role === "owner"),
    [collections],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [cost, setCost] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [promoteFor, setPromoteFor] = useState<CollectableItem | null>(null);

  async function pickImages() {
    if (Platform.OS !== "web") {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted) {
        toast.error(t("noAccessPhotos"), t("noAccess"));
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 5,
    });
    if (!result.canceled) {
      setPhotos(result.assets.map((a) => a.uri));
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setAcquiredFrom("");
    setCost("");
    setPhotos([]);
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error(t("requiredFieldsMissing"), t("needMoreData"));
      return;
    }
    setSaving(true);
    try {
      await addWishlistItem({
        title,
        description,
        acquiredFrom,
        photos,
        cost: cost ? Number(cost) : null,
      });
      toast.success(t("wishlistAdded"));
      resetForm();
      setAddOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(item: CollectableItem) {
    const onConfirm = () => {
      void deleteItem(item.id);
      toast.success(t("wishlistDeleted"));
    };
    if (Platform.OS === "web") {
      if (window.confirm(t("wishlistConfirmDelete"))) onConfirm();
      return;
    }
    Alert.alert(item.title, t("wishlistConfirmDelete"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("delete"), style: "destructive", onPress: onConfirm },
    ]);
  }

  async function handlePromote(targetCollectionId: string) {
    if (!promoteFor) return;
    await promoteWishlistItem(promoteFor.id, targetCollectionId);
    toast.success(t("wishlistPromoted"));
    setPromoteFor(null);
    router.push(`/item/${promoteFor.id}`);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t("wishlist") }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("wishlist")}</Text>
          <Text style={styles.subtitle}>{t("wishlistHint")}</Text>
        </View>
        <Pressable style={styles.addButton} onPress={() => setAddOpen(true)}>
          <Ionicons name="add" size={20} color="#241912" />
          <Text style={styles.addButtonText}>{t("wishlistAdd")}</Text>
        </Pressable>
      </View>

      {wishlistItems.length === 0 ? (
        <EmptyState
          icon="★"
          title={t("wishlistEmptyTitle")}
          hint={t("wishlistEmptyHint")}
          actionLabel={t("wishlistAdd")}
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <View style={styles.list}>
          {wishlistItems.map((item) => {
            const hasPhoto = item.photos.length > 0 && Boolean(item.photos[0]);
            return (
              <View key={item.id} style={styles.card}>
                {hasPhoto ? (
                  <Image source={{ uri: item.photos[0] }} style={styles.cardImage} />
                ) : (
                  <View style={{ ...styles.cardImage, backgroundColor: placeholderColor(item.id) }} />
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.description ? (
                    <Text style={styles.cardDescription} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                  <View style={styles.metaRow}>
                    {typeof item.cost === "number" ? (
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>{item.cost}</Text>
                      </View>
                    ) : null}
                    {item.acquiredFrom ? (
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>{item.acquiredFrom}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.actionsRow}>
                    <Pressable
                      style={styles.promoteButton}
                      onPress={() => setPromoteFor(item)}
                      disabled={ownedCollections.length === 0}
                    >
                      <Ionicons name="arrow-forward" size={16} color="#fff7ea" />
                      <Text style={styles.promoteButtonText}>{t("wishlistPromote")}</Text>
                    </Pressable>
                    <Pressable style={styles.deleteButton} onPress={() => confirmDelete(item)}>
                      <Ionicons name="trash-outline" size={16} color="#a5402d" />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t("wishlistAdd")}</Text>
            <ScrollView contentContainerStyle={styles.sheetScroll}>
              <Text style={styles.label}>{t("itemTitleLabel")}</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder={t("itemTitlePlaceholder")}
                placeholderTextColor="#b59a80"
              />

              <Text style={styles.label}>{t("descriptionLabel")}</Text>
              <TextInput
                style={{ ...styles.input, ...styles.multiline }}
                value={description}
                onChangeText={setDescription}
                placeholder={t("descriptionPlaceholder")}
                placeholderTextColor="#b59a80"
                multiline
              />

              <Text style={styles.label}>{t("wishlistSource")}</Text>
              <TextInput
                style={styles.input}
                value={acquiredFrom}
                onChangeText={setAcquiredFrom}
                placeholder={t("wishlistSourcePlaceholder")}
                placeholderTextColor="#b59a80"
              />

              <Text style={styles.label}>{t("costLabel")}</Text>
              <TextInput
                style={styles.input}
                value={cost}
                onChangeText={setCost}
                placeholder="0"
                placeholderTextColor="#b59a80"
                keyboardType="numeric"
              />

              <Text style={styles.label}>{t("photosLabel")}</Text>
              <Pressable style={styles.pickButton} onPress={pickImages}>
                <Ionicons name="images-outline" size={18} color="#2f2318" />
                <Text style={styles.pickButtonText}>{t("pickFromGallery")}</Text>
              </Pressable>
              {photos.length > 0 ? (
                <PhotoPreview photos={photos} onChange={setPhotos} maxPhotos={5} />
              ) : null}
            </ScrollView>
            <View style={styles.sheetActions}>
              <Pressable style={styles.cancelButton} onPress={() => setAddOpen(false)}>
                <Text style={styles.cancelButtonText}>{t("cancel")}</Text>
              </Pressable>
              <Pressable
                style={{ ...styles.saveButton, ...(saving ? styles.saveButtonDisabled : {}) }}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>{t("saveItem")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!promoteFor}
        transparent
        animationType="fade"
        onRequestClose={() => setPromoteFor(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.promoteSheet}>
            <Text style={styles.sheetTitle}>{t("wishlistPromoteTitle")}</Text>
            <Text style={styles.subtitle}>{t("wishlistPromoteHint")}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {ownedCollections.map((c) => (
                <Pressable key={c.id} style={styles.collectionRow} onPress={() => void handlePromote(c.id)}>
                  <Text style={styles.collectionRowText}>{c.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color="#8f6947" />
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.cancelButton} onPress={() => setPromoteFor(null)}>
              <Text style={styles.cancelButtonText}>{t("cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#2f2318",
  },
  subtitle: {
    color: "#735f50",
    marginTop: 4,
    lineHeight: 20,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#d89c5b",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  addButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 14,
  },
  list: {
    gap: 14,
  },
  card: {
    flexDirection: "row",
    gap: 14,
    borderRadius: 20,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 12,
  },
  cardImage: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: "#dbc7ae",
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  cardTitle: {
    color: "#2f2318",
    fontSize: 17,
    fontWeight: "800",
  },
  cardDescription: {
    color: "#6b5647",
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaChip: {
    borderRadius: 999,
    backgroundColor: "#f4ecdf",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metaChipText: {
    color: "#6b5647",
    fontSize: 12,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  promoteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2f2318",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  promoteButtonText: {
    color: "#fff7ea",
    fontWeight: "800",
    fontSize: 13,
  },
  deleteButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e0bcb3",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fdf0eb",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fffaf3",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    maxHeight: "90%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#e4c29a",
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2f2318",
    marginBottom: 10,
  },
  sheetScroll: {
    gap: 10,
    paddingBottom: 12,
  },
  label: {
    fontSize: 12,
    color: "#8f6947",
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eadbc8",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#2f2318",
    fontSize: 15,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  pickButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e4c29a",
    backgroundColor: "#fff4e5",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pickButtonText: {
    color: "#2f2318",
    fontWeight: "800",
    fontSize: 13,
  },
  sheetActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  cancelButtonText: {
    color: "#2f2318",
    fontWeight: "800",
    fontSize: 14,
  },
  saveButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#d89c5b",
    paddingVertical: 14,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 14,
  },
  promoteSheet: {
    margin: 20,
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    padding: 20,
    gap: 10,
  },
  collectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eadbc8",
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  collectionRowText: {
    color: "#2f2318",
    fontSize: 15,
    fontWeight: "700",
  },
});
