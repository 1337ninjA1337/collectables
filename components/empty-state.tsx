import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.iconOuter}>
        <View style={styles.iconMiddle}>
          <View style={styles.iconInner}>
            <Text style={styles.icon}>{icon}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
    backgroundColor: "#fffaf3",
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "#f0d6a1",
    borderStyle: "dashed",
  },
  wrapCompact: {
    paddingVertical: 22,
  },
  iconOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#fff7ef",
    borderWidth: 1,
    borderColor: "#f0d6a1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  iconMiddle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#eed4a0",
    alignItems: "center",
    justifyContent: "center",
  },
  iconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#ffe8c7",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 28,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: "#261b14",
    textAlign: "center",
    fontFamily: "Syne-ExtraBold",
  },
  hint: {
    fontSize: 13,
    color: "#6f5a44",
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 320,
    fontFamily: "DMSans-Regular",
  },
  action: {
    marginTop: 10,
    backgroundColor: "#d89c5b",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  actionText: {
    color: "#fff7ea",
    fontWeight: "800",
    fontSize: 14,
    fontFamily: "DMSans-ExtraBold",
  },
});
