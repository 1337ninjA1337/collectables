import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Screen } from "@/components/screen";
import { collectionTemplates } from "@/data/collection-templates";
import { trackEvent } from "@/lib/analytics";
import { uploadImage } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_MUTED_2,
  BORDER,
  CARD_BG,
  CARD_BG_5,
  CARD_BG_6,
  DANGER,
  HERO_DARK,
  MUTED_2,
  MUTED_8,
  MUTED_10,
  MUTED_17,
  PLACEHOLDER,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_4,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { usePremium } from "@/lib/premium-context";
import { useToast } from "@/lib/toast-context";
import { CollectionVisibility } from "@/lib/types";
import { FONT_DISPLAY, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

const FALLBACK_COVER = "";

export default function CreateCollectionScreen() {
  const { addCollection } = useCollections();
  const { t } = useI18n();
  const { isPremium } = usePremium();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverPhoto, setCoverPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<CollectionVisibility>(
    isPremium ? "private" : "public",
  );

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

      const finalVisibility: CollectionVisibility = isPremium ? visibility : "public";
      const id = await addCollection({
        name,
        description: description.trim() || t("defaultCollectionDescription"),
        coverPhoto: uploadedCover,
        visibility: finalVisibility,
      });

      trackEvent("collection_created", {
        visibility: finalVisibility,
        isPremium,
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
          placeholderTextColor={PLACEHOLDER}
          style={{...styles.input, ...(nameMissing ? styles.inputInvalid : {})}}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("collectionDescriptionLabel")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t("collectionDescriptionPlaceholder")}
          placeholderTextColor={PLACEHOLDER}
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

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{t("visibilityLabel")}</Text>
        <View style={styles.visibilityRow}>
          {(["private", "public"] as const).map((v) => {
            const selected = visibility === v;
            const locked = v === "private" && !isPremium;
            return (
              <Pressable
                key={v}
                style={{
                  ...styles.visibilityChip,
                  ...(selected ? styles.visibilityChipSelected : {}),
                  ...(locked ? styles.visibilityChipLocked : {}),
                }}
                onPress={() => {
                  if (locked) {
                    toast.error(t("visibilityPrivatePremiumOnly"), t("premiumTitle"));
                    return;
                  }
                  setVisibility(v);
                }}
              >
                <Text style={{...styles.visibilityChipText, ...(selected ? styles.visibilityChipTextSelected : {})}}>
                  {t(v === "public" ? "visibilityPublic" : "visibilityPrivate")}
                  {locked ? " 🔒" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.visibilityHint}>
          {!isPremium && visibility === "private"
            ? t("visibilityPrivatePremiumOnly")
            : visibility === "public"
              ? t("visibilityPublicHint")
              : t("visibilityPrivateHint")}
        </Text>
      </View>

      <Pressable style={{...styles.saveButton, ...(saving ? styles.saveButtonDisabled : {})}} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? t("creating") : t("saveCollection")}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: CARD_BG_5,
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
  templateHint: {
    color: MUTED_17,
    lineHeight: 20,
    fontSize: 13,
    fontFamily: FONT_BODY,
  },
  templateRow: {
    gap: 10,
    paddingVertical: 4,
  },
  templateCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 4,
    minWidth: 80,
  },
  templateCardActive: {
    borderColor: AMBER_ACCENT,
    borderWidth: 2,
    backgroundColor: CARD_BG_6,
  },
  templateIcon: {
    fontSize: 24,
  },
  templateName: {
    fontSize: 12,
    fontWeight: "700",
    color: MUTED_10,
    fontFamily: FONT_BODY_BOLD,
  },
  templateNameActive: {
    color: HERO_DARK,
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
  required: {
    color: DANGER,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  photoButton: {
    borderRadius: 20,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
  },
  photoButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: 24,
    backgroundColor: AMBER_MUTED_2,
  },
  photoHint: {
    color: MUTED_17,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  visibilityRow: {
    flexDirection: "row",
    gap: 10,
  },
  visibilityChip: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  visibilityChipSelected: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  visibilityChipLocked: {
    opacity: 0.55,
  },
  visibilityChipText: {
    color: MUTED_2,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  visibilityChipTextSelected: {
    color: TEXT_ON_DARK,
  },
  visibilityHint: {
    color: MUTED_17,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: FONT_BODY,
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
