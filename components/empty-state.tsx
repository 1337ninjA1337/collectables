import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  AMBER_ACCENT,
  AMBER_SOFT_3,
  AMBER_SOFT_5,
  CARD_BG_2,
  CARD_BG_3,
  CARD_BG_14,
  RADIUS_CARD_AIRY,
  RADIUS_PILL,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { useAppTheme } from "@/components/use-app-theme";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

type EmptyStateProps = {
  icon?: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  children?: ReactNode;
};

export function EmptyState({
  icon = "📦",
  title,
  hint,
  actionLabel,
  onAction,
  compact,
  children,
}: EmptyStateProps) {
  const theme = useAppTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: theme.card }, compact && styles.wrapCompact]}>
      <View style={styles.iconOuter}>
        <View style={styles.iconMiddle}>
          <View style={styles.iconInner}>
            <Text style={styles.icon}>{icon}</Text>
          </View>
        </View>
      </View>
      <Text style={{ ...styles.title, color: theme.text }}>{title}</Text>
      {hint ? <Text style={{ ...styles.hint, color: theme.meta }}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable style={styles.action} onPress={onAction} accessibilityRole="button">
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 12,
    borderRadius: RADIUS_CARD_AIRY,
    borderWidth: 1.5,
    borderColor: AMBER_SOFT_3,
    borderStyle: "dashed",
  },
  wrapCompact: {
    paddingVertical: 22,
  },
  iconOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: CARD_BG_2,
    borderWidth: 1,
    borderColor: AMBER_SOFT_3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  iconMiddle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT_5,
    alignItems: "center",
    justifyContent: "center",
  },
  iconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CARD_BG_14,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 28,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  hint: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 320,
    fontFamily: FONT_BODY,
  },
  action: {
    marginTop: 10,
    backgroundColor: AMBER_ACCENT,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: RADIUS_PILL,
  },
  actionText: {
    color: TEXT_ON_DARK_5,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
