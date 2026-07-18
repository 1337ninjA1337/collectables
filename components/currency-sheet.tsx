import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";

import { CURRENCIES } from "@/lib/currencies";
import {
  AMBER_ACCENT,
  AMBER_MUTED_6,
  AMBER_SOFT,
  BORDER_3,
  CARD_BG_3,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_13,
  MUTED_15,
  PAGE_BG_2,
  PLACEHOLDER,
  RADIUS_CARD,
  SPACING_CARD,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_DARK_3,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD, FONT_BODY_SEMIBOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

type CurrencySheetProps = {
  visible: boolean;
  selectedCode: string;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (code: string) => void;
  onClose: () => void;
};

/**
 * Bottom-sheet currency picker shared by every screen that needs a currency
 * selector (item create, collection edit). Search-as-you-type filter, single
 * selection, ISO 4217 list sourced from `lib/currencies.ts`.
 */
// HM-C4: memoized so a scroll-driven re-render of a parent screen skips the
// hidden <Modal visible={false}> subtree — pays off wherever the six props
// are referentially stable (collection detail hoists its handlers; other
// consumers still pass inline arrows and simply keep today's behaviour).
export const CurrencySheet = memo(function CurrencySheet({
  visible,
  selectedCode,
  query,
  onQueryChange,
  onSelect,
  onClose,
}: CurrencySheetProps) {
  const { t } = useI18n();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetContainer} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{t("currencySelectTitle")}</Text>

          <View style={styles.sheetSearchRow}>
            <Ionicons name="search" size={18} color={MUTED_13} />
            <MaskedTextInput
              style={styles.sheetSearchInput}
              value={query}
              onChangeText={onQueryChange}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor={PLACEHOLDER}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => onQueryChange("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={MUTED_15} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.sheetList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filtered.length === 0 ? (
              <Text style={styles.sheetEmpty}>{t("searchNoResults")}</Text>
            ) : (
              filtered.map((c) => {
                const isSelected = c.code === selectedCode;
                return (
                  <Pressable
                    key={c.code}
                    style={[styles.sheetRow, isSelected && styles.sheetRowSelected]}
                    onPress={() => onSelect(c.code)}
                  >
                    <View style={styles.currencyRowText}>
                      <Text
                        style={[styles.currencyRowCode, isSelected && styles.sheetRowNameSelected]}
                      >
                        {c.code}
                      </Text>
                      <Text style={styles.sheetRowDesc} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={22} color={AMBER_ACCENT} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable style={styles.sheetCloseButton} onPress={onClose}>
            <Text style={styles.sheetCloseText}>{t("cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26, 14, 6, 0.55)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: PAGE_BG_2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 32 : 24,
    paddingTop: 12,
    maxHeight: "70%",
    gap: 14,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: AMBER_MUTED_6,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  sheetSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_LIST,
    backgroundColor: CARD_BG_3,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  sheetSearchInput: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  sheetList: {
    maxHeight: 340,
  },
  sheetEmpty: {
    color: MUTED_2,
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 14,
    fontFamily: FONT_BODY,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_3,
    gap: SPACING_LIST,
  },
  sheetRowSelected: {
    backgroundColor: CARD_BG_3,
    borderBottomColor: "transparent",
  },
  currencyRowText: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_CARD,
    flex: 1,
  },
  currencyRowCode: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
    minWidth: 52,
  },
  sheetRowNameSelected: {
    color: AMBER_ACCENT,
  },
  sheetRowDesc: {
    color: MUTED,
    fontSize: 13,
    fontFamily: FONT_BODY,
  },
  sheetCloseButton: {
    borderRadius: RADIUS_CARD,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetCloseText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
