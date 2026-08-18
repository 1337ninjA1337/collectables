import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  activeSortChip,
  EMPTY_FILTERS,
  SORT_CHIP_ICONS,
  SORT_OPTIONS,
  type ItemSortMode,
} from "@/lib/item-filters";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocale,
  localeValues,
} from "./helpers/i18n-locales";

/**
 * The removable "active sort" quick-chip in `<ItemFilterBar>`.
 *
 * Before it existed, an active sort was invisible from the bar — `activeCount`
 * incremented but never named WHICH sort was on, so an owner who had left the
 * collection alphabetical saw only "Filters (1)" plus a reorder button that
 * refused to work (see the drag-corruption gate). The chip makes that state
 * legible and clearable without the modal round trip.
 *
 * The pure half (`activeSortChip`) is unit-tested; the render + tap-to-clear
 * wiring is pinned structurally, since `<ItemFilterBar>` pulls react-native and
 * cannot be mounted under `tsx --test`.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const ALL_MODES: ItemSortMode[] = [
  "default",
  "name-asc",
  "name-desc",
  "cost-asc",
  "cost-desc",
  "acquired-asc",
  "acquired-desc",
];

describe("activeSortChip — the pure hide/show contract", () => {
  it("returns null for the default sort (no chip when nothing is applied)", () => {
    assert.equal(activeSortChip("default"), null);
  });

  it("returns null for EMPTY_FILTERS.sort, whatever that is declared to be", () => {
    // Pins the two together: if EMPTY_FILTERS ever defaults to a real sort, the
    // bar would open with an un-clearable chip already showing.
    assert.equal(activeSortChip(EMPTY_FILTERS.sort), null);
  });

  it("returns a descriptor for every non-default mode in the union", () => {
    for (const mode of ALL_MODES) {
      if (mode === "default") continue;
      const chip = activeSortChip(mode);
      assert.ok(chip, `no chip descriptor for mode ${mode}`);
      assert.equal(chip.mode, mode);
    }
  });

  it("carries the same labelKey the sheet's picker row uses for that mode", () => {
    // The chip and the picker must not drift — a user who selects "A → Z" in
    // the sheet has to see "A → Z" on the chip, not a second wording.
    for (const option of SORT_OPTIONS) {
      const chip = activeSortChip(option.mode);
      if (option.mode === "default") {
        assert.equal(chip, null);
        continue;
      }
      assert.ok(chip);
      assert.equal(chip.labelKey, option.labelKey);
    }
  });

  it("carries an i18n KEY, not a translated label", () => {
    // Same rule as SORT_OPTIONS: the lib module must stay free of `useI18n` so
    // it is node-importable, and the copy must not freeze at import time in
    // whichever language happened to load first.
    for (const mode of ALL_MODES) {
      const chip = activeSortChip(mode);
      if (!chip) continue;
      assert.match(chip.labelKey, /^sort[A-Z]/, `${chip.labelKey} does not look like an i18n key`);
      assert.ok(!chip.labelKey.includes(" "), "labelKey looks like a rendered label");
    }
  });

  it("gives ascending and descending distinct, direction-matching icons", () => {
    const asc = activeSortChip("name-asc");
    const desc = activeSortChip("name-desc");
    assert.ok(asc && desc);
    assert.notEqual(asc.icon, desc.icon);
    assert.equal(asc.icon, "arrow-up");
    assert.equal(desc.icon, "arrow-down");
  });

  it("SORT_CHIP_ICONS covers every non-default mode and nothing else", () => {
    // The `satisfies Record<Exclude<ItemSortMode, "default">, string>` makes a
    // missing entry a compile error; this asserts the runtime shape too, and
    // that `default` never sneaks in (it has no chip — it IS the empty state).
    const covered = Object.keys(SORT_CHIP_ICONS).sort();
    const expected = ALL_MODES.filter((m) => m !== "default").sort();
    assert.deepEqual(covered, expected);
    assert.ok(!("default" in SORT_CHIP_ICONS));
  });

  it("is total — an unknown mode yields null rather than throwing", () => {
    // Defensive: a future union member added without a SORT_OPTIONS row would
    // otherwise crash the whole filter bar before the parity test catches it.
    assert.equal(activeSortChip("name-sideways" as ItemSortMode), null);
  });

  it("does not mutate or memoize across calls", () => {
    const a = activeSortChip("name-asc");
    const b = activeSortChip("name-asc");
    assert.deepEqual(a, b);
  });
});

describe("components/item-filters.tsx — chip render + tap-to-clear wiring", () => {
  const src = read("components/item-filters.tsx");

  it("derives the chip from filters.sort alone, not the whole filters object", () => {
    // Depending on `filters` would re-derive on every priceFrom keystroke.
    assert.match(
      src,
      /const\s+sortChip\s*=\s*useMemo\(\(\)\s*=>\s*activeSortChip\(filters\.sort\)\s*,\s*\[\s*filters\.sort\s*\]\)/,
    );
  });

  it("clears ONLY the sort, preserving every other active filter", () => {
    // The neighbouring `reset()` wipes all fields; the chip's ✕ must not, or a
    // user clearing the sort would silently lose their search query too.
    assert.match(src, /function\s+clearSort\(\)\s*\{\s*\n\s*onChange\(\{\s*\.\.\.filters\s*,\s*sort:\s*"default"\s*\}\);/);
    // Explicitly NOT the blanket reset.
    assert.ok(
      !/clearSort[\s\S]{0,120}EMPTY_FILTERS/.test(src),
      "clearSort must not route through EMPTY_FILTERS",
    );
  });

  it("renders the chip only when the descriptor is non-null", () => {
    assert.match(src, /\{sortChip\s*\?\s*\(/);
    assert.match(src, /\)\s*:\s*null\}/);
  });

  it("renders label, direction icon and a close affordance", () => {
    const start = src.indexOf("{sortChip ? (");
    const end = src.indexOf("{activeCount > 0 ? (", start);
    assert.ok(start > 0 && end > start, "sort chip block not found before the reset chip");
    const block = src.slice(start, end);
    assert.match(block, /name=\{sortChip\.icon\}/);
    assert.match(block, /\{t\(sortChip\.labelKey\)\}/);
    assert.match(block, /name="close-circle"/);
    assert.match(block, /onPress=\{clearSort\}/);
  });

  it("is announced with a labelled button role, not colour alone", () => {
    const start = src.indexOf("{sortChip ? (");
    const block = src.slice(start, src.indexOf("{activeCount > 0 ? (", start));
    assert.match(block, /accessibilityRole="button"/);
    assert.match(block, /accessibilityLabel=\{t\("sortChipClear",\s*\{\s*sort:\s*t\(sortChip\.labelKey\)\s*\}\)\}/);
  });

  it("sits in the quickChips ScrollView, between the toggles and the reset chip", () => {
    const chipsIdx = src.indexOf("{quickChips.map(");
    const sortIdx = src.indexOf("{sortChip ? (");
    const resetIdx = src.indexOf("{activeCount > 0 ? (");
    assert.ok(chipsIdx > 0 && sortIdx > 0 && resetIdx > 0);
    assert.ok(
      chipsIdx < sortIdx && sortIdx < resetIdx,
      `expected quickChips → sortChip → resetChip, got ${chipsIdx}/${sortIdx}/${resetIdx}`,
    );
  });

  it("uses its own styles, not the sheet picker's sortChip/sortChipActive", () => {
    // Name collision hazard: the sheet already declares `sortChip` styles for
    // an UNSELECTED picker option. The bar chip always renders in its applied
    // state, so it must not borrow them.
    assert.match(src, /sortQuickChip:\s*\{[\s\S]*?backgroundColor:\s*AMBER_ACCENT/);
    assert.match(src, /sortQuickChipText:\s*\{[\s\S]*?color:\s*TEXT_ON_DARK_5/);
    assert.match(src, /style=\{styles\.sortQuickChip\}/);
  });

  it("declares no inline hex literals in the new styles", () => {
    const start = src.indexOf("sortQuickChip: {");
    const block = src.slice(start, src.indexOf("resetChip: {", start));
    assert.ok(!/#[0-9a-fA-F]{3,8}/.test(block), "sortQuickChip styles contain an inline hex literal");
  });

  it("re-exports activeSortChip + SORT_CHIP_ICONS from the historical import path", () => {
    assert.match(src, /export\s*\{[\s\S]*?\bactiveSortChip\b[\s\S]*?\}/);
    assert.match(src, /export\s*\{[\s\S]*?\bSORT_CHIP_ICONS\b[\s\S]*?\}/);
    assert.match(src, /export\s+type\s*\{[\s\S]*?\bActiveSortChip\b[\s\S]*?\}/);
  });
});

describe("i18n — sortChipClear across all 6 supported languages", () => {
  const src = readI18nSource();

  it("declares sortChipClear in the en base table (it defines TranslationKey)", () => {
    assert.match(src, /sortChipClear:\s*\(params\?: TranslationParams\)\s*=>/);
  });

  it("is a parameterised function taking { sort }, not a static string", () => {
    // The chip names the active mode, so the copy has to interpolate. Asked of
    // each locale map in turn rather than counted over the file: six hits
    // anywhere is satisfied by a locale declaring it twice while another does
    // not declare it at all.
    assertDeclaredInEveryLocale(src, "sortChipClear");
    assertMatchesInEveryLocale(
      src,
      /sortChipClear:\s*\(params\?: TranslationParams\)\s*=>\s*\n?\s*`[^`]*\$\{params\?\.sort \?\? ""\}[^`]*`/,
      "sortChipClear interpolates { sort }",
    );
  });

  it("gives each locale distinct copy (no untranslated en fallbacks)", () => {
    const bodies = localeValues(
      src,
      /sortChipClear:\s*\(params\?: TranslationParams\)\s*=>\s*\n?\s*`([^`]+)`/,
      "sortChipClear",
    );
    assert.equal(
      new Set(bodies.values()).size,
      bodies.size,
      `expected distinct translations, got ${JSON.stringify([...bodies])}`,
    );
  });
});
