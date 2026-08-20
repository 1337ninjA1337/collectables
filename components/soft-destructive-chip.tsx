import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import {
  SOFT_DESTRUCTIVE_FOREGROUND,
  SOFT_DESTRUCTIVE_SURFACE,
} from "@/lib/danger-surface";
import { RADIUS_PILL } from "@/lib/design-tokens";

type Props = {
  /** Ionicon name. Defaults to the close-circle every current caller uses. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Chip label. Already localized by the caller. */
  label: string;
  onPress: () => void;
  /**
   * Spoken description when the label alone is ambiguous out of context —
   * "Reset" on its own does not say what is being reset.
   */
  accessibilityLabel?: string;
};

/**
 * A pale-red pill with an icon and a label: the "undo this state" affordance.
 *
 * `<ItemFilterBar>`'s reset chip is the shape this was lifted from, and the
 * sort/owner chip rows next to it make the class obvious — a chip row is where
 * the pattern recurs, and each new one re-deriving `CARD_BG_10` +
 * `DANGER_SOFT_2` + `DANGER_DEEP_4` is how a hex one channel off from the
 * token lands in the codebase.
 *
 * This is the chip sibling of `<DangerSection tone="soft">`, which owns the
 * block-button form of the same treatment. Pick by size and placement: a chip
 * sits inline in a scrolling row, a soft button spans a settings row.
 */
export const SoftDestructiveChip = memo(function SoftDestructiveChip({
  icon = "close-circle",
  label,
  onPress,
  accessibilityLabel,
}: Props) {
  return (
    <Pressable
      style={styles.chip}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Ionicons
        name={icon}
        size={14}
        color={SOFT_DESTRUCTIVE_FOREGROUND}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...SOFT_DESTRUCTIVE_SURFACE,
  },
  label: {
    color: SOFT_DESTRUCTIVE_FOREGROUND,
    fontWeight: "700",
    fontSize: 12,
  },
});
