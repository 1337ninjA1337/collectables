import { memo, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AMBER_MUTED,
  AMBER_SOFT,
  BORDER,
  BORDER_3,
  CARD_BG_3,
  MUTED,
  RADIUS_CARD,
  SPACING_CARD,
  TEXT_DARK,
} from "@/lib/design-tokens";

type Props = {
  /** The row's picture, if there is one — an item photo, a cover, an avatar. */
  photo?: string;
  /** What stands in for a missing picture. */
  fallbackEmoji: string;
  /**
   * `true` for a person, who gets a rounder frame and a warm fill behind the
   * placeholder — the one visual difference between the three sections, and
   * the reason this is a prop rather than a constant.
   */
  avatar?: boolean;
  /** The first line: an item's title, a collection's name, a person's name. */
  title: string;
  /**
   * The second line. A node rather than a string because the items section
   * puts a `<CostBadge>` in it, which renders a converted amount and an "≈"
   * and therefore cannot be flattened into text by the caller. Nested text
   * nodes take {@link SEARCH_RESULT_META_STYLE} so they inherit nothing by
   * accident.
   */
  meta: ReactNode;
  onPress: () => void;
};

/**
 * One result in the search overlay: a picture, a title, a meta line.
 *
 * `components/search-overlay.tsx` drew this three times — items, collections
 * and people — in twenty near-identical lines apiece, with the same four-line
 * comment about the heading above each copy. Everything that differed between
 * the three is a prop here (the picture, the placeholder emoji, the avatar
 * frame, the two lines of text), which is what makes the differences the only
 * thing left to read; everything that did not differ was being maintained in
 * triplicate, including the `accessibilityRole="button"` and the
 * `numberOfLines={1}` that keep a long title from pushing the meta line off
 * the row.
 *
 * `memo`, like `<SheetSearchRow>` and `<CostBadge>`: the overlay re-renders on
 * every keystroke and each of the three sections can hold twenty of these.
 */
export const SearchResultRow = memo(function SearchResultRow({
  photo,
  fallbackEmoji,
  avatar,
  title,
  meta,
  onPress,
}: Props) {
  const frame = avatar ? styles.rowAvatar : styles.rowThumb;
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowContent}>
        {photo ? (
          <Image source={{ uri: photo }} style={frame} />
        ) : (
          <View style={[frame, styles.rowFrameEmpty]}>
            <Text style={styles.rowEmoji}>{fallbackEmoji}</Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_3,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_CARD,
  },
  rowThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: BORDER,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: RADIUS_CARD,
    backgroundColor: AMBER_MUTED,
  },
  rowFrameEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  rowEmoji: {
    fontSize: 18,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
  },
  rowMeta: {
    color: MUTED,
    fontSize: 13,
  },
});

/**
 * The meta line's own text style, for a node the caller nests inside it.
 *
 * Exported because `<CostBadge style={…}>` renders its own `<Text>` and its
 * header says the caller owns the typography. Reaching for the stylesheet
 * from outside is what the overlay used to do by having its own copy of these
 * rules, which is the thing this component removes.
 */
export const SEARCH_RESULT_META_STYLE = styles.rowMeta;
