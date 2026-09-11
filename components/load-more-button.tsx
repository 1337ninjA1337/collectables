import { Pressable, StyleSheet, Text } from "react-native";

import { AMBER_SOFT, CARD_BG_3, MUTED_3, RADIUS_CARD } from "@/lib/design-tokens";
import { FONT_BODY_BOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

/**
 * The button that grows a `useChunkedList` window, for the screens that have
 * one.
 *
 * It was written out three times — collection detail's drag-mode fallback, the
 * collections-feed screen, and the home screen's two borrowed-list tabs — with
 * the same three i18n keys, the same two style rules, and the same
 * accessibility props, each copy arriving when that screen got its window. The
 * third copy was added on 2026-09-11 and retired the same day, which is the
 * only reason this is a component rather than a fourth. The feed screen itself
 * was deleted later that day (no route in the app could reach it), so the
 * callers are collection detail and the home screen's two tabs.
 *
 * **`remaining` decides whether it renders at all.** Every copy gated on the
 * window's `hasMore` and then computed `total - visibleItems.length` for the
 * label, which are the same fact asked twice: `hasMore` is
 * `total > visibleItems.length`, so a zero `remaining` IS a window with
 * nothing left. One number, and a button reading "Load more (0 remaining)"
 * stops being expressible.
 *
 * It takes `t` from the context rather than its labels from the caller, like
 * every other component in this tree that renders a string — the three keys
 * belong to this file now, which is why the home and collection-detail screen
 * families each shrank by three.
 */
export function LoadMoreButton({
  remaining,
  onPress,
}: {
  /** Rows in the list that the window is not currently mounting. */
  remaining: number;
  onPress: () => void;
}) {
  const { t } = useI18n();
  if (remaining <= 0) return null;

  return (
    <Pressable
      style={styles.loadMore}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("loadMoreItemsA11y", { count: remaining })}
      accessibilityHint={t("loadMoreItemsHint")}
    >
      <Text style={styles.loadMoreText}>{t("loadMoreItems", { count: remaining })}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadMore: {
    borderRadius: RADIUS_CARD,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    backgroundColor: CARD_BG_3,
    alignItems: "center",
    marginTop: 4,
  },
  loadMoreText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
});
