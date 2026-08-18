/**
 * Pins the `SORT_OPTIONS` picker table (promoted out of `<ItemFilterBar>`'s
 * JSX into `lib/item-filters.ts` on 2026-08-07) and the sort chips' selected
 * state.
 *
 * Two `.tasks/.tasks.md` items land here:
 *
 *  - The 3-entry option array was built inline inside the sheet's JSX, so any
 *    second surface wanting the same picker (a global "sort all collections"
 *    sheet) would re-implement it and drift. It now lives beside
 *    `ItemSortMode` in the pure lib module, carrying an i18n KEY rather than a
 *    translated label so the module stays node-importable.
 *
 *  - Each chip only carried `accessibilityRole="button"`, so VoiceOver
 *    announced all three identically and the active sort was conveyed by
 *    colour alone. `accessibilityState={{ selected: active }}` is the standard
 *    React Native fix.
 *
 * `lib/item-filters.ts` is React-Native-free and IS imported here; the
 * component pulls `@expo/vector-icons` + StyleSheet and is asserted
 * structurally.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  applySortMode,
  EMPTY_FILTERS,
  SORT_OPTIONS,
  type ItemSortMode,
} from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocaleBody,
} from "./helpers/i18n-locales";

function readComponentSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "item-filters.tsx"), "utf8");
}

function item(id: string, title: string): CollectableItem {
  return { id, title } as CollectableItem;
}

describe("SORT_OPTIONS table", () => {
  it("lists every mode in display order, default first, grouped by axis", () => {
    assert.deepEqual(
      SORT_OPTIONS.map((o) => o.mode),
      [
        "default",
        "name-asc",
        "name-desc",
        "cost-asc",
        "cost-desc",
        "acquired-desc",
        "acquired-asc",
      ],
    );
  });

  it("covers every member of the ItemSortMode union", () => {
    // A mode added to the union without a row here would be unreachable from
    // the UI. The exhaustive switch makes the compiler complain first; this
    // asserts the runtime table caught up too.
    const allModes: ItemSortMode[] = [
      "default",
      "name-asc",
      "name-desc",
      "cost-asc",
      "cost-desc",
      "acquired-asc",
      "acquired-desc",
    ];
    for (const mode of allModes) {
      assert.ok(
        SORT_OPTIONS.some((o) => o.mode === mode),
        `SORT_OPTIONS is missing the ${mode} row`,
      );
    }
    assert.equal(SORT_OPTIONS.length, allModes.length);
  });

  it("has no duplicate modes or label keys", () => {
    assert.equal(new Set(SORT_OPTIONS.map((o) => o.mode)).size, SORT_OPTIONS.length);
    assert.equal(new Set(SORT_OPTIONS.map((o) => o.labelKey)).size, SORT_OPTIONS.length);
  });

  it("carries i18n keys, not translated labels", () => {
    // A translated label would drag `useI18n` into the pure module and freeze
    // the copy at import time in whatever language loaded first.
    for (const opt of SORT_OPTIONS) {
      assert.match(opt.labelKey, /^sort[A-Z]/, `${opt.labelKey} does not look like an i18n key`);
    }
  });

  it("declares every label key in all six locales", () => {
    const src = readI18nSource();
    for (const opt of SORT_OPTIONS) {
      assertDeclaredInEveryLocale(src, opt.labelKey);
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`\\b${opt.labelKey}: "[^"]+",`),
        `${opt.labelKey} is a non-empty string`,
      );
    }
  });

  it("starts the filter state on the option the table lists first", () => {
    assert.equal(EMPTY_FILTERS.sort, SORT_OPTIONS[0].mode);
  });

  it("every listed mode is one applySortMode actually handles", () => {
    // `b` is the pricier, more recently acquired item; `a` the cheaper, older
    // one — so every axis produces a different, checkable permutation.
    const items = [
      { ...item("b", "Beta"), cost: 90, acquiredAt: "2025-01-01" } as CollectableItem,
      { ...item("a", "Alpha"), cost: 10, acquiredAt: "2024-01-01" } as CollectableItem,
    ];
    const byMode = new Map(
      SORT_OPTIONS.map((o) => [o.mode, applySortMode(items, o.mode).map((i) => i.id).join(",")]),
    );
    assert.equal(byMode.get("default"), "b,a", "default must preserve the incoming order");
    assert.equal(byMode.get("name-asc"), "a,b");
    assert.equal(byMode.get("name-desc"), "b,a");
    assert.equal(byMode.get("cost-asc"), "a,b");
    assert.equal(byMode.get("cost-desc"), "b,a");
    assert.equal(byMode.get("acquired-asc"), "a,b");
    assert.equal(byMode.get("acquired-desc"), "b,a");
  });
});

describe("<ItemFilterBar> sort chips", () => {
  it("renders the picker from SORT_OPTIONS instead of an inline array", () => {
    const src = readComponentSrc();
    assert.match(src, /\{SORT_OPTIONS\.map\(\(opt\) => \{/);
    assert.doesNotMatch(
      src,
      /\{ mode: "default" as ItemSortMode/,
      "the inline option array must not come back",
    );
  });

  it("imports SORT_OPTIONS from the pure lib module and re-exports it", () => {
    const src = readComponentSrc();
    assert.match(src, /import \{[\s\S]*?\bSORT_OPTIONS,[\s\S]*?\} from "@\/lib\/item-filters";/);
    // The component is the historical import path for these helpers; callers
    // that reach for the picker table there should find it.
    assert.match(src, /export \{[^}]*\bSORT_OPTIONS\b[^}]*\};/);
  });

  it("translates the label at render time via the row's key", () => {
    assert.match(readComponentSrc(), /\{t\(opt\.labelKey\)\}/);
  });

  it("marks the active chip selected for screen readers", () => {
    const src = readComponentSrc();
    assert.match(src, /accessibilityState=\{\{ selected: active \}\}/);
    // The selected state must ride on the same Pressable that carries the
    // button role, not on the label Text.
    const chip = src.match(/<Pressable\n\s*key=\{opt\.mode\}[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    assert.ok(chip.length > 0, "expected to extract the sort chip Pressable");
    assert.match(chip, /accessibilityRole="button"/);
    assert.match(chip, /accessibilityState=\{\{ selected: active \}\}/);
  });

  it("derives `active` from the draft, so the sheet reflects unapplied edits", () => {
    assert.match(readComponentSrc(), /const active = draft\.sort === opt\.mode;/);
  });
});
