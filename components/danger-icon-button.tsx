import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet } from "react-native";

import {
  DESTRUCTIVE_ICON_FOREGROUND,
  DESTRUCTIVE_ICON_SURFACE,
} from "@/lib/danger-surface";
import { RADIUS_PILL } from "@/lib/design-tokens";

type Props = {
  /** Ionicon name. Defaults to the trash every current caller wanted. */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /**
   * REQUIRED, unlike the label-bearing widgets in this family: an icon-only
   * control renders no text, so without this a screen reader announces the
   * button and nothing about what it does. The wishlist row shipped without
   * one; centralising the button closes that for every future caller instead
   * of one at a time.
   */
  accessibilityLabel: string;
  /** Greys the button out and blocks presses, like `<DangerSection>`. */
  disabled?: boolean;
};

/**
 * The pale-red round icon button: "delete this row", with no room for a label.
 *
 * Lifted verbatim from the wishlist row's `deleteButton`, which was the only
 * declaration of the recipe — pill radius, 10/8 padding, and the
 * `CARD_BG_8` + `DANGER_SOFT` + `DANGER_DEEP_3` triple now named by
 * {@link DESTRUCTIVE_ICON_SURFACE}. Every list view that supports per-row
 * delete wants the same four lines (item card, collection card, listing card),
 * and each of them re-deriving it by hand is how a fourth near-miss hex lands
 * in the palette.
 *
 * This is the icon-only member of the destructive family:
 * `<SoftDestructiveChip>` is the inline pill WITH a label,
 * `<DangerSection tone="soft">` the block button, `tone="hard"` the filled
 * one. Pick by how much text the affordance can carry and how much room it
 * has: a row-end control has neither.
 */
export const DangerIconButton = memo(function DangerIconButton({
  icon = "trash-outline",
  onPress,
  accessibilityLabel,
  disabled = false,
}: Props) {
  return (
    <Pressable
      style={{ ...styles.button, ...(disabled ? styles.disabled : {}) }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={16} color={DESTRUCTIVE_ICON_FOREGROUND} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...DESTRUCTIVE_ICON_SURFACE,
  },
  // Same 0.6 as <DangerSection>, which is what the rest of the app uses for a
  // disabled pressable.
  disabled: {
    opacity: 0.6,
  },
});
