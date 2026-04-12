import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useI18n } from "@/lib/i18n-context";
import { CollectableItem } from "@/lib/types";

export type ItemFilters = {
  priceFrom: string;
  priceTo: string;
  dateFrom: string;
  dateTo: string;
  source: string;
  hasPhotos: boolean;
};

const EMPTY_FILTERS: ItemFilters = {
  priceFrom: "",
  priceTo: "",
  dateFrom: "",
  dateTo: "",
  source: "",
  hasPhotos: false,
};

function countActiveFilters(f: ItemFilters): number {
  let n = 0;
  if (f.priceFrom) n++;
  if (f.priceTo) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  if (f.source) n++;
  if (f.hasPhotos) n++;
  return n;
}

export function applyItemFilters(items: CollectableItem[], filters: ItemFilters): CollectableItem[] {
  return items.filter((item) => {
    if (filters.priceFrom) {
      const min = parseFloat(filters.priceFrom);
      if (!isNaN(min) && (typeof item.cost !== "number" || item.cost < min)) return false;
    }
    if (filters.priceTo) {
      const max = parseFloat(filters.priceTo);
      if (!isNaN(max) && (typeof item.cost !== "number" || item.cost > max)) return false;
    }
    if (filters.dateFrom) {
      if (!item.acquiredAt || item.acquiredAt < filters.dateFrom) return false;
    }
    if (filters.dateTo) {
      if (!item.acquiredAt || item.acquiredAt > filters.dateTo) return false;
    }
    if (filters.source) {
      const needle = filters.source.toLowerCase();
      if (!item.acquiredFrom.toLowerCase().includes(needle)) return false;
    }
    if (filters.hasPhotos) {
      if (!item.photos || item.photos.length === 0) return false;
    }
    return true;
  });
}

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
            color={activeCount > 0 ? "#fff7ea" : "#5f4734"}
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
            <Ionicons name="close-circle" size={14} color="#8d2b2b" />
            <Text style={styles.resetChipText}>{t("filterReset")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t("filterTitle")}</Text>

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
                  placeholderTextColor="#b8a08a"
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
                  placeholderTextColor="#b8a08a"
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
                  placeholderTextColor="#b8a08a"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("filterDateTo")}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={draft.dateTo}
                  onChangeText={(v) => setDraft({ ...draft, dateTo: v })}
                  placeholder="2026-12-31"
                  placeholderTextColor="#b8a08a"
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
                placeholderTextColor="#b8a08a"
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
                color={draft.hasPhotos ? "#d89c5b" : "#9b8571"}
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

export { EMPTY_FILTERS };

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
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  filterButtonActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  filterButtonText: {
    color: "#5f4734",
    fontWeight: "700",
    fontSize: 13,
  },
  filterButtonTextActive: {
    color: "#fff7ea",
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  chipActive: {
    backgroundColor: "#d89c5b",
    borderColor: "#d89c5b",
  },
  chipText: {
    color: "#6b5647",
    fontWeight: "700",
    fontSize: 12,
  },
  chipTextActive: {
    color: "#fff7ea",
  },
  resetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff3f3",
    borderWidth: 1,
    borderColor: "#d9a0a0",
  },
  resetChipText: {
    color: "#8d2b2b",
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
    backgroundColor: "#fffaf3",
    borderRadius: 24,
    padding: 22,
    gap: 16,
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2d2117",
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
    color: "#624a35",
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  fieldInput: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#2f2318",
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#fff7ef",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  toggleRowActive: {
    backgroundColor: "#fff1df",
    borderColor: "#d89c5b",
  },
  toggleLabel: {
    color: "#2d2117",
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
    backgroundColor: "#261b14",
    paddingVertical: 14,
    alignItems: "center",
  },
  applyButtonText: {
    color: "#fff4e8",
    fontWeight: "800",
    fontSize: 15,
  },
  resetButton: {
    borderRadius: 18,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  resetButtonText: {
    color: "#5f4734",
    fontWeight: "800",
    fontSize: 15,
  },
});
