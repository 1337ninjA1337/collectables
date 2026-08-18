import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocaleBody,
  assertMatchesInEveryNonBaseLocaleBody,
} from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

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

describe("app/collection/[id].tsx — drag-mode sort gate (corruption fix)", () => {
  const src = read("app/collection/[id].tsx");

  it("isDragBranch carries the itemFilters.sort === \"default\" gate", () => {
    // Without this gate, the user could enter alphabetical sort, drag a
    // row, and onDragEnd would re-write `sortOrder` based on the
    // alphabetical order — destroying their manual ordering. The condition
    // now lives in the named `isDragBranch` flag (owners default to the card
    // grid; reorder mode is the opt-in that reaches the draggable list), so
    // both halves are pinned: the derivation and the branch it drives.
    assert.match(
      src,
      /const\s+isDragBranch\s*=\s*isOwner\s*&&\s*!selectionMode\s*&&\s*reorderMode\s*&&\s*itemFilters\.sort\s*===\s*"default";/,
    );
    assert.match(
      src,
      /\)\s*:\s*isDragBranch\s*\?\s*\(\s*\n\s*\/\/[^\n]*\n[\s\S]*?<NestableDraggableFlatList/,
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
    const sortIdx = src.search(/applySortMode\(filteredItems\s*,\s*itemFilters\.sort\s*,\s*sortLocale\)/);
    const chunkIdx = src.search(/useChunkedList\(\s*items\s*\)/);
    assert.ok(filterIdx > 0, "applyItemFilters call missing");
    assert.ok(sortIdx > 0, "applySortMode call missing");
    assert.ok(chunkIdx > 0, "useChunkedList call missing");
    assert.ok(
      filterIdx < sortIdx && sortIdx < chunkIdx,
      `expected order applyItemFilters → applySortMode → useChunkedList, got ${filterIdx}/${sortIdx}/${chunkIdx}`,
    );
  });

  it("sort memo deps are [filteredItems, itemFilters.sort, sortLocale] — not [filteredItems, itemFilters]", () => {
    // Depending on the full `itemFilters` object would re-sort on every
    // priceFrom keystroke even though the sort mode hasn't changed.
    // `sortLocale` joined the list on 2026-08-07 (collator now follows the
    // pinned app language) and MUST be a dep: without it, switching language
    // leaves the list collated under the previous locale's rules.
    assert.match(
      src,
      /applySortMode\(filteredItems\s*,\s*itemFilters\.sort\s*,\s*sortLocale\)[\s\S]*?\[\s*filteredItems\s*,\s*itemFilters\.sort\s*,\s*sortLocale\s*\]/,
    );
  });
});

describe("components/item-filters.tsx — sort chip UI", () => {
  const src = read("components/item-filters.tsx");

  it("renders the sort label using t(\"sortLabel\")", () => {
    assert.match(src, /\{\s*t\(\s*"sortLabel"\s*\)\s*\}/);
  });

  it("renders the sort chips from SORT_OPTIONS with role + selected state", () => {
    // The mode table moved to `lib/item-filters.ts` as SORT_OPTIONS on
    // 2026-08-07 (see sort-options-parity.test.ts, which pins the three
    // literals and their union coverage against the real export). What this
    // screen-level pin still owns: the chips are rendered FROM that table, so
    // a future refactor can't silently drop the picker or hand-roll a
    // divergent copy, and each chip carries its a11y role + selected state.
    assert.match(src, /\{SORT_OPTIONS\.map\(\(opt\) => \{/);
    assert.match(src, /SORT_OPTIONS,[\s\S]*?\} from "@\/lib\/item-filters";/);
    assert.match(src, /accessibilityRole=\{?\s*"button"\s*\}?/);
    assert.match(src, /accessibilityState=\{\{ selected: active \}\}/);
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
    assert.match(src, /sortChip:\s*\{[\s\S]*?borderRadius:\s*RADIUS_PILL/);
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
  const src = readI18nSource();

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
    // Per body — the slice this replaces crossed `};`, so a key present in any
    // later map satisfied every earlier locale.
    for (const key of ["sortLabel", "sortDefault", "sortNameAsc", "sortNameDesc"]) {
      assertMatchesInEveryNonBaseLocaleBody(
        src,
        new RegExp(`\\b${key}:\\s*"[^"]+"`),
        `${key} is overridden`,
      );
    }
  });

  it("declares each key in every locale, as a non-empty string", () => {
    for (const key of ["sortLabel", "sortDefault", "sortNameAsc", "sortNameDesc"]) {
      assertDeclaredInEveryLocale(src, key);
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`\\b${key}:\\s*"[^"]+"`),
        `${key} is a non-empty string`,
      );
    }
  });
});
