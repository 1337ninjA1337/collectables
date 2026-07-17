import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ItemCard } from "@/components/item-card";
import { AMBER_ACCENT, CARD_BG, CARD_BG_3, TEXT_ON_DARK_5 } from "@/lib/design-tokens";
import { CollectableItem } from "@/lib/types";

type Props = {
  item: CollectableItem;
  selected: boolean;
  onToggle: (id: string) => void;
};

// Fixed row height for FlatList `getItemLayout`: the row's height is driven
// by the ItemCard photo column (104px image + 12px card padding top/bottom
// + 1px card border top/bottom = 130) plus this wrapper's 2px selection
// border top/bottom. The text column is capped below that (2-line-clamped
// description), so the photo column is the height authority. If the 104px
// image or either border/padding changes, update this constant in lockstep
// — a stale value here shifts the selection-list windowing math.
export const SELECTABLE_ROW_HEIGHT = 134;

// VM-F: wrapped in React.memo so the selection-mode FlatList's renderItem
// (now hoisted into a `useCallback` with `extraData={selectedIds}`) can
// actually skip work for rows whose `selected` flag and `item` reference
// didn't change between renders. Without the memo the default shallow
// equality on a plain function component still re-runs the entire render —
// the memo is the latch that turns the parent's useCallback into a real
// perf win.
export const SelectableItemRow = memo(function SelectableItemRow({ item, selected, onToggle }: Props) {
  return (
    <Pressable onPress={() => onToggle(item.id)} style={[styles.wrap, selected && styles.wrapSelected]}>
      <View pointerEvents="none">
        <ItemCard item={item} />
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        {selected ? <Text style={styles.check}>✓</Text> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "transparent",
  },
  wrapSelected: {
    borderColor: AMBER_ACCENT,
    backgroundColor: CARD_BG_3,
  },
  checkbox: {
    position: "absolute",
    top: 14,
    right: 14,
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
    lineHeight: 18,
  },
});
