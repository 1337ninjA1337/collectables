import { memo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { DangerIconButton } from "@/components/danger-icon-button";
import { useAppTheme } from "@/components/use-app-theme";
import {
  AMBER_ACCENT,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  MUTED,
  RADIUS_CARD_LG,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_CARD,
  SPACING_INLINE,
  TEXT_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { CollectableItem } from "@/lib/types";

/**
 * The height of one row, declared rather than implied — so the screen's
 * `getItemLayout` and this stylesheet cannot drift apart.
 *
 * A 56px thumbnail in 12px of padding, and the text column is shorter than
 * the thumb: a 15px title and two 12px meta lines, each `numberOfLines={1}`,
 * come to roughly 50. So the thumb sets the height and nothing in the row can
 * grow past it — which is the property that makes a fixed layout honest here
 * and would not hold on a row whose text wraps.
 *
 * It lives with the styles rather than with the list that reads it: the
 * number is a fact about this markup, and a `getItemLayout` whose number
 * disagrees with the style places rows where they are not.
 */
export const ARCHIVE_ROW_HEIGHT = 56 + SPACING_CARD * 2;

type Props = {
  item: CollectableItem;
  /** Resolved by the screen — the row does not reach into the collections context. */
  collectionName?: string;
  selectionMode: boolean;
  selected: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
};

/**
 * One archived item, in the two shapes the screen has for it.
 *
 * Memoized for the reason `<SelectableItemRow>` is: the screen builds a
 * `selectedById` map so a row reads a boolean instead of the parent's Set,
 * and without a memo on the row that map buys nothing — every visible row
 * re-renders on every toggle, on a list whose window is forty and whose rows
 * each mount a remote image. The map is the cheap half; this is the latch
 * that makes it worth having.
 *
 * `collectionName` is a string rather than the collection, and the theme and
 * `t` are read here rather than passed, so the props that decide a re-render
 * are the row's own item and its two booleans.
 */
export const ArchiveRow = memo(function ArchiveRow({
  item,
  collectionName,
  selectionMode,
  selected,
  busy,
  onToggle,
  onRestore,
  onDelete,
}: Props) {
  const { t } = useI18n();
  const theme = useAppTheme();
  const photo = item.photos[0];
  const surface = { ...styles.row, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT };

  const body = (
    <>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.thumb} />
      ) : (
        <View style={{ ...styles.thumb, backgroundColor: placeholderColor(item.id) }} />
      )}
      <View style={styles.rowText}>
        <Text style={{ ...styles.rowTitle, color: theme.text }} numberOfLines={1}>
          {item.title}
        </Text>
        {collectionName ? (
          <Text style={{ ...styles.rowMeta, color: theme.meta }} numberOfLines={1}>
            {collectionName}
          </Text>
        ) : null}
        {/*
          The ISO prefix, not `toLocaleDateString()`: `acquiredAt` is stored
          and rendered as `YYYY-MM-DD` everywhere else in the app, and a date
          that reads one way on this screen and another on the item it came
          from is worse than a date that is unambiguous in every locale.
        */}
        <Text style={{ ...styles.rowMeta, color: theme.meta }}>
          {t("archiveArchivedOn", { date: (item.archivedAt ?? "").slice(0, 10) })}
        </Text>
      </View>
    </>
  );

  // A row in a multi-select list is a checkbox and not a button — the same
  // call `<SelectableItemRow>` makes and for the same reason: "button"
  // announces the tap and says nothing about whether the row is in the
  // selection, which is the only state this mode has.
  if (selectionMode) {
    return (
      <Pressable
        style={{ ...surface, ...(selected ? styles.rowSelected : {}) }}
        onPress={() => onToggle(item.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={item.title}
      >
        {body}
        <View style={{ ...styles.checkbox, ...(selected ? styles.checkboxOn : {}) }}>
          {selected ? <Text style={styles.check}>✓</Text> : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={surface}>
      {body}
      <View style={styles.rowActions}>
        <Pressable
          style={styles.restore}
          onPress={() => onRestore(item.id)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={t("archiveRestoreA11y", { title: item.title })}
        >
          <Text style={styles.restoreText}>{t("archiveRestore")}</Text>
        </Pressable>
        <DangerIconButton
          onPress={() => onDelete(item.id)}
          disabled={busy}
          accessibilityLabel={t("archiveDeleteA11y", { title: item.title })}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: ARCHIVE_ROW_HEIGHT,
    gap: SPACING_CARD,
    padding: SPACING_CARD,
    borderRadius: RADIUS_CARD_LG,
    borderWidth: 1,
    backgroundColor: CARD_BG,
    borderColor: BORDER,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  rowMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_INLINE,
  },
  restore: {
    borderRadius: RADIUS_PILL,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: AMBER_ACCENT,
  },
  restoreText: {
    color: TEXT_ON_DARK_2,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  // The selected row keeps its height: an amber border replaces the neutral
  // one rather than sitting outside it, because `getItemLayout` promises
  // every row is exactly ARCHIVE_ROW_HEIGHT and a 2px wrapper would make that
  // a lie for the rows a user has touched.
  rowSelected: {
    borderColor: AMBER_ACCENT,
    backgroundColor: CARD_BG_3,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: AMBER_ACCENT,
    backgroundColor: CARD_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: AMBER_ACCENT,
  },
  check: {
    color: TEXT_ON_DARK_5,
    fontSize: 16,
    fontWeight: "900",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
