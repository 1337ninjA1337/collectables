import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/**
 * visual-upgrade PR4 (`shared-components`): the nine shared components adopt
 * useAppTheme() for colors + the new airy geometry / soft-shadow tokens, while
 * keeping the no-inline-hex invariant. These are structural assertions in the
 * shape of __tests__/check-inline-hex.test.ts — they read source text rather
 * than mounting React, so they run under `node --test` without a renderer.
 */
describe("visual-upgrade PR4 — shared components adopt useAppTheme", () => {
  const files = [
    "components/screen.tsx",
    "components/collection-card.tsx",
    "components/item-card.tsx",
    "components/empty-state.tsx",
    "components/bottom-nav.tsx",
    "components/nav-tab.tsx",
    "components/swipe-tabs.tsx",
    "components/visibility-badge.tsx",
    "components/currency-input.tsx",
  ];

  // empty-state + collection-card are intentionally theme-light per the PR4
  // brief (they sit on photo/card surfaces), so they keep static colors.
  const themeConsumers = files.filter(
    (f) => f !== "components/empty-state.tsx" && f !== "components/collection-card.tsx",
  );

  for (const file of themeConsumers) {
    it(`${file} consumes useAppTheme()`, () => {
      const src = read(file);
      assert.match(src, /from\s+"@\/components\/use-app-theme"/);
      assert.match(src, /useAppTheme\(\)/);
    });
  }

  for (const file of files) {
    it(`${file} has no 6-digit inline hex literals`, () => {
      const src = read(file);
      const hex = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
      assert.deepEqual(hex, [], `unexpected inline hex literals remain: ${hex.join(", ")}`);
    });
  }

  it("collection-card adopts the airy card radius + editorial title", () => {
    const src = read("components/collection-card.tsx");
    assert.match(src, /\bRADIUS_CARD_AIRY\b/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("item-card adopts airy item radius, soft shadow + editorial title", () => {
    const src = read("components/item-card.tsx");
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("empty-state adopts the airy card radius + editorial title", () => {
    const src = read("components/empty-state.tsx");
    assert.match(src, /\bRADIUS_CARD_AIRY\b/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("screen applies the gutter + airy spacing tokens", () => {
    const src = read("components/screen.tsx");
    assert.match(src, /\bSPACING_GUTTER\b/);
    assert.match(src, /\bSPACING_AIRY\b/);
  });

  it("bottom-nav swaps the plus button to AMBER_ACCENT in dark mode", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(src, /theme\.isDark\s*\?\s*AMBER_ACCENT\s*:\s*HERO_DARK/);
  });
});
