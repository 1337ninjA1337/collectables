import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Screen } from "@/components/screen";
import { collectionTemplates } from "@/data/collection-templates";
import { uploadImage } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";

const FALLBACK_COVER = "";

export default function CreateCollectionScreen() {
  const { addCollection } = useCollections();
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverPhoto, setCoverPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  function applyTemplate(templateId: string) {
    const tpl = collectionTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const isDeselect = selectedTemplateId === templateId;
    setSelectedTemplateId(isDeselect ? null : templateId);
    if (isDeselect) {
      setName("");
      setDescription("");
    } else {
      setName(t(tpl.nameKey as Parameters<typeof t>[0]));
      setDescription(t(tpl.descriptionKey as Parameters<typeof t>[0]));
    }
  }

  const nameMissing = submitAttempted && !name.trim();

  async function pickFromGallery() {
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

    if (!result.canceled) {
      setCoverPhoto(result.assets[0]?.uri ?? "");
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
      setCoverPhoto(result.assets[0].uri);
    }
  }

  function pickCover() {
    if (Platform.OS === "web") {
      void pickFromGallery();
      return;
    }
    Alert.alert(t("collectionCoverLabel"), undefined, [
      { text: t("pickFromGallery"), onPress: () => void pickFromGallery() },
      { text: t("takePhoto"), onPress: () => void takePhoto() },
      { text: t("cancel"), style: "cancel" },
    ]);
  }

  async function handleSave() {
    setSubmitAttempted(true);
    if (!name.trim()) {
      toast.error(t("requiredFieldsMissing"), t("needTitle"));
      return;
    }

    setSaving(true);
    try {
      const uploadedCover = coverPhoto ? await uploadImage(coverPhoto) : "";

      const id = await addCollection({
        name,
        description: description.trim() || t("defaultCollectionDescription"),
        coverPhoto: uploadedCover,
      });

      router.replace(`/collection/${id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t("newCollectionTitle") }} />
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t("createCollectionTitle")}</Text>
        <Text style={styles.heroText}>{t("createCollectionSubtitle")}</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("templatePickerTitle")}</Text>
        <Text style={styles.templateHint}>{t("templatePickerHint")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateRow}>
          {collectionTemplates.map((tpl) => (
            <Pressable
              key={tpl.id}
              style={{...styles.templateCard, ...(selectedTemplateId === tpl.id ? styles.templateCardActive : {})}}
              onPress={() => applyTemplate(tpl.id)}
            >
              <Text style={styles.templateIcon}>{tpl.icon}</Text>
              <Text
                style={{...styles.templateName, ...(selectedTemplateId === tpl.id ? styles.templateNameActive : {})}}
                numberOfLines={1}
              >
                {t(tpl.nameKey as Parameters<typeof t>[0])}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          {t("collectionNameLabel")}<Text style={styles.required}> *</Text>
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("collectionNamePlaceholder")}
          placeholderTextColor="#9b8571"
          style={{...styles.input, ...(nameMissing ? styles.inputInvalid : {})}}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("collectionDescriptionLabel")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t("collectionDescriptionPlaceholder")}
          placeholderTextColor="#9b8571"
          multiline
          textAlignVertical="top"
          style={{...styles.input, ...styles.inputMultiline}}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("collectionCoverLabel")}</Text>
        <Pressable style={styles.photoButton} onPress={pickCover}>
          <Text style={styles.photoButtonText}>{Platform.OS === "web" ? t("chooseCover") : t("openGallery")}</Text>
        </Pressable>
        {coverPhoto ? (
          <Image source={{ uri: coverPhoto }} style={styles.previewImage} />
        ) : (
          <Text style={styles.photoHint}>{t("coverFallbackHint")}</Text>
        )}
      </View>

      <Pressable style={{...styles.saveButton, ...(saving ? styles.saveButtonDisabled : {})}} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? t("creating") : t("saveCollection")}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: "#efe1cf",
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
  templateHint: {
    color: "#7a6453",
    lineHeight: 20,
    fontSize: 13,
  },
  templateRow: {
    gap: 10,
    paddingVertical: 4,
  },
  templateCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 4,
    minWidth: 80,
  },
  templateCardActive: {
    borderColor: "#d89c5b",
    borderWidth: 2,
    backgroundColor: "#fff3e0",
  },
  templateIcon: {
    fontSize: 24,
  },
  templateName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#624a35",
  },
  templateNameActive: {
    color: "#261b14",
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
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: 24,
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
