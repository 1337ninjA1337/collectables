import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DANGER_DEEP_2, DANGER_SOFT, RADIUS_PILL } from "@/lib/design-tokens";
import { FONT_BODY_SEMIBOLD } from "@/lib/fonts";

type ErrorPillProps = {
  /** Already-translated message — i18n stays at the caller. */
  label: string;
};

/**
 * Soft-red inline validation pill for form fields (invalid cost/price input,
 * future field-level errors). Renders nothing for an empty label so callers
 * can pass their error state straight through without a conditional.
 */
export const ErrorPill = memo(function ErrorPill({ label }: ErrorPillProps) {
  if (!label) return null;
  return (
    <View style={styles.pill} accessibilityRole="alert">
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    backgroundColor: DANGER_SOFT,
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: {
    color: DANGER_DEEP_2,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
});
