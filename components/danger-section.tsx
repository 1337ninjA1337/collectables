import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  CARD_BG_11,
  DANGER_DEEP_2,
  DANGER_DEEP_5,
  DANGER_MEDIUM,
  DANGER_SOFT_3,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SPACING_CARD,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import {
  SOFT_DESTRUCTIVE_FOREGROUND,
  SOFT_DESTRUCTIVE_SURFACE,
} from "@/lib/danger-surface";

/**
 * `"soft"` is the reversible destructive action — sign out, leave a collection,
 * cancel a subscription: a pale outlined pill with red text, safe to sit inline
 * in a settings list. `"hard"` is the irreversible one — delete account, delete
 * collection: a filled red pill that only appears inside a bordered "danger
 * zone" card.
 *
 * Tone drives four coupled values (surface, border, label colour, whether the
 * button stretches), which is why it is one prop rather than four.
 */
export type DangerTone = "soft" | "hard";

type Props = {
  /** Button label. Already localized by the caller. */
  actionLabel: string;
  onAction: () => void;
  tone?: DangerTone;
  /**
   * Heading for the surrounding danger-zone card. Supplying `title` (or `hint`)
   * is what makes the component render that card at all — a bare `actionLabel`
   * renders the button alone, which is the shape a settings list wants.
   */
  title?: string;
  /** Supporting copy under the heading. Already localized. */
  hint?: string;
  /**
   * Greys the button out and blocks presses. Kept as one prop rather than a
   * `pending` / `busy` pair because every call site ORs its own conditions.
   */
  disabled?: boolean;
};

/**
 * The destructive-action widget shared by every "are you sure" surface.
 *
 * Settings declared both halves of this inline — a soft sign-out pill and a
 * hard delete-account zone — as nine stylesheet entries built from seven
 * `DANGER_*` / `CARD_BG_*` tokens. The same recipe is wanted by collection
 * delete, profile delete and premium cancel, and each of those re-deriving it
 * is how a hex one channel off from `DANGER_SOFT_2` ends up in the codebase —
 * invisible to the eye, invisible to git blame.
 *
 * The disabled treatment is `opacity: 0.6` for both tones, matching what
 * settings did and what the rest of the app does for pressables.
 */
export const DangerSection = memo(function DangerSection({
  actionLabel,
  onAction,
  tone = "soft",
  title,
  hint,
  disabled = false,
}: Props) {
  const hard = tone === "hard";
  const button = (
    <Pressable
      style={{
        ...(hard ? styles.hardButton : styles.softButton),
        ...(disabled ? styles.disabled : {}),
      }}
      onPress={onAction}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={hard ? styles.hardButtonText : styles.softButtonText}>{actionLabel}</Text>
    </Pressable>
  );

  // No heading and no hint means there is nothing for the zone card to frame,
  // so the button is returned bare rather than wrapped in an empty box.
  if (!title && !hint) return button;

  return (
    <View style={styles.zone}>
      {title ? <Text style={styles.zoneTitle}>{title}</Text> : null}
      {hint ? <Text style={styles.zoneHint}>{hint}</Text> : null}
      {button}
    </View>
  );
});

const styles = StyleSheet.create({
  softButton: {
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    // Same treatment as <SoftDestructiveChip>, one size up — see there for why
    // the colours are shared but the geometry is not.
    ...SOFT_DESTRUCTIVE_SURFACE,
  },
  softButtonText: {
    color: SOFT_DESTRUCTIVE_FOREGROUND,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  hardButton: {
    alignSelf: "flex-start",
    borderRadius: RADIUS_PILL,
    backgroundColor: DANGER_DEEP_2,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  hardButtonText: {
    color: TEXT_ON_DARK_4,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  disabled: {
    opacity: 0.6,
  },
  zone: {
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: CARD_BG_11,
    borderWidth: 1,
    borderColor: DANGER_SOFT_3,
    padding: 18,
    gap: SPACING_CARD,
  },
  zoneTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DANGER_DEEP_5,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  zoneHint: {
    color: DANGER_MEDIUM,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
});
