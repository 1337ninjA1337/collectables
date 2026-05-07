import { Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { FONT_BODY } from "@/lib/fonts";

export type CrashFallbackProps = {
  error: unknown;
  resetError?: () => void;
  /** Translation lookup. When omitted the component falls back to English. */
  t?: (key: string) => string;
};

const FALLBACK_STRINGS = {
  crashFallbackTitle: "Something went wrong",
  crashFallbackBody:
    "An unexpected error occurred and we've logged it for review. Try again or restart the app.",
  crashFallbackRetry: "Try again",
} as const;

function pick(t: ((key: string) => string) | undefined, key: keyof typeof FALLBACK_STRINGS): string {
  if (!t) return FALLBACK_STRINGS[key];
  const value = t(key);
  // i18n returns the key itself when no entry is registered — fall back to
  // the bundled English copy so the fallback never renders raw keys.
  return value && value !== key ? value : FALLBACK_STRINGS[key];
}

export function CrashFallback({ error, resetError, t }: CrashFallbackProps) {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return (
    <View style={styles.wrap}>
      <EmptyState
        icon="🪧"
        title={pick(t, "crashFallbackTitle")}
        hint={pick(t, "crashFallbackBody")}
        actionLabel={resetError ? pick(t, "crashFallbackRetry") : undefined}
        onAction={resetError}
      />
      {detail ? (
        <Pressable accessibilityRole="text">
          <Text style={styles.detail} numberOfLines={3}>
            {detail}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#fffaf4",
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 16,
    justifyContent: "center",
  },
  detail: {
    color: "#8a705a",
    fontSize: 12,
    fontFamily: FONT_BODY,
    textAlign: "center",
  },
});
