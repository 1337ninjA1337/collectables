import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CurrencySheet } from "@/components/currency-sheet";
import { PhotoPreview } from "@/components/photo-preview";
import { Screen } from "@/components/screen";
import { analyzeItemPhoto, isAiVisionConfigured } from "@/lib/ai-vision";
import { trackEvent } from "@/lib/analytics";
import { uploadImages } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import {
  getDefaultCurrencyForLanguage,
  getUserPreferredCurrency,
  setUserPreferredCurrency,
} from "@/lib/locale-helpers";
import { useToast } from "@/lib/toast-context";
import { ItemCondition, ItemTag } from "@/lib/types";
import { FONT_DISPLAY, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import {
  AMBER_ACCENT,
  AMBER_MUTED_6,
  AMBER_SOFT,
  BORDER,
  BORDER_2,
  BORDER_3,
  CARD_BG,
  CARD_BG_3,
  DANGER,
  HERO_DARK,
  HERO_DARK_2,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_8,
  MUTED_10,
  MUTED_13,
  MUTED_15,
  PAGE_BG_2,
  PLACEHOLDER,
  TAG_BLUE,
  TAG_BROWN,
  TAG_CYAN,
  TAG_GOLD,
  TAG_PURPLE,
  TAG_RUST,
  TAG_SAGE,
  TAG_TEAL,
  TAG_TERRACOTTA,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_3,
  TEXT_DARK_4,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";

const TAG_COLORS = [
  AMBER_ACCENT, TAG_RUST, TAG_SAGE, TAG_BLUE, TAG_PURPLE,
  TAG_TERRACOTTA, TAG_CYAN, TAG_GOLD, TAG_BROWN, TAG_TEAL,
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
  const [currency, setCurrencyState] = useState(() => getDefaultCurrencyForLanguage(language));
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getUserPreferredCurrency().then((stored) => {
      if (cancelled || !stored) return;
      setCurrencyState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function setCurrency(next: string) {
    setCurrencyState(next);
    void setUserPreferredCurrency(next);
  }
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
        costCurrency: parsedCost !== null && !Number.isNaN(parsedCost) ? currency : null,
        condition: condition || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      trackEvent("item_added", {
        collectionId,
        hasPhoto: uploadedPhotos.length > 0,
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
            <Ionicons name="folder-outline" size={20} color={collectionId ? TEXT_DARK_4 : PLACEHOLDER} />
            <Text style={collectionId ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
              {collectionId
                ? ownedCollections.find((c) => c.id === collectionId)?.name ?? t("collectionFieldLabel")
                : t("collectionFieldLabel")}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={18} color={PLACEHOLDER} />
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
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("costLabel")}</Text>
        <View style={styles.costRow}>
          <TextInput
            value={cost}
            onChangeText={setCost}
            placeholder={t("costPlaceholder")}
            placeholderTextColor={PLACEHOLDER}
            keyboardType="numeric"
            style={{ ...styles.input, ...styles.costInput }}
          />
          <Pressable
            style={styles.currencySelector}
            onPress={() => { setCurrencyQuery(""); setCurrencySheetOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={t("currencyLabel")}
          >
            <Text style={styles.currencySelectorText}>{currency}</Text>
            <Ionicons name="chevron-down" size={16} color={PLACEHOLDER} />
          </Pressable>
        </View>
      </View>

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
            placeholderTextColor={PLACEHOLDER}
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

      <CurrencySheet
        visible={currencySheetOpen}
        selectedCode={currency}
        query={currencyQuery}
        onQueryChange={setCurrencyQuery}
        onSelect={(code) => { setCurrency(code); setCurrencySheetOpen(false); }}
        onClose={() => setCurrencySheetOpen(false)}
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
        placeholderTextColor={PLACEHOLDER}
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
            <Ionicons name="search" size={18} color={MUTED_13} />
            <TextInput
              style={styles.sheetSearchInput}
              value={query}
              onChangeText={onQueryChange}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => onQueryChange("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={MUTED_15} />
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
                          <Ionicons name="folder-outline" size={18} color={PLACEHOLDER} />
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
                      <Ionicons name="checkmark-circle" size={22} color={AMBER_ACCENT} />
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

// CurrencySheet was extracted to `components/currency-sheet.tsx` so the
// collection-page edit modal can reuse the same picker; this screen now
// imports `CurrencySheet` from there. The local copy was identical to the
// shared one — keeping a copy would mean every styling tweak has to be
// done in two places.

const styles = StyleSheet.create({
  hero: {
    backgroundColor: BORDER_2,
    borderRadius: 28,
    padding: 20,
    gap: 8,
  },
  heroTitle: {
    fontSize: 28,
    color: TEXT_DARK_4,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  heroText: {
    color: MUTED_8,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  fieldGroup: {
    gap: 10,
  },
  label: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  input: {
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: TEXT_DARK,
    fontSize: 16,
    fontFamily: FONT_BODY,
  },
  inputMultiline: {
    minHeight: 132,
  },
  inputInvalid: {
    borderColor: DANGER,
    borderWidth: 2,
  },
  costRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  costInput: {
    flex: 1,
  },
  currencySelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    minWidth: 96,
  },
  currencySelectorText: {
    color: TEXT_DARK_4,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  currencyRowText: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  currencyRowCode: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
    minWidth: 52,
  },
  required: {
    color: DANGER,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  selectorButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectorButtonInvalid: {
    borderColor: DANGER,
    borderWidth: 2,
  },
  selectorContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  selectorText: {
    color: TEXT_DARK_4,
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
    fontFamily: FONT_BODY_BOLD,
  },
  selectorPlaceholder: {
    color: PLACEHOLDER,
    fontSize: 16,
    flex: 1,
    fontFamily: FONT_BODY,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26, 14, 6, 0.55)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: PAGE_BG_2,
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
    backgroundColor: AMBER_MUTED_6,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  sheetSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: CARD_BG_3,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  sheetSearchInput: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  sheetList: {
    maxHeight: 340,
  },
  sheetEmpty: {
    color: MUTED_2,
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 14,
    fontFamily: FONT_BODY,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_3,
    gap: 10,
  },
  sheetRowSelected: {
    backgroundColor: CARD_BG_3,
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
    backgroundColor: BORDER,
  },
  sheetRowThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  sheetRowText: {
    flex: 1,
    gap: 2,
  },
  sheetRowName: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  sheetRowNameSelected: {
    color: AMBER_ACCENT,
  },
  sheetRowDesc: {
    color: MUTED,
    fontSize: 13,
    fontFamily: FONT_BODY,
  },
  sheetCloseButton: {
    borderRadius: 22,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetCloseText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  photoButton: {
    borderRadius: 20,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
  },
  aiButton: {
    borderRadius: 20,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
  },
  aiButtonDisabled: {
    opacity: 0.55,
  },
  aiButtonText: {
    color: HERO_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  photoButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
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
    fontFamily: FONT_BODY_BOLD,
  },
  tagChipRemove: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  tagInputRow: {
    flexDirection: "row",
    gap: 10,
  },
  tagInput: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: TEXT_DARK,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  tagAddButton: {
    borderRadius: 22,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 18,
    paddingVertical: 12,
    justifyContent: "center",
  },
  tagAddButtonDisabled: {
    opacity: 0.4,
  },
  tagAddButtonText: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
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
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  conditionChipSelected: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  conditionChipText: {
    color: MUTED_2,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  conditionChipTextSelected: {
    color: TEXT_ON_DARK,
  },
  saveButton: {
    borderRadius: 24,
    paddingVertical: 18,
    alignItems: "center",
    backgroundColor: HERO_DARK,
  },
  saveButtonDisabled: {
    opacity: 0.75,
  },
  saveButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
