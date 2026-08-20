import { memo, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  HERO_DARK,
  MUTED,
  MUTED_2,
  PURE_WHITE,
  RADIUS_PILL,
  SPACING_CARD,
  SPACING_LIST,
  SUCCESS_GREEN_2,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { useShareLink } from "@/lib/use-share-link";

type Props = {
  visible: boolean;
  /**
   * The fully-built deep link — the caller owns `buildDeepLink()` because the
   * path shape (`item/:id`, `collection/:id`, `profile/:id`) is its concern.
   */
  url: string;
  /** Localized one-liner under the title ("shareItemHint", "shareCollectionHint", …). */
  hint: string;
  /** Prefixed to the native share payload — the item/collection/profile name. */
  message?: string;
  onClose: () => void;
  /** Fired after a successful clipboard write, for analytics/toasts. */
  onCopy?: (url: string) => void;
  /** Extra sections rendered between the actions row and the Cancel button. */
  children?: ReactNode;
};

/**
 * The deep-link share sheet shared by every screen that can be shared:
 * handle bar + title/hint + link box + copy/native actions + Cancel. Owns its
 * own styles, its own i18n keys and the `copied` feedback state so a consumer
 * never re-implements the 2s reset timer (which `useShareLink` cleans up on
 * unmount — the inline copies it replaced all leaked their pending timeout).
 *
 * Consumers layer their own sections in via `children`
 * (see `<CollectionShareSheet>`'s friends / people-with-access lists).
 *
 * Copy vs. share is platform-exclusive by design (`useShareLink`'s `canCopy`):
 * `navigator.clipboard` only exists on web, and the pre-extraction sheets
 * rendered a copy button on native that silently did nothing when pressed.
 */
export const ShareSheet = memo(function ShareSheet({
  visible,
  url,
  hint,
  message,
  onClose,
  onCopy,
  children,
}: Props) {
  const { t } = useI18n();
  const { copied, canCopy, copyLink, shareNative } = useShareLink(url, { message, onCopy });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.shareBackdrop}
        onPress={onClose}
        accessibilityRole="none"
      >
        <Pressable
          style={styles.shareSheet}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="none"
        >
          <ScrollView bounces={false} contentContainerStyle={styles.shareSheetContent}>
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>{t("shareTitle")}</Text>
            <Text style={styles.shareHint}>{hint}</Text>
            <View style={styles.shareLinkBox}>
              <Text style={styles.shareLinkText} numberOfLines={1}>{url}</Text>
            </View>
            <View style={styles.shareActions}>
              {canCopy ? (
                <Pressable
                  accessibilityRole="button"
                  style={{ ...styles.shareCopyButton, ...(copied ? styles.shareCopyButtonDone : {}) }}
                  onPress={copyLink}
                >
                  <Text style={{ ...styles.shareCopyButtonText, ...(copied ? styles.shareCopyButtonTextDone : {}) }}>
                    {copied ? t("linkCopied") : t("copyLink")}
                  </Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" style={styles.shareNativeButton} onPress={shareNative}>
                  <Text style={styles.shareNativeButtonText}>{t("shareVia")}</Text>
                </Pressable>
              )}
            </View>
            {children}
            <Pressable accessibilityRole="button" style={styles.shareCancelButton} onPress={onClose}>
              <Text style={styles.shareCancelText}>{t("cancel")}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  shareBackdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.4)",
    justifyContent: "flex-end",
  },
  shareSheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  // The gap lives on the CONTENT container: on the sheet wrapper it only ever
  // spaced the single ScrollView child, so every section inside rendered flush.
  shareSheetContent: {
    gap: SPACING_CARD,
  },
  shareHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: AMBER_SOFT,
  },
  shareTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareHint: {
    color: MUTED_2,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
  shareLinkBox: {
    borderRadius: 16,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  shareLinkText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  shareActions: {
    flexDirection: "row",
    gap: SPACING_LIST,
  },
  shareCopyButton: {
    flex: 1,
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingVertical: 14,
    alignItems: "center",
  },
  shareCopyButtonDone: {
    backgroundColor: SUCCESS_GREEN_2,
  },
  shareCopyButtonText: {
    color: TEXT_ON_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareCopyButtonTextDone: {
    color: PURE_WHITE,
  },
  shareNativeButton: {
    flex: 1,
    borderRadius: RADIUS_PILL,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
  },
  shareNativeButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareCancelButton: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: PURE_WHITE,
  },
  shareCancelText: {
    color: TEXT_DARK,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
