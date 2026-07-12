import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  HERO_DARK,
  MUTED,
  PAGE_BG_2,
  RADIUS_CARD_LG,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD, FONT_DISPLAY } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { usePremium, type PremiumIntentSource } from "@/lib/premium-context";
import { useToast } from "@/lib/toast-context";

type Props = {
  visible: boolean;
  /** Dismiss the sheet without activating (backdrop tap / "Maybe later"). */
  onClose: () => void;
  /**
   * Fired AFTER premium is activated and the sheet closed, so the caller can
   * apply the action the user was originally blocked from (e.g. flip the
   * collection's visibility to private).
   */
  onActivated?: () => void;
  /** Headline — defaults to the generic premium title. */
  title?: string;
  /** Sub-headline explaining the locked feature in context. */
  body?: string;
  /**
   * Which screen surfaced the sheet — becomes `premium_activated.source` so
   * dashboards can rank upgrade surfaces. Defaults to the generic sheet tag.
   */
  source?: PremiumIntentSource;
};

/**
 * Conversion-friendly replacement for the fire-and-forget "premium only" toast.
 * When a free user taps a premium-gated affordance (e.g. the Private visibility
 * chip), surface this sheet: it explains the benefit, lists what premium
 * unlocks, and offers a one-tap "Activate premium" CTA instead of silently
 * refusing the action.
 */
export function PremiumUpsellSheet({ visible, onClose, onActivated, title, body, source }: Props) {
  const { t } = useI18n();
  const { activatePremium } = usePremium();
  const toast = useToast();

  function handleActivate() {
    activatePremium(source ?? "upsell_sheet");
    toast.success(t("premiumActivated"));
    onClose();
    onActivated?.();
  }

  const benefits = [t("premiumBenefit1"), t("premiumBenefit2"), t("premiumBenefit3")];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.lock}>🔒</Text>
          <Text style={styles.title}>{title ?? t("premiumTitle")}</Text>
          <Text style={styles.body}>{body ?? t("premiumSubtitle")}</Text>

          <View style={styles.benefits}>
            {benefits.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <Text style={styles.benefitCheck}>✓</Text>
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>

          <Pressable style={styles.activate} onPress={handleActivate}>
            <Text style={styles.activateLabel}>{t("premiumActivate")}</Text>
          </Pressable>

          <Pressable style={styles.later} onPress={onClose}>
            <Text style={styles.laterLabel}>{t("premiumUpsellLater")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: PAGE_BG_2,
    borderRadius: RADIUS_CARD_LG,
    padding: 24,
    gap: SPACING_CARD,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  lock: {
    fontSize: 32,
  },
  title: {
    color: TEXT_DARK,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  body: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
  benefits: {
    gap: SPACING_INLINE,
    marginTop: 4,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING_LIST,
  },
  benefitCheck: {
    color: AMBER_ACCENT,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    lineHeight: 21,
  },
  benefitText: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
  activate: {
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: AMBER_ACCENT,
    marginTop: 8,
  },
  activateLabel: {
    color: TEXT_ON_DARK_2,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  later: {
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  laterLabel: {
    color: HERO_DARK,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
});
