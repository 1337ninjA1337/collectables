import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SheetSearchRow } from "@/components/sheet-search-row";

import { currencyPickerGroups } from "@/lib/currencies";
import {
  AMBER_ACCENT,
  AMBER_MUTED_6,
  AMBER_SOFT,
  BORDER_3,
  CARD_BG_3,
  MUTED,
  MUTED_2,
  MUTED_3,
  PAGE_BG_2,
  RADIUS_CARD,
  SPACING_CARD,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_DARK_3,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

type CurrencySheetProps = {
  visible: boolean;
  selectedCode: string;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (code: string) => void;
  onClose: () => void;
  /**
   * WHICH currency is being picked, for a screen that asks more than once.
   *
   * Settings opens this one sheet for two different questions — what totals
   * are shown in, and what new costs are typed in — and both arrived under
   * "Select currency". The only thing telling them apart was which row had a
   * checkmark, which a screen-reader user reaches last and a sighted user
   * reads as "I already picked this". Omitted, the generic title stands: a
   * create form has already said what the field is.
   */
  title?: string;
  /**
   * The codes this user has picked before, most recent first.
   *
   * The chip strip above the cost input has led with these since it was
   * written, and the sheet behind the "…" chip ignored them: a collector who
   * types in three currencies scrolled 160 ISO rows to reach the fourth, past
   * the three they use. Only meaningful while the search box is empty — a
   * query is somebody who already knows what they want, and splitting their
   * results into two sections would hide a match under a heading.
   */
  pinned?: readonly string[];
};


/**
 * Bottom-sheet currency picker shared by every screen that needs a currency
 * selector (item create, collection edit, both settings preferences).
 * Search-as-you-type filter, single selection, ISO 4217 list sourced from
 * `lib/currencies.ts`. `title` names the question when one screen asks it more
 * than once.
 */
// HM-C4: memoized so a scroll-driven re-render of a parent screen skips the
// hidden <Modal visible={false}> subtree — pays off wherever the six props
// are referentially stable (collection detail hoists its handlers; other
// consumers still pass inline arrows and simply keep today's behaviour).
/** One shared empty list, so a sheet with no shortlist re-memoizes. */
const EMPTY_PINNED: readonly string[] = [];

export const CurrencySheet = memo(function CurrencySheet({
  visible,
  selectedCode,
  query,
  onQueryChange,
  onSelect,
  onClose,
  title,
  pinned,
}: CurrencySheetProps) {
  const { t } = useI18n();
  // `pinned` defaults to nothing, which returns the one unheaded group of all
  // 160 — the list this sheet showed before the shortlist existed, and what
  // the screens that pass no shortlist still get.
  const groups = useMemo(() => currencyPickerGroups(pinned ?? EMPTY_PINNED, query), [pinned, query]);
  const empty = groups.every((group) => group.items.length === 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.sheetBackdrop}
        onPress={onClose}
        accessibilityRole="none"
      >
        <Pressable
          style={styles.sheetContainer}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="none"
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {title ?? t("currencySelectTitle")}
          </Text>

          <SheetSearchRow
            value={query}
            onChange={onQueryChange}
            placeholder={t("searchPlaceholder")}
            accessibilityLabel={t("currencyPickerSearchA11y")}
            // Currency needles are codes ("USD", "PLN") far more often than
            // names, so the keyboard opens shifted here and nowhere else.
            autoCapitalize="characters"
          />

          <ScrollView
            style={styles.sheetList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {empty ? (
              <Text style={styles.sheetEmpty}>{t("searchNoResults")}</Text>
            ) : (
              groups.map((group) => (
                <View key={group.kind ?? "all-currencies"}>
                  {group.kind === null ? null : (
                    // A section label, and a header: VoiceOver and TalkBack
                    // both navigate by heading, so "the long list starts here"
                    // is how somebody skips the shortlist without swiping
                    // through it.
                    <Text style={styles.sectionTitle} accessibilityRole="header">
                      {group.kind === "recent" ? t("currencyRecent") : t("currencyAll")}
                    </Text>
                  )}
                  {group.items.map((c) => {
                    const isSelected = c.code === selectedCode;
                    return (
                      <Pressable
                        key={c.code}
                        style={[styles.sheetRow, isSelected && styles.sheetRowSelected]}
                        onPress={() => onSelect(c.code)}
                        // The row announces its code and name from its own
                        // <Text> children; which one is CHOSEN is drawn as a
                        // checkmark and said nowhere. This is that, in words
                        // the platform speaks.
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <View style={styles.currencyRowText}>
                          <Text
                            style={[
                              styles.currencyRowCode,
                              isSelected && styles.sheetRowNameSelected,
                            ]}
                          >
                            {c.code}
                          </Text>
                          <Text style={styles.sheetRowDesc} numberOfLines={1}>
                            {c.name}
                          </Text>
                        </View>
                        {isSelected ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={22}
                            color={AMBER_ACCENT}
                            accessibilityElementsHidden
                            importantForAccessibility="no"
                            aria-hidden
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          <Pressable

            style={styles.sheetCloseButton}

            onPress={onClose}

            accessibilityRole="button"

          >
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
  sectionTitle: {
    color: MUTED_2,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingTop: SPACING_LIST,
    paddingBottom: 6,
    paddingHorizontal: 12,
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
