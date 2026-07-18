import { memo } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { MaskedTextInput } from "@/components/masked-text-input";
import { trackEvent } from "@/lib/analytics";
import {
  AMBER_ACCENT,
  AMBER_MUTED_2,
  BORDER,
  CARD_BG,
  DANGER,
  HERO_DARK,
  MUTED_2,
  MUTED_10,
  MUTED_17,
  MUTED_23,
  PLACEHOLDER,
  PURE_WHITE,
  RADIUS_CARD,
  RADIUS_PILL,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import type { CollectionVisibility } from "@/lib/types";

type Props = {
  visible: boolean;
  name: string;
  description: string;
  coverUri: string;
  visibility: CollectionVisibility;
  currency: string;
  saving: boolean;
  isPremium: boolean;
  /** The collection's PERSISTED visibility (not the draft) — the premium
   * lock only targets the public→private transition, so an already-private
   * collection is never locked for a lapsed owner. */
  savedVisibility: CollectionVisibility | undefined;
  onChangeName: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeVisibility: (value: CollectionVisibility) => void;
  onPickCover: () => void | Promise<void>;
  onOpenCurrencySheet: () => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
};

// HM-C3: extracted from app/collection/[id].tsx's modalsBlock. The 7 edit
// fields deliberately STAY page state (openEditModal seeds them from the
// collection and handleSaveEdit + the currency sheet's `edit` mode consume
// them), so the component takes narrow value/setter props — during
// scroll/selection re-renders every prop is referentially stable (state
// setters + hoisted useCallbacks), so the hidden <Modal visible={false}>
// subtree skips reconciliation. The locked-chip upsell (trackEvent + toast)
// lives here with the chip that fires it.
export const EditCollectionModal = memo(function EditCollectionModal({
  visible,
  name,
  description,
  coverUri,
  visibility,
  currency,
  saving,
  isPremium,
  savedVisibility,
  onChangeName,
  onChangeDescription,
  onChangeVisibility,
  onPickCover,
  onOpenCurrencySheet,
  onSave,
  onClose,
}: Props) {
  const { t } = useI18n();
  const toast = useToast();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.editModalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{t("editCollection")}</Text>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editFieldLabel}>
              {t("collectionNameLabel")}<Text style={styles.editFieldRequired}> *</Text>
            </Text>
            <MaskedTextInput
              value={name}
              onChangeText={onChangeName}
              placeholder={t("collectionNamePlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              style={styles.editFieldInput}
            />
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editFieldLabel}>{t("collectionDescriptionLabel")}</Text>
            <MaskedTextInput
              value={description}
              onChangeText={onChangeDescription}
              placeholder={t("collectionDescriptionPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              multiline
              textAlignVertical="top"
              style={{...styles.editFieldInput, ...styles.editFieldInputMultiline}}
            />
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editFieldLabel}>{t("collectionCoverLabel")}</Text>
            <Pressable style={styles.editCoverButton} onPress={() => void onPickCover()}>
              <Text style={styles.editCoverButtonText}>{t("editCover")}</Text>
            </Pressable>
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={styles.editCoverPreview} />
            ) : null}
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editFieldLabel}>{t("visibilityLabel")}</Text>
            <View style={styles.editVisibilityRow}>
              {(["private", "public"] as const).map((v) => {
                const selected = visibility === v;
                // Block the public→private transition for non-premium users,
                // but never lock an already-private collection (so a lapsed
                // owner keeps it private without being forced to downgrade).
                const locked =
                  v === "private" &&
                  !isPremium &&
                  (savedVisibility ?? "private") !== "private";
                return (
                  <Pressable
                    key={v}
                    style={{
                      ...styles.editVisibilityChip,
                      ...(selected ? styles.editVisibilityChipSelected : {}),
                      ...(locked ? styles.editVisibilityChipLocked : {}),
                    }}
                    onPress={() => {
                      if (locked) {
                        trackEvent("premium_upsell_shown", {
                          feature: "private_collection",
                          source: "collection_edit",
                        });
                        toast.error(t("visibilityPrivatePremiumOnly"), t("premiumTitle"));
                        return;
                      }
                      onChangeVisibility(v);
                    }}
                  >
                    <Text style={{...styles.editVisibilityChipText, ...(selected ? styles.editVisibilityChipTextSelected : {})}}>
                      {t(v === "public" ? "visibilityPublic" : "visibilityPrivate")}
                      {locked ? " 🔒" : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.editVisibilityHint}>
              {!isPremium &&
              visibility === "private" &&
              (savedVisibility ?? "private") !== "private"
                ? t("visibilityPrivatePremiumOnly")
                : visibility === "public"
                  ? t("visibilityPublicHint")
                  : t("visibilityPrivateHint")}
            </Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editFieldLabel}>{t("currencyLabel")}</Text>
            <Pressable
              style={styles.editCurrencyButton}
              onPress={onOpenCurrencySheet}
              accessibilityRole="button"
              accessibilityLabel={t("currencyLabel")}
            >
              <Text style={currency ? styles.editCurrencyButtonText : styles.editCurrencyButtonPlaceholder}>
                {currency || t("collectionCurrencyAuto")}
              </Text>
            </Pressable>
            <Text style={styles.editVisibilityHint}>{t("collectionCurrencyHint")}</Text>
          </View>

          <Pressable
            style={{...styles.editSaveButton, ...(saving ? styles.editSaveButtonDisabled : {})}}
            onPress={() => void onSave()}
            disabled={saving}
          >
            <Text style={styles.editSaveButtonText}>{saving ? t("saving") : t("saveChanges")}</Text>
          </Pressable>
          <Pressable style={styles.modalCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>{t("cancelEdit")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26, 14, 6, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  modalCancel: {
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalCancelText: {
    color: MUTED_23,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD_BG,
    borderRadius: RADIUS_CARD,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  editFieldGroup: {
    gap: SPACING_INLINE,
  },
  editFieldLabel: {
    color: MUTED_10,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editFieldRequired: {
    color: DANGER,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editFieldInput: {
    borderRadius: 16,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXT_DARK,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  editFieldInputMultiline: {
    minHeight: 90,
  },
  editCoverButton: {
    borderRadius: 16,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 12,
    alignItems: "center",
  },
  editCoverButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  editCoverPreview: {
    width: "100%",
    height: 160,
    borderRadius: 16,
    backgroundColor: AMBER_MUTED_2,
  },
  editVisibilityRow: {
    flexDirection: "row",
    gap: SPACING_LIST,
  },
  editVisibilityChip: {
    borderRadius: RADIUS_PILL,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  editVisibilityChipSelected: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  editVisibilityChipLocked: {
    opacity: 0.55,
  },
  editVisibilityChipText: {
    color: MUTED_2,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  editVisibilityChipTextSelected: {
    color: TEXT_ON_DARK,
  },
  editVisibilityHint: {
    color: MUTED_17,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONT_BODY,
  },
  editCurrencyButton: {
    borderRadius: 16,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  editCurrencyButtonText: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  editCurrencyButtonPlaceholder: {
    color: PLACEHOLDER,
    fontSize: 15,
    fontFamily: FONT_BODY,
  },
  editSaveButton: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: HERO_DARK,
  },
  editSaveButtonDisabled: {
    opacity: 0.75,
  },
  editSaveButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
