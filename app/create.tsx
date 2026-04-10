import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Screen } from "@/components/screen";
import { uploadImages } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";

export default function CreateItemScreen() {
  const params = useLocalSearchParams<{ collectionId?: string }>();
  const { collections, addItem } = useCollections();
  const { t } = useI18n();
  const ownedCollections = collections.filter((collection) => collection.role === "owner");
  const initialCollectionId =
    (params.collectionId && ownedCollections.some((collection) => collection.id === params.collectionId)
      ? params.collectionId
      : undefined) ?? ownedCollections[0]?.id ?? "";

  const [collectionId, setCollectionId] = useState(initialCollectionId);
  const [title, setTitle] = useState("");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [description, setDescription] = useState("");
  const [variants, setVariants] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function pickImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("noAccess"), t("noAccessPhotos"));
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

  async function handleSave() {
    if (!collectionId || !title.trim() || !description.trim()) {
      Alert.alert(t("needMoreData"), t("needMoreDataItemText"));
      return;
    }

    setSaving(true);
    try {
      const uploadedPhotos = photos.length > 0 ? await uploadImages(photos) : [];

      const id = await addItem({
        collectionId,
        title,
        acquiredAt,
        acquiredFrom,
        description,
        variants,
        photos: uploadedPhotos,
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
        <Text style={styles.label}>{t("collectionFieldLabel")}</Text>
        <View style={styles.optionsWrap}>
          {ownedCollections.map((collection) => {
            const active = collection.id === collectionId;
            return (
              <Pressable
                key={collection.id}
                onPress={() => setCollectionId(collection.id)}
                style={{...styles.optionChip, ...(active ? styles.optionChipActive : {})}}
              >
                <Text style={{...styles.optionText, ...(active ? styles.optionTextActive : {})}}>{collection.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Field
        label={t("itemTitleLabel")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("itemTitlePlaceholder")}
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
        <Text style={styles.label}>{t("photosLabel")}</Text>
        <Pressable style={styles.photoButton} onPress={pickImages}>
          <Text style={styles.photoButtonText}>{Platform.OS === "web" ? t("choosePhotos") : t("openGallery")}</Text>
        </Pressable>
        <View style={styles.previewRow}>
          {photos.length > 0 ? (
            photos.map((photo) => <Image key={photo} source={{ uri: photo }} style={styles.previewImage} />)
          ) : (
            <Text style={styles.photoHint}>{t("upTo5Photos")}</Text>
          )}
        </View>
      </View>

      <Pressable style={{...styles.saveButton, ...(saving ? styles.saveButtonDisabled : {})}} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? t("saving") : t("saveItem")}</Text>
      </Pressable>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9b8571"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={{...styles.input, ...(multiline ? styles.inputMultiline : {})}}
      />
    </View>
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
  optionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  optionChip: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff4e6",
    borderWidth: 1,
    borderColor: "#e6ceb3",
  },
  optionChipActive: {
    backgroundColor: "#2b2017",
    borderColor: "#2b2017",
  },
  optionText: {
    color: "#5f4734",
    fontWeight: "700",
  },
  optionTextActive: {
    color: "#fff3e4",
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
  previewRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  previewImage: {
    width: 100,
    height: 100,
    borderRadius: 18,
    backgroundColor: "#dbc7ae",
  },
  photoHint: {
    color: "#7a6453",
    lineHeight: 22,
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
