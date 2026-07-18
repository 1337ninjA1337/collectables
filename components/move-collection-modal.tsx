import { memo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK_2,
  MUTED_23,
  RADIUS_CARD,
  SPACING_INLINE,
  TEXT_DARK_3,
} from "@/lib/design-tokens";
import { FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

type MoveTarget = {
  id: string;
  name: string;
};

type Props = {
  visible: boolean;
  collections: MoveTarget[];
  onMove: (targetCollectionId: string) => void | Promise<void>;
  onClose: () => void;
};

// HM-C1: extracted from app/collection/[id].tsx so the hidden
// <Modal visible={false}> subtree skips reconciliation during scroll-driven
// parent re-renders — the handlers it receives are hoisted useCallbacks and
// `collections` is the memoized otherOwnedCollections array, so the memo's
// props diff only fails when the modal actually needs to change.
export const MoveCollectionModal = memo(function MoveCollectionModal({
  visible,
  collections,
  onMove,
  onClose,
}: Props) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{t("moveToCollection")}</Text>
          <View style={styles.modalList}>
            {collections.map((c) => (
              <Pressable key={c.id} style={styles.modalRow} onPress={() => void onMove(c.id)}>
                <Text style={styles.modalRowText}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.modalCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>{t("cancel")}</Text>
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
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD_BG,
    borderRadius: RADIUS_CARD,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  modalList: {
    gap: SPACING_INLINE,
    maxHeight: 360,
  },
  modalRow: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  modalRowText: {
    color: HERO_DARK_2,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
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
});
