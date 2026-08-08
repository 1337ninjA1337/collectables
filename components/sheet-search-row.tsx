import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, View, type TextInputProps } from "react-native";

import { MaskedTextInput } from "@/components/masked-text-input";
import {
  AMBER_SOFT,
  CARD_BG_3,
  MUTED_13,
  MUTED_15,
  PLACEHOLDER,
  RADIUS_INPUT,
  SPACING_LIST,
  TEXT_DARK,
} from "@/lib/design-tokens";
import { FONT_BODY_SEMIBOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

type Props = {
  value: string;
  /** Called on every keystroke AND with `""` when the clear chip is pressed. */
  onChange: (value: string) => void;
  /** Already localized by the caller — the needle differs per sheet. */
  placeholder: string;
  /**
   * Spoken label for the field. Kept separate from `placeholder` on purpose:
   * a placeholder is length-capped by the field width, a spoken label is not,
   * so every consumer passes the fuller phrase here (see the
   * `searchInCollectionPlaceholder` / `searchInCollectionA11y` pair).
   */
  accessibilityLabel: string;
  /** `"characters"` for code-ish needles (currency codes); defaults to `"none"`. */
  autoCapitalize?: TextInputProps["autoCapitalize"];
};

/**
 * The "🔎 [input] ✕" row every bottom sheet in the app puts above its list:
 * the collection picker (`app/create.tsx`), the currency picker
 * (`components/currency-sheet.tsx`) and the item filter sheet
 * (`components/item-filters.tsx`) each hand-rolled the identical
 * `View > Ionicons + TextInput + Pressable > Ionicons` shape with copies of
 * the same styles, and the copies had already drifted apart in three ways
 * (input `fontSize` 14 vs 15, a missing `fontFamily`, and a magnifier tinted
 * `MUTED_15` in one file and `MUTED_13` in the other two).
 *
 * This component is the single declaration. It resolves that drift toward the
 * majority shape — `fontSize: 15` + `FONT_BODY_SEMIBOLD`, magnifier in
 * `MUTED_13` — so the filter sheet's row now matches its two siblings rather
 * than each new sheet picking a variant at random.
 *
 * Accessibility is baked in rather than left to the consumer, because that is
 * exactly what drifted: only the filter sheet had ever been made
 * screen-reader-complete. Both `Ionicons` are hidden from the accessibility
 * tree with the PAIRED iOS/Android props (`accessibilityElementsHidden` +
 * `importantForAccessibility="no"` — shipping only one leaves the other
 * platform announcing an unnamed decorative glyph), and the clear chip is a
 * named `button` instead of the anonymous tappable it used to be in the
 * collection and currency sheets.
 *
 * The clear chip's label is read from i18n here, not passed in: "Clear search"
 * is identical in every sheet, and a per-consumer prop would just be four
 * copies of the same `t("filterClearSearch")` call waiting to drift.
 */
export const SheetSearchRow = memo(function SheetSearchRow({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  autoCapitalize = "none",
}: Props) {
  const { t } = useI18n();

  return (
    <View style={styles.row}>
      <Ionicons
        name="search"
        size={18}
        color={MUTED_13}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <MaskedTextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={PLACEHOLDER}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityRole="search"
        accessibilityLabel={accessibilityLabel}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange("")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("filterClearSearch")}
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={MUTED_15}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_LIST,
    backgroundColor: CARD_BG_3,
    borderRadius: RADIUS_INPUT,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  input: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
});
