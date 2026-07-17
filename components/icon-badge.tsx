import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import {
  AMBER_SOFT_3,
  AMBER_SOFT_5,
  CARD_BG_2,
  CARD_BG_3,
  CARD_BG_14,
  RING_INNER_SIZE,
  RING_MIDDLE_SIZE,
  RING_OUTER_SIZE,
} from "@/lib/design-tokens";

type IconBadgeProps = {
  /** Emoji (or short glyph) rendered at the centre of the rings. */
  icon: string;
  /** Forwarded to the outermost ring for caller-side spacing. */
  style?: StyleProp<ViewStyle>;
};

/**
 * Three concentric cream-to-amber rings (CARD_BG_2 → CARD_BG_3 →
 * CARD_BG_14) around an emoji — the empty-state icon treatment, extracted
 * so upsell prompts / onboarding / badges can reuse it and designers tune
 * the gradient in one place. The 96/76/56 sizes keep the intentional 20px
 * concentric step; don't reshuffle one ring without the others.
 */
export function IconBadge({ icon, style }: IconBadgeProps) {
  return (
    <View style={[styles.outer, style]}>
      <View style={styles.middle}>
        <View style={styles.inner}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: RING_OUTER_SIZE,
    height: RING_OUTER_SIZE,
    borderRadius: RING_OUTER_SIZE / 2,
    backgroundColor: CARD_BG_2,
    borderWidth: 1,
    borderColor: AMBER_SOFT_3,
    alignItems: "center",
    justifyContent: "center",
  },
  middle: {
    width: RING_MIDDLE_SIZE,
    height: RING_MIDDLE_SIZE,
    borderRadius: RING_MIDDLE_SIZE / 2,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT_5,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    width: RING_INNER_SIZE,
    height: RING_INNER_SIZE,
    borderRadius: RING_INNER_SIZE / 2,
    backgroundColor: CARD_BG_14,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 28,
  },
});
