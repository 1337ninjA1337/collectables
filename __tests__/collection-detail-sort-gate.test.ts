import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the sort UI + drag-corruption gate added in
 * `app/collection/[id].tsx` and `components/item-filters.tsx`.
 *
 * The drag-mode branch (NestableDraggableFlatList) MUST require
 * `itemFilters.sort === "default"` — otherwise dragging while
 * alphabetically sorted would silently re-write `sortOrder` based on
 * the visible (alphabetical) order and corrupt the user's manual
 * ordering. This file's first test is the regression guard for that.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("app/collection/[id].tsx — drag-mode sort gate (corruption fix)", () => {
  const src = read("app/collection/[id].tsx");

  it("drag-mode branch condition includes itemFilters.sort === \"default\"", () => {
    // Without this gate, the user could enter alphabetical sort, drag a
    // row, and onDragEnd would re-write `sortOrder` based on the
    // alphabetical order — destroying their manual ordering.
    assert.match(
      src,
      /isOwner\s*&&\s*!selectionMode\s*&&\s*itemFilters\.sort\s*===\s*"default"\s*\?\s*\(\s*\n\s*\/\/[^\n]*\n[\s\S]*?<NestableDraggableFlatList/,
    );
  });

  it("imports applySortMode alongside applyItemFilters", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bapplySortMode\b[^}]*\}\s*from\s*"@\/components\/item-filters"/,
    );
  });

  it("computes filteredItems via applyItemFilters and items via applySortMode in that order", () => {
    // applySortMode must run AFTER applyItemFilters so the comparator
    // works on the narrowed result set, and BEFORE useChunkedList so
    // the visible window reflects the chosen sort.
    const filterIdx = src.search(/applyItemFilters\(allItems\s*,\s*itemFilters\)/);
    const sortIdx = src.search(/applySortMode\(filteredItems\s*,\s*itemFilters\.sort\)/);
    const chunkIdx = src.search(/useChunkedList\(\s*items\s*\)/);
    assert.ok(filterIdx > 0, "applyItemFilters call missing");
    assert.ok(sortIdx > 0, "applySortMode call missing");
    assert.ok(chunkIdx > 0, "useChunkedList call missing");
    assert.ok(
      filterIdx < sortIdx && sortIdx < chunkIdx,
      `expected order applyItemFilters → applySortMode → useChunkedList, got ${filterIdx}/${sortIdx}/${chunkIdx}`,
    );
  });

  it("sort memo deps are [filteredItems, itemFilters.sort] — not [filteredItems, itemFilters]", () => {
    // Depending on the full `itemFilters` object would re-sort on every
    // priceFrom keystroke even though the sort mode hasn't changed.
    assert.match(
      src,
      /applySortMode\(filteredItems\s*,\s*itemFilters\.sort\)[\s\S]*?\[\s*filteredItems\s*,\s*itemFilters\.sort\s*\]/,
    );
  });
});

describe("components/item-filters.tsx — sort chip UI", () => {
  const src = read("components/item-filters.tsx");

  it("renders the sort label using t(\"sortLabel\")", () => {
    assert.match(src, /\{\s*t\(\s*"sortLabel"\s*\)\s*\}/);
  });

  it("renders 3 sort chips (default / name-asc / name-desc) each with accessibilityRole=\"button\"", () => {
    // The 3-mode array drives the chip rendering — pinning each mode
    // by literal string ensures a future refactor can't silently drop
    // a chip and leave the UI without (say) the Z→A option.
    assert.match(src, /mode:\s*"default"\s+as\s+ItemSortMode/);
    assert.match(src, /mode:\s*"name-asc"\s+as\s+ItemSortMode/);
    assert.match(src, /mode:\s*"name-desc"\s+as\s+ItemSortMode/);
    assert.match(src, /accessibilityRole=\{?\s*"button"\s*\}?/);
  });

  it("writes back to draft.sort via setDraft with spread (preserves other fields)", () => {
    // setDraft({ ...draft, sort: opt.mode }) preserves price/date/source
    // — a setDraft({ sort: opt.mode }) (no spread) would wipe the rest.
    assert.match(
      src,
      /setDraft\(\{\s*\.\.\.draft\s*,\s*sort:\s*opt\.mode\s*\}\)/,
    );
  });

  it("declares sortRow + sortChip + sortChipActive + sortChipText + sortChipTextActive styles", () => {
    assert.match(src, /sortRow:\s*\{[\s\S]*?flexDirection:\s*"row"/);
    assert.match(src, /sortChip:\s*\{[\s\S]*?borderRadius:\s*999/);
    assert.match(src, /sortChipActive:\s*\{/);
    assert.match(src, /sortChipText:\s*\{/);
    assert.match(src, /sortChipTextActive:\s*\{/);
  });

  it("places the sort field below the has-photos toggle (advanced filter at the bottom)", () => {
    // Sort is the last visible field before Apply/Reset — ordering
    // matters for affordance: search/price/date are primary filters,
    // sort is a polish step.
    const photosIdx = src.indexOf("filterHasPhotos");
    const sortIdx = src.indexOf("sortLabel");
    const actionsIdx = src.indexOf("sheetActions");
    assert.ok(photosIdx > 0, "filterHasPhotos field missing");
    assert.ok(sortIdx > 0, "sortLabel field missing");
    assert.ok(actionsIdx > 0, "sheetActions container missing");
    assert.ok(
      photosIdx < sortIdx && sortIdx < actionsIdx,
      `expected order filterHasPhotos → sortLabel → sheetActions, got ${photosIdx}/${sortIdx}/${actionsIdx}`,
    );
  });
});

describe("i18n — sort* keys across all 6 supported languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares sortLabel + sortDefault + sortNameAsc + sortNameDesc in the en base table", () => {
    // The en table defines the TranslationKey union (keyof typeof en),
    // so all 4 keys MUST land here — otherwise the other languages
    // can't override them and t("sortLabel") wouldn't type-check.
    assert.match(src, /sortLabel:\s*"[^"]+"/);
    assert.match(src, /sortDefault:\s*"[^"]+"/);
    assert.match(src, /sortNameAsc:\s*"[^"]+"/);
    assert.match(src, /sortNameDesc:\s*"[^"]+"/);
  });

  it("overrides each of the 4 sort keys in ru / be / pl / de / es with a localized string", () => {
    for (const lang of ["ru", "be", "pl", "de", "es"]) {
      for (const key of ["sortLabel", "sortDefault", "sortNameAsc", "sortNameDesc"]) {
        const re = new RegExp(
          `const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?${key}:\\s*"[^"]+"[\\s\\S]*?\\};`,
        );
        assert.match(
          src,
          re,
          `${lang} table is missing a localized ${key} override`,
        );
      }
    }
  });

  it("exactly 6 declarations per key (en + 5 localized overrides)", () => {
    for (const key of ["sortLabel", "sortDefault", "sortNameAsc", "sortNameDesc"]) {
      const re = new RegExp(`${key}:\\s*"[^"]+"`, "g");
      const matches = src.match(re) ?? [];
      assert.equal(
        matches.length,
        6,
        `expected 6 ${key} declarations, got ${matches.length}`,
      );
    }
  });
});
