import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR4 (visual-upgrade `shared-components`): the nine shared components adopt
// useAppTheme() for colors, the new geometry/shadow tokens for radius/spacing,
// and FONT_DISPLAY_EDITORIAL for headline text. These are structural checks —
// they exercise the source text so they run under node --test without mounting
// React Native.

describe("visual-upgrade PR4 — shared-components adopt the theme hook", () => {
  const themedComponents = [
    "components/screen.tsx",
    "components/item-card.tsx",
    "components/empty-state.tsx",
    "components/bottom-nav.tsx",
    "components/nav-tab.tsx",
    "components/swipe-tabs.tsx",
    "components/visibility-badge.tsx",
    "components/currency-input.tsx",
  ];

  for (const file of themedComponents) {
    it(`${file} consumes useAppTheme()`, () => {
      const src = read(file);
      assert.match(src, /from\s+"@\/components\/use-app-theme"/);
      assert.match(src, /useAppTheme\(\)/);
    });
  }

  it("screen.tsx drops the LinearGradient page wrapper for a flat theme.page surface", () => {
    const src = read("components/screen.tsx");
    assert.doesNotMatch(src, /LinearGradient/);
    assert.match(src, /backgroundColor:\s*theme\.page/);
    assert.match(src, /padding:\s*SPACING_GUTTER/);
    assert.match(src, /gap:\s*SPACING_AIRY/);
  });

  it("collection-card.tsx uses a LinearGradient overlay + airy radius + editorial title", () => {
    const src = read("components/collection-card.tsx");
    assert.match(src, /LinearGradient/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("item-card.tsx uses RADIUS_ITEM_AIRY, SHADOW_SOFT and the editorial title font", () => {
    const src = read("components/item-card.tsx");
    assert.match(src, /borderRadius:\s*RADIUS_ITEM_AIRY/);
    assert.match(src, /SHADOW_SOFT/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("empty-state.tsx bumps the dashed container to RADIUS_CARD_AIRY + editorial title", () => {
    const src = read("components/empty-state.tsx");
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("bottom-nav.tsx swaps the plus button to AMBER_ACCENT in dark mode", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(src, /theme\.isDark\s*\?\s*AMBER_ACCENT\s*:\s*HERO_DARK/);
    assert.match(src, /backgroundColor:\s*theme\.navBg/);
  });

  it("the migrated components carry no inline 6-digit hex literals", () => {
    for (const file of [...themedComponents, "components/collection-card.tsx"]) {
      const src = read(file);
      const hex = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
      assert.deepEqual(hex, [], `${file} has inline hex: ${hex.join(", ")}`);
    }
  });
});
