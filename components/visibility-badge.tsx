import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/components/use-app-theme";
import { ACCENT_DEEP_2, MUTED_2, SUCCESS_GREEN_2, TEXT_ON_DARK } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { Collection } from "@/lib/types";
import { FONT_BODY, FONT_BODY_BOLD } from "@/lib/fonts";

type Variant = "card" | "hero";

export function VisibilityBadge({
  collection,
  variant = "card",
}: {
  collection: Collection;
  variant?: Variant;
}) {
  const { t } = useI18n();
  const theme = useAppTheme();

  const isViewer = collection.role === "viewer";
  const isPublic = collection.visibility === "public";

  const label = isViewer
    ? t("visibilityViewer")
    : isPublic
      ? t("visibilityPublic")
      : t("visibilityPrivate");

  const iconName = isViewer
    ? ("people" as const)
    : isPublic
      ? ("globe-outline" as const)
      : ("lock-closed-outline" as const);

  const isShared = isPublic;

  const isHero = variant === "hero";

  // Neutral (private, card) badge text/icon follows the OS theme so it stays
  // legible on both light and dark page surfaces. Viewer/shared/hero keep
  // their semantic colors (green / amber / on-image white).
  const isNeutral = !isHero && !isViewer && !isShared;

  return (
    <View
      style={[
        styles.badge,
        isHero && styles.badgeHero,
        isViewer && (isHero ? styles.badgeViewerHero : styles.badgeViewer),
        isShared && !isViewer && (isHero ? styles.badgeSharedHero : styles.badgeShared),
        !isShared && !isViewer && (isHero ? styles.badgePrivateHero : styles.badgePrivate),
      ]}
    >
      <Ionicons
        name={iconName}
        size={isHero ? 14 : 12}
        color={
          isHero
            ? TEXT_ON_DARK
            : isViewer
              ? SUCCESS_GREEN_2
              : isShared
                ? ACCENT_DEEP_2
                : theme.text
        }
      />
      <Text
        style={[
          styles.badgeText,
          isHero && styles.badgeTextHero,
          isViewer && !isHero && styles.badgeTextViewer,
          isShared && !isViewer && !isHero && styles.badgeTextShared,
          isNeutral && { color: theme.text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeHero: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeViewer: {
    backgroundColor: "rgba(74, 124, 89, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 124, 89, 0.25)",
  },
  badgeViewerHero: {
    backgroundColor: "rgba(74, 180, 100, 0.3)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  badgeShared: {
    backgroundColor: "rgba(216, 156, 91, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(216, 156, 91, 0.3)",
  },
  badgeSharedHero: {
    backgroundColor: "rgba(216, 156, 91, 0.35)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  badgePrivate: {
    backgroundColor: "rgba(107, 86, 71, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(107, 86, 71, 0.2)",
  },
  badgePrivateHero: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED_2,
    fontFamily: FONT_BODY_BOLD,
  },
  badgeTextHero: {
    color: TEXT_ON_DARK,
    fontSize: 12,
    fontFamily: FONT_BODY_BOLD,
  },
  badgeTextViewer: {
    color: SUCCESS_GREEN_2,
    fontFamily: FONT_BODY_BOLD,
  },
  badgeTextShared: {
    color: ACCENT_DEEP_2,
    fontFamily: FONT_BODY_BOLD,
  },
});
