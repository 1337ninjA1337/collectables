import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  CARD_BG_10,
  DANGER_DEEP_4,
  DANGER_SOFT_2,
  HERO_DARK,
  MUTED_2,
  MUTED_3,
  MUTED_10,
  MUTED_15,
  PLACEHOLDER,
  PURE_WHITE,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import {
  applyItemFilters,
  applySortMode,
  countActiveFilters,
  EMPTY_FILTERS,
  type ItemFilters,
  type ItemSortMode,
} from "@/lib/item-filters";

// Re-export the pure filter helpers + type so existing call sites that
// import from `@/components/item-filters` (where this used to live before
// the lib/ extraction) keep working unchanged.
export { applyItemFilters, applySortMode, EMPTY_FILTERS };
export type { ItemFilters, ItemSortMode };

type Props = {
  filters: ItemFilters;
  onChange: (f: ItemFilters) => void;
};

export function ItemFilterBar({ filters, onChange }: Props) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<ItemFilters>(filters);

  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  function openModal() {
    setDraft(filters);
    setModalOpen(true);
  }

  function apply() {
    onChange(draft);
    setModalOpen(false);
  }

  function reset() {
    onChange(EMPTY_FILTERS);
    setDraft(EMPTY_FILTERS);
    setModalOpen(false);
  }

  // Quick toggle chips for common filters
  const quickChips = useMemo(() => {
    const chips: { key: string; label: string; active: boolean; onToggle: () => void }[] = [];
    chips.push({
      key: "photos",
      label: t("filterHasPhotos"),
      active: filters.hasPhotos,
      onToggle: () => onChange({ ...filters, hasPhotos: !filters.hasPhotos }),
    });
    return chips;
  }, [filters, onChange, t]);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
      >
        <Pressable
          style={[styles.filterButton, activeCount > 0 && styles.filterButtonActive]}
          onPress={openModal}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={activeCount > 0 ? TEXT_ON_DARK_5 : MUTED_3}
          />
          <Text style={[styles.filterButtonText, activeCount > 0 && styles.filterButtonTextActive]}>
            {activeCount > 0 ? t("filterActive", { count: activeCount }) : t("filterTitle")}
          </Text>
        </Pressable>

        {quickChips.map((chip) => (
          <Pressable
            key={chip.key}
            style={[styles.chip, chip.active && styles.chipActive]}
            onPress={chip.onToggle}
          >
            <Text style={[styles.chipText, chip.active && styles.chipTextActive]}>
              {chip.label}
            </Text>
          </Pressable>
        ))}

        {activeCount > 0 ? (
          <Pressable style={styles.resetChip} onPress={reset}>
            <Ionicons name="close-circle" size={14} color={DANGER_DEEP_4} />
            <Text style={styles.resetChipText}>{t("filterReset")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t("filterTitle")}</Text>

            {/* Search by title */}
            <View style={styles.sheetSearchRow}>
              <Ionicons name="search" size={18} color={MUTED_15} />
              <TextInput
                style={styles.sheetSearchInput}
                value={draft.query}
                onChangeText={(v) => setDraft({ ...draft, query: v })}
                placeholder={t("searchInCollectionPlaceholder")}
                placeholderTextColor={PLACEHOLDER}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {draft.query.length > 0 ? (
                <Pressable onPress={() => setDraft({ ...draft, query: "" })} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={MUTED_15} />
                </Pressable>
              ) : null}
            </View>

            {/* Price range */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("filterPriceFrom")}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={draft.priceFrom}
                  onChangeText={(v) => setDraft({ ...draft, priceFrom: v })}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={MUTED_15}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("filterPriceTo")}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={draft.priceTo}
                  onChangeText={(v) => setDraft({ ...draft, priceTo: v })}
                  keyboardType="numeric"
                  placeholder="∞"
                  placeholderTextColor={MUTED_15}
                />
              </View>
            </View>

            {/* Date range */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("filterDateFrom")}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={draft.dateFrom}
                  onChangeText={(v) => setDraft({ ...draft, dateFrom: v })}
                  placeholder="2024-01-01"
                  placeholderTextColor={MUTED_15}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("filterDateTo")}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={draft.dateTo}
                  onChangeText={(v) => setDraft({ ...draft, dateTo: v })}
                  placeholder="2026-12-31"
                  placeholderTextColor={MUTED_15}
                />
              </View>
            </View>

            {/* Source */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t("filterSource")}</Text>
              <TextInput
                style={styles.fieldInput}
                value={draft.source}
                onChangeText={(v) => setDraft({ ...draft, source: v })}
                placeholder={t("filterSourcePlaceholder")}
                placeholderTextColor={MUTED_15}
              />
            </View>

            {/* Has photos toggle */}
            <Pressable
              style={[styles.toggleRow, draft.hasPhotos && styles.toggleRowActive]}
              onPress={() => setDraft({ ...draft, hasPhotos: !draft.hasPhotos })}
            >
              <Ionicons
                name={draft.hasPhotos ? "checkbox" : "square-outline"}
                size={22}
                color={draft.hasPhotos ? AMBER_ACCENT : PLACEHOLDER}
              />
              <Text style={styles.toggleLabel}>{t("filterHasPhotos")}</Text>
            </Pressable>

            {/* Actions */}
            <View style={styles.sheetActions}>
              <Pressable style={styles.applyButton} onPress={apply}>
                <Text style={styles.applyButtonText}>{t("filterApply")}</Text>
              </Pressable>
              <Pressable style={styles.resetButton} onPress={reset}>
                <Text style={styles.resetButtonText}>{t("filterReset")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  filterButtonActive: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  filterButtonText: {
    color: MUTED_3,
    fontWeight: "700",
    fontSize: 13,
  },
  filterButtonTextActive: {
    color: TEXT_ON_DARK_5,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: {
    backgroundColor: AMBER_ACCENT,
    borderColor: AMBER_ACCENT,
  },
  chipText: {
    color: MUTED_2,
    fontWeight: "700",
    fontSize: 12,
  },
  chipTextActive: {
    color: TEXT_ON_DARK_5,
  },
  resetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD_BG_10,
    borderWidth: 1,
    borderColor: DANGER_SOFT_2,
  },
  resetChipText: {
    color: DANGER_DEEP_4,
    fontWeight: "700",
    fontSize: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(26, 14, 6, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD_BG,
    borderRadius: 24,
    padding: 22,
    gap: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK_3,
  },
  sheetSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
    fontSize: 14,
    fontWeight: "600",
  },
  fieldRow: {
    flexDirection: "row",
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
    gap: 6,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: MUTED_10,
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  fieldInput: {
    borderRadius: 14,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXT_DARK,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: TEXT_ON_DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  toggleRowActive: {
    backgroundColor: CARD_BG_3,
    borderColor: AMBER_ACCENT,
  },
  toggleLabel: {
    color: TEXT_DARK_3,
    fontWeight: "700",
    fontSize: 14,
  },
  sheetActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  applyButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: HERO_DARK,
    paddingVertical: 14,
    alignItems: "center",
  },
  applyButtonText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
    fontSize: 15,
  },
  resetButton: {
    borderRadius: 18,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  resetButtonText: {
    color: MUTED_3,
    fontWeight: "800",
    fontSize: 15,
  },
});
