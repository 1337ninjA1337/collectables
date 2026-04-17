import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { PhotoPreview } from "@/components/photo-preview";
import { Screen } from "@/components/screen";
import { analyzeItemPhoto, isAiVisionConfigured } from "@/lib/ai-vision";
import { uploadImages } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import { ItemCondition, ItemTag } from "@/lib/types";

const TAG_COLORS = [
  "#d89c5b", "#c47a5a", "#7a9e7e", "#5b8fd8", "#9b7ec8",
  "#d4765b", "#5bbbd8", "#c4a35b", "#8b6b5b", "#6b8f8f",
];

export default function CreateItemScreen() {
  const params = useLocalSearchParams<{ collectionId?: string }>();
  const { collections, addItem } = useCollections();
  const { t, language } = useI18n();
  const toast = useToast();
  const ownedCollections = collections.filter((collection) => collection.role === "owner");
  const initialCollectionId =
    (params.collectionId && ownedCollections.some((collection) => collection.id === params.collectionId)
      ? params.collectionId
      : undefined) ?? ownedCollections[0]?.id ?? "";

  const [collectionId, setCollectionId] = useState(initialCollectionId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetQuery, setSheetQuery] = useState("");
  const [title, setTitle] = useState("");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [description, setDescription] = useState("");
  const [variants, setVariants] = useState("");
  const [cost, setCost] = useState("");
  const [condition, setCondition] = useState<ItemCondition | "">("");
  const [tags, setTags] = useState<ItemTag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const titleMissing = submitAttempted && !title.trim();
  const collectionMissing = submitAttempted && !collectionId;

  async function pickFromGallery() {
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
      setPhotos(result.assets.map((asset) => asset.uri));
    }
  }

  async function takePhoto() {
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
      setPhotos((current) => [...current, result.assets[0].uri].slice(0, 5));
    }
  }

  async function handleAnalyze() {
    if (photos.length === 0) {
      toast.info(t("aiNoPhoto"), t("aiAnalyze"));
      return;
    }
    if (!isAiVisionConfigured) {
      toast.error(t("aiNoKey"), t("aiAnalyze"));
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeItemPhoto(photos[0], language);
      if (result.title && !title.trim()) setTitle(result.title);
      else if (result.title) setTitle(result.title);
      if (result.description) setDescription(result.description);
      if (result.variants) setVariants(result.variants);
    } catch {
      toast.error(t("aiAnalyzeFailed"), t("aiAnalyze"));
    } finally {
      setAnalyzing(false);
    }
  }

  function pickImages() {
    if (Platform.OS === "web") {
      void pickFromGallery();
      return;
    }
    Alert.alert(t("photosLabel"), undefined, [
      { text: t("pickFromGallery"), onPress: () => void pickFromGallery() },
      { text: t("takePhoto"), onPress: () => void takePhoto() },
      { text: t("cancel"), style: "cancel" },
    ]);
  }

  async function handleSave() {
    setSubmitAttempted(true);
    if (!collectionId || !title.trim()) {
      toast.error(t("requiredFieldsMissing"), t("needMoreData"));
      return;
    }

    setSaving(true);
    try {
      const uploadedPhotos = photos.length > 0 ? await uploadImages(photos) : [];
      const parsedCost = cost.trim() ? Number(cost.replace(",", ".")) : null;

      const id = await addItem({
        collectionId,
        title,
        acquiredAt,
        acquiredFrom,
        description,
        variants,
        photos: uploadedPhotos,
        cost: parsedCost !== null && !Number.isNaN(parsedCost) ? parsedCost : null,
        condition: condition || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      router.replace(`/item/${id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t("newItem") }} />
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t("createItemTitle")}</Text>
        <Text style={styles.heroText}>{t("createItemSubtitle")}</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          {t("collectionFieldLabel")}<Text style={styles.required}> *</Text>
        </Text>
        <Pressable
          style={{...styles.selectorButton, ...(collectionMissing ? styles.selectorButtonInvalid : {})}}
          onPress={() => { setSheetQuery(""); setSheetOpen(true); }}
        >
          <View style={styles.selectorContent}>
            <Ionicons name="folder-outline" size={20} color={collectionId ? "#2b2017" : "#9b8571"} />
            <Text style={collectionId ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
              {collectionId
                ? ownedCollections.find((c) => c.id === collectionId)?.name ?? t("collectionFieldLabel")
                : t("collectionFieldLabel")}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={18} color="#9b8571" />
        </Pressable>
      </View>

      <Field
        label={t("itemTitleLabel")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("itemTitlePlaceholder")}
        required
        invalid={titleMissing}
      />
      <Field
        label={t("acquiredDateLabel")}
        value={acquiredAt}
        onChangeText={setAcquiredAt}
        placeholder={t("acquiredDatePlaceholder")}
      />
      <Field
        label={t("sourceLabel")}
        value={acquiredFrom}
        onChangeText={setAcquiredFrom}
        placeholder={t("sourcePlaceholder")}
      />
      <Field
        label={t("descriptionLabel")}
        value={description}
        onChangeText={setDescription}
        placeholder={t("descriptionPlaceholder")}
        multiline
      />
      <Field
        label={t("variantsLabel")}
        value={variants}
        onChangeText={setVariants}
        placeholder={t("variantsPlaceholder")}
        multiline
      />
      <Field
        label={t("costLabel")}
        value={cost}
        onChangeText={setCost}
        placeholder={t("costPlaceholder")}
        keyboardType="numeric"
      />

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("conditionLabel")}</Text>
        <View style={styles.conditionRow}>
          {(["new", "excellent", "good", "fair"] as const).map((c) => {
            const selected = condition === c;
            return (
              <Pressable
                key={c}
                style={{...styles.conditionChip, ...(selected ? styles.conditionChipSelected : {})}}
                onPress={() => setCondition(selected ? "" : c)}
              >
                <Text style={{...styles.conditionChipText, ...(selected ? styles.conditionChipTextSelected : {})}}>
                  {t(`condition${c[0].toUpperCase()}${c.slice(1)}` as "conditionNew" | "conditionExcellent" | "conditionGood" | "conditionFair")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("tagsLabel")}</Text>
        {tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {tags.map((tag, i) => (
              <Pressable key={i} style={{...styles.tagChip, backgroundColor: tag.color}} onPress={() => setTags(tags.filter((_, j) => j !== i))}>
                <Text style={styles.tagChipText}>{tag.label}</Text>
                <Text style={styles.tagChipRemove}>x</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.tagInputRow}>
          <TextInput
            style={styles.tagInput}
            value={tagInput}
            onChangeText={setTagInput}
            placeholder={t("tagsPlaceholder")}
            placeholderTextColor="#9b8571"
            onSubmitEditing={() => {
              const label = tagInput.trim();
              if (label && !tags.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
                setTags([...tags, { label, color: TAG_COLORS[tags.length % TAG_COLORS.length] }]);
                setTagInput("");
              }
            }}
          />
          <Pressable
            style={{...styles.tagAddButton, ...(tagInput.trim() ? {} : styles.tagAddButtonDisabled)}}
            onPress={() => {
              const label = tagInput.trim();
              if (label && !tags.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
                setTags([...tags, { label, color: TAG_COLORS[tags.length % TAG_COLORS.length] }]);
                setTagInput("");
              }
            }}
          >
            <Text style={styles.tagAddButtonText}>{t("tagsAdd")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("photosLabel")}</Text>
        <Pressable style={styles.photoButton} onPress={pickImages}>
          <Text style={styles.photoButtonText}>{Platform.OS === "web" ? t("choosePhotos") : t("openGallery")}</Text>
        </Pressable>
        <Pressable
          style={{...styles.aiButton, ...((analyzing || photos.length === 0) ? styles.aiButtonDisabled : {})}}
          onPress={() => void handleAnalyze()}
          disabled={analyzing || photos.length === 0}
        >
          <Text style={styles.aiButtonText}>{analyzing ? t("aiAnalyzing") : t("aiAnalyze")}</Text>
        </Pressable>
        <PhotoPreview photos={photos} onChange={setPhotos} maxPhotos={5} />
      </View>

      <Pressable style={{...styles.saveButton, ...(saving ? styles.saveButtonDisabled : {})}} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? t("saving") : t("saveItem")}</Text>
      </Pressable>

      <CollectionSheet
        visible={sheetOpen}
        collections={ownedCollections}
        selectedId={collectionId}
        query={sheetQuery}
        onQueryChange={setSheetQuery}
        onSelect={(id) => { setCollectionId(id); setSheetOpen(false); }}
        onClose={() => setSheetOpen(false)}
      />
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  required = false,
  invalid = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
  invalid?: boolean;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9b8571"
        multiline={multiline}
        keyboardType={keyboardType ?? "default"}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          ...styles.input,
          ...(multiline ? styles.inputMultiline : {}),
          ...(invalid ? styles.inputInvalid : {}),
        }}
      />
    </View>
  );
}

type Collection = { id: string; name: string; description: string; coverPhoto: string };

function CollectionSheet({
  visible,
  collections,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  onClose,
}: {
  visible: boolean;
  collections: Collection[];
  selectedId: string;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [collections, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetContainer} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{t("collectionFieldLabel")}</Text>

          <View style={styles.sheetSearchRow}>
            <Ionicons name="search" size={18} color="#8a6e54" />
            <TextInput
              style={styles.sheetSearchInput}
              value={query}
              onChangeText={onQueryChange}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor="#9b8571"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => onQueryChange("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#b8a08a" />
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text style={styles.sheetEmpty}>{t("searchNoResults")}</Text>
            ) : (
              filtered.map((c) => {
                const isSelected = c.id === selectedId;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.sheetRow, isSelected && styles.sheetRowSelected]}
                    onPress={() => onSelect(c.id)}
                  >
                    <View style={styles.sheetRowContent}>
                      {c.coverPhoto ? (
                        <Image source={{ uri: c.coverPhoto }} style={styles.sheetRowThumb} />
                      ) : (
                        <View style={[styles.sheetRowThumb, styles.sheetRowThumbEmpty]}>
                          <Ionicons name="folder-outline" size={18} color="#9b8571" />
                        </View>
                      )}
                      <View style={styles.sheetRowText}>
                        <Text style={[styles.sheetRowName, isSelected && styles.sheetRowNameSelected]} numberOfLines={1}>
                          {c.name}
                        </Text>
                        {c.description ? (
                          <Text style={styles.sheetRowDesc} numberOfLines={1}>{c.description}</Text>
                        ) : null}
                      </View>
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={22} color="#d89c5b" />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable style={styles.sheetCloseButton} onPress={onClose}>
            <Text style={styles.sheetCloseText}>{t("cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  heroText: {
    color: "#6b5543",
    lineHeight: 22,
  },
  fieldGroup: {
    gap: 10,
  },
  label: {
    color: "#624a35",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  input: {
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#2f2318",
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 132,
  },
  inputInvalid: {
    borderColor: "#d92f2f",
    borderWidth: 2,
  },
  required: {
    color: "#d92f2f",
    fontWeight: "800",
  },
  selectorButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 22,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectorButtonInvalid: {
    borderColor: "#d92f2f",
    borderWidth: 2,
  },
  selectorContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  selectorText: {
    color: "#2b2017",
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
  },
  selectorPlaceholder: {
    color: "#9b8571",
    fontSize: 16,
    flex: 1,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26, 14, 6, 0.55)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: "#fffaf4",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    maxHeight: "70%",
    gap: 14,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d9c8b4",
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2d2117",
  },
  sheetSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff1df",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  sheetSearchInput: {
    flex: 1,
    color: "#2f2318",
    fontSize: 15,
    fontWeight: "600",
  },
  sheetList: {
    maxHeight: 340,
  },
  sheetEmpty: {
    color: "#6b5647",
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 14,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0e4d0",
    gap: 10,
  },
  sheetRowSelected: {
    backgroundColor: "#fff1df",
    borderBottomColor: "transparent",
  },
  sheetRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  sheetRowThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#eadbc8",
  },
  sheetRowThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  sheetRowText: {
    flex: 1,
    gap: 2,
  },
  sheetRowName: {
    color: "#2f2318",
    fontSize: 15,
    fontWeight: "700",
  },
  sheetRowNameSelected: {
    color: "#d89c5b",
  },
  sheetRowDesc: {
    color: "#8f6947",
    fontSize: 13,
  },
  sheetCloseButton: {
    borderRadius: 22,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetCloseText: {
    color: "#5f4734",
    fontSize: 15,
    fontWeight: "800",
  },
  photoButton: {
    borderRadius: 20,
    backgroundColor: "#d89c5b",
    paddingVertical: 14,
    alignItems: "center",
  },
  aiButton: {
    borderRadius: 20,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    alignItems: "center",
  },
  aiButtonDisabled: {
    opacity: 0.55,
  },
  aiButtonText: {
    color: "#2a1d15",
    fontWeight: "800",
    fontSize: 15,
  },
  photoButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 15,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tagChipText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  tagChipRemove: {
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
  tagAddButtonDisabled: {
    opacity: 0.4,
  },
  tagAddButtonText: {
    color: "#fff7ef",
    fontSize: 14,
    fontWeight: "800",
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
});
