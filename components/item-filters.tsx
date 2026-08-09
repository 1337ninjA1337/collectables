import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";
import { SheetSearchRow } from "@/components/sheet-search-row";
import { SoftDestructiveChip } from "@/components/soft-destructive-chip";

import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  CARD_BG_3,
  HERO_DARK,
  MUTED_2,
  MUTED_3,
  MUTED_10,
  MUTED_15,
  PLACEHOLDER,
  PURE_WHITE,
  RADIUS_CARD_LG,
  RADIUS_PILL,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import {
  activeSortChip,
  applyItemFilters,
  applySortMode,
  countActiveFilters,
  EMPTY_FILTERS,
  getTitleCollator,
  hasActiveMatchers,
  SORT_CHIP_ICONS,
  SORT_MODE_PARTS,
  SORT_OPTIONS,
  type ActiveSortChip,
  type ItemFilters,
  type ItemSortAxis,
  type ItemSortDirection,
  type ItemSortMode,
} from "@/lib/item-filters";

// Re-export the pure filter helpers + types so existing call sites that
// import from `@/components/item-filters` (where this used to live before
// the lib/ extraction) keep working unchanged.
//
// The rule is ALL-OR-NOTHING: every public export of `lib/item-filters.ts`
// is mirrored here, and `item-filters-sort-export-parity.test.ts` fails if a
// new one is added there without being threaded through. A hand-picked subset
// is what created the original drift — `countActiveFilters` and
// `getTitleCollator` existed in the lib for weeks while consumers importing
// from this path could not see them, with nothing to catch it.
export {
  activeSortChip,
  applyItemFilters,
  applySortMode,
  countActiveFilters,
  EMPTY_FILTERS,
  getTitleCollator,
  hasActiveMatchers,
  SORT_CHIP_ICONS,
  SORT_MODE_PARTS,
  SORT_OPTIONS,
};
export type { ActiveSortChip, ItemFilters, ItemSortAxis, ItemSortDirection, ItemSortMode };

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

  // The active sort is otherwise invisible until the sheet is reopened — the
  // `activeCount` badge increments but never names WHICH sort is on, so a user
  // who left the collection alphabetical sees only "Filters (1)" and, if they
  // are the owner, a reorder button that refuses to work. Surfacing it as a
  // removable chip makes the state legible and clearable in one tap.
  const sortChip = useMemo(() => activeSortChip(filters.sort), [filters.sort]);

  // Clears ONLY the sort. `reset()` next to it wipes every field, which would
  // silently drop an active search query or price range the user still wants —
  // the chip's ✕ must undo the chip, nothing else.
  function clearSort() {
    onChange({ ...filters, sort: "default" });
  }

  // Same problem the sort chip had, and worse: a search query narrows the
  // collection to a handful of items with nothing on screen naming the needle,
  // so a user who filtered by "penny" yesterday reopens the collection and
  // sees an apparently half-empty shelf. The chip renders the trimmed query
  // because that is what `applyItemFilters` actually matches on — showing the
  // raw value would claim a leading space is part of the needle.
  const queryChip = filters.query.trim();

  // Clears ONLY the query, mirroring `clearSort`.
  function clearQuery() {
    onChange({ ...filters, query: "" });
  }

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

        {queryChip.length > 0 ? (
          <Pressable
            style={styles.queryQuickChip}
            onPress={clearQuery}
            accessibilityRole="button"
            accessibilityLabel={t("queryChipClear", { query: queryChip })}
          >
            <Ionicons
              name="search"
              size={14}
              color={TEXT_ON_DARK_5}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            {/* One line, ellipsised: a long needle would otherwise push the
                sort and reset chips off the end of the horizontal scroll,
                where nothing hints they exist. */}
            <Text style={styles.queryQuickChipText} numberOfLines={1}>
              {queryChip}
            </Text>
            <Ionicons
              name="close-circle"
              size={14}
              color={TEXT_ON_DARK_5}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        ) : null}

        {sortChip ? (
          <Pressable
            style={styles.sortQuickChip}
            onPress={clearSort}
            accessibilityRole="button"
            accessibilityLabel={t("sortChipClear", { sort: t(sortChip.labelKey) })}
          >
            <Ionicons name={sortChip.icon} size={14} color={TEXT_ON_DARK_5} />
            <Text style={styles.sortQuickChipText}>{t(sortChip.labelKey)}</Text>
            <Ionicons name="close-circle" size={14} color={TEXT_ON_DARK_5} />
          </Pressable>
        ) : null}

        {activeCount > 0 ? (
          <SoftDestructiveChip label={t("filterReset")} onPress={reset} />
        ) : null}
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {/* The sheet grew past a small phone's viewport once the sort
                picker went from 3 chips to 7 (three axes x two directions, plus
                default). Without this scroll the wrapped chip rows push the
                Apply/Reset row off-screen with no way to reach it: the backdrop
                is a fixed flex:1 box that clips its overflow rather than
                scrolling it. */}
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.sheetTitle}>{t("filterTitle")}</Text>

              {/* Search by title. The row's chrome (decorative-icon hiding,
                  the named clear chip, the styles) lives in
                  `<SheetSearchRow>`; only the draft binding is ours. */}
              <SheetSearchRow
                value={draft.query}
                onChange={(v) => setDraft({ ...draft, query: v })}
                placeholder={t("searchInCollectionPlaceholder")}
                accessibilityLabel={t("searchInCollectionA11y")}
              />

              {/* Price range */}
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("filterPriceFrom")}</Text>
                  <MaskedTextInput
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
                  <MaskedTextInput
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
                  <MaskedTextInput
                    style={styles.fieldInput}
                    value={draft.dateFrom}
                    onChangeText={(v) => setDraft({ ...draft, dateFrom: v })}
                    placeholder="2024-01-01"
                    placeholderTextColor={MUTED_15}
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("filterDateTo")}</Text>
                  <MaskedTextInput
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
                <MaskedTextInput
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

              {/* Sort mode */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("sortLabel")}</Text>
                <View style={styles.sortRow}>
                  {SORT_OPTIONS.map((opt) => {
                    const active = draft.sort === opt.mode;
                    return (
                      <Pressable
                        key={opt.mode}
                        accessibilityRole="button"
                        // Without `selected`, VoiceOver announces every chip
                        // identically ("button") and the active sort is
                        // conveyed by colour alone.
                        accessibilityState={{ selected: active }}
                        style={[styles.sortChip, active && styles.sortChipActive]}
                        onPress={() => setDraft({ ...draft, sort: opt.mode })}
                      >
                        <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                          {t(opt.labelKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Actions */}
              <View style={styles.sheetActions}>
                <Pressable style={styles.applyButton} onPress={apply}>
                  <Text style={styles.applyButtonText}>{t("filterApply")}</Text>
                </Pressable>
                <Pressable style={styles.resetButton} onPress={reset}>
                  <Text style={styles.resetButtonText}>{t("filterReset")}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: SPACING_INLINE,
    paddingVertical: 4,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: RADIUS_PILL,
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
    borderRadius: RADIUS_PILL,
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
  // Distinct from the sheet's `sortChip` (an unselected picker option) — this
  // one always renders in its "on" state, so it borrows the amber `chipActive`
  // fill to read as an applied value rather than an available choice.
  sortQuickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: AMBER_ACCENT,
    borderWidth: 1,
    borderColor: AMBER_ACCENT,
  },
  sortQuickChipText: {
    color: TEXT_ON_DARK_5,
    fontWeight: "700",
    fontSize: 12,
  },
  // Shares the sort chip's "applied value" amber fill so the two read as one
  // family of active-narrowing chips rather than two unrelated widgets.
  queryQuickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: AMBER_ACCENT,
    borderWidth: 1,
    borderColor: AMBER_ACCENT,
    // The needle is user input of unbounded length; without a cap one long
    // query becomes a chip wider than the screen.
    maxWidth: 180,
  },
  queryQuickChipText: {
    color: TEXT_ON_DARK_5,
    fontWeight: "700",
    fontSize: 12,
    // Lets `numberOfLines={1}` ellipsise instead of the text forcing the
    // flex row past its maxWidth.
    flexShrink: 1,
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
    // Caps the card at the backdrop's padded box so the ScrollView inside it
    // has a bounded height to scroll within; without it the card grows past
    // the viewport and clips instead.
    maxHeight: "100%",
    backgroundColor: CARD_BG,
    borderRadius: RADIUS_CARD_LG,
    padding: 22,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sheetScroll: {
    // `flexGrow: 0` keeps a short sheet hugging its content instead of
    // stretching to the full capped height.
    flexGrow: 0,
  },
  sheetContent: {
    gap: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK_3,
  },
  fieldRow: {
    flexDirection: "row",
    gap: SPACING_CARD,
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
    gap: SPACING_LIST,
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
    gap: SPACING_LIST,
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
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING_INLINE,
  },
  sortChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  sortChipActive: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  sortChipText: {
    color: MUTED_3,
    fontWeight: "700",
    fontSize: 13,
  },
  sortChipTextActive: {
    color: TEXT_ON_DARK_5,
  },
});
