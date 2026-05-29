import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR4 `shared-components` — each component adopts useAppTheme() for colors and
// the new geometry/shadow/editorial-font tokens, keeping all behavior. These
// are structural assertions (no React mount) mirroring the use-app-theme test.

describe("PR4 shared-components: useAppTheme adoption", () => {
  const files = [
    "components/screen.tsx",
    "components/item-card.tsx",
    "components/bottom-nav.tsx",
    "components/nav-tab.tsx",
    "components/swipe-tabs.tsx",
    "components/visibility-badge.tsx",
    "components/currency-input.tsx",
  ];

  for (const f of files) {
    it(`${f} imports and calls useAppTheme()`, () => {
      const src = read(f);
      assert.match(src, /from\s+"@\/components\/use-app-theme"/, `${f} should import the theme hook`);
      assert.match(src, /useAppTheme\(\)/, `${f} should call useAppTheme()`);
    });
  }
});

describe("PR4 shared-components: screen.tsx flat page surface", () => {
  const src = read("components/screen.tsx");

  it("drops the LinearGradient in favor of theme.page", () => {
    assert.doesNotMatch(src, /LinearGradient/);
    assert.match(src, /backgroundColor:\s*theme\.page/);
  });

  it("uses the new gutter/airy spacing tokens", () => {
    assert.match(src, /padding:\s*SPACING_GUTTER/);
    assert.match(src, /gap:\s*SPACING_AIRY/);
  });
});

describe("PR4 shared-components: card geometry + editorial fonts", () => {
  it("collection-card uses RADIUS_CARD_AIRY, gradient overlay, and editorial title", () => {
    const src = read("components/collection-card.tsx");
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY/);
    assert.match(src, /LinearGradient/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // Flat 0.36 overlay wash is gone.
    assert.doesNotMatch(src, /rgba\(34,\s*24,\s*17,\s*0\.36\)/);
  });

  it("item-card uses RADIUS_ITEM_AIRY, RADIUS_AVATAR photo, SHADOW_SOFT, editorial title", () => {
    const src = read("components/item-card.tsx");
    assert.match(src, /borderRadius:\s*RADIUS_ITEM_AIRY/);
    assert.match(src, /borderRadius:\s*RADIUS_AVATAR\b/);
    assert.match(src, /SHADOW_SOFT/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    assert.match(src, /lineHeight:\s*22/);
  });

  it("empty-state uses RADIUS_CARD_AIRY and editorial title", () => {
    const src = read("components/empty-state.tsx");
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });
});

describe("PR4 shared-components: bottom-nav theme-aware plus button", () => {
  const src = read("components/bottom-nav.tsx");

  it("nav surface uses theme.navBg / theme.border", () => {
    assert.match(src, /backgroundColor:\s*theme\.navBg/);
    assert.match(src, /borderTopColor:\s*theme\.border/);
  });

  it("plus button swaps HERO_DARK (light) for AMBER_ACCENT (dark)", () => {
    assert.match(src, /theme\.isDark\s*\?\s*AMBER_ACCENT\s*:\s*HERO_DARK/);
  });
});

describe("PR4 shared-components: nav-tab + swipe-tabs theme colors", () => {
  it("nav-tab icon color reads navIconActive/navIconInactive", () => {
    const src = read("components/nav-tab.tsx");
    assert.match(src, /theme\.navIconActive/);
    assert.match(src, /theme\.navIconInactive/);
  });

  it("swipe-tabs active pill uses theme.text over theme.cardElevated underlay", () => {
    const src = read("components/swipe-tabs.tsx");
    assert.match(src, /theme\.cardElevated/);
    assert.match(src, /theme\.text/);
    assert.match(src, /theme\.muted/);
  });
});

describe("PR4 shared-components: currency-input field theming", () => {
  const src = read("components/currency-input.tsx");

  it("input field uses theme.card / theme.border / theme.text", () => {
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text/);
  });

  it("no longer hard-codes PURE_WHITE for the input background", () => {
    assert.doesNotMatch(src, /backgroundColor:\s*PURE_WHITE/);
  });
});
