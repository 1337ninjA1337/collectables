import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AMBER_LIGHT_2,
  DANGER_DEEP_4,
  DANGER_SOFT_5,
  HERO_DARK,
  HERO_DARK_8,
  HERO_DARK_9,
  MUTED_22,
  RADIUS_CARD,
  SPACING_CARD,
  SPACING_INLINE,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

type Props = {
  count: number;
  onMove: () => void;
  onDelete: () => void;
  onCancel: () => void;
};

// BB-A: extracted from app/collection/[id].tsx so the bar is a memoized
// sibling of the selection FlatList rather than inline JSX — the four
// handlers it receives are already hoisted useCallbacks, so the memo skips
// re-renders on parent commits where neither the count nor a handler
// changed. Absolute positioning stays with the component; the page keeps
// the spacer that reserves scroll room underneath it.
export const BulkBar = memo(function BulkBar({ count, onMove, onDelete, onCancel }: Props) {
  const { t } = useI18n();
  const empty = count === 0;
  return (
    <View style={styles.bulkBar} pointerEvents="box-none">
      <View style={styles.bulkBarInner}>
        <Text style={styles.bulkBarCount}>{t("selectedCount", { count })}</Text>
        <View style={styles.bulkBarButtons}>
          <Pressable
            style={{ ...styles.bulkBarButton, ...(empty ? styles.bulkBarButtonDisabled : {}) }}
            disabled={empty}
            onPress={onMove}
          >
            <Text style={styles.bulkBarButtonText}>{t("moveToCollection")}</Text>
          </Pressable>
          <Pressable
            style={{ ...styles.bulkBarButton, ...styles.bulkBarButtonDanger, ...(empty ? styles.bulkBarButtonDisabled : {}) }}
            disabled={empty}
            onPress={onDelete}
          >
            <Text style={{ ...styles.bulkBarButtonText, ...styles.bulkBarButtonDangerText }}>{t("delete")}</Text>
          </Pressable>
          <Pressable style={{ ...styles.bulkBarButton, ...styles.bulkBarButtonGhost }} onPress={onCancel}>
            <Text style={styles.bulkBarButtonText}>{t("cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bulkBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 12,
  },
  bulkBarInner: {
    backgroundColor: HERO_DARK,
    borderRadius: RADIUS_CARD,
    padding: 14,
    gap: SPACING_CARD,
    shadowColor: HERO_DARK_9,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 10,
  },
  bulkBarCount: {
    color: AMBER_LIGHT_2,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  bulkBarButtons: {
    flexDirection: "row",
    gap: SPACING_INLINE,
    flexWrap: "wrap",
  },
  bulkBarButton: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 100,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: HERO_DARK_8,
    alignItems: "center",
  },
  bulkBarButtonDisabled: {
    opacity: 0.45,
  },
  bulkBarButtonDanger: {
    backgroundColor: DANGER_DEEP_4,
  },
  bulkBarButtonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: MUTED_22,
  },
  bulkBarButtonText: {
    color: TEXT_ON_DARK_4,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  bulkBarButtonDangerText: {
    color: DANGER_SOFT_5,
  },
});
