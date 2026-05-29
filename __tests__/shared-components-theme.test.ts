import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Structural coverage for the visual-upgrade PR4 (`shared-components`):
// each shared component should adopt the new geometry/shadow tokens, the
// editorial display font, and/or the `useAppTheme()` hook — while keeping
// every file free of inline 6-digit hex literals (same rule as lint:hex).

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, "components", rel), "utf8");
const HEX = /#[0-9a-fA-F]{6}\b/;

describe("visual-upgrade PR4 — shared-components adoption", () => {
  it("screen.tsx uses a flat theme.page surface + spacing tokens (no gradient)", () => {
    const src = read("screen.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /theme\.page/);
    assert.match(src, /\bSPACING_GUTTER\b/);
    assert.match(src, /\bSPACING_AIRY\b/);
    assert.doesNotMatch(src, /LinearGradient/);
    assert.doesNotMatch(src, HEX);
  });

  it("collection-card.tsx softens radius, swaps to the editorial font + gradient overlay", () => {
    const src = read("collection-card.tsx");
    assert.match(src, /\bRADIUS_CARD_AIRY\b/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    assert.match(src, /LinearGradient/);
    assert.doesNotMatch(src, /FONT_DISPLAY\b(?!_EDITORIAL)/);
    assert.doesNotMatch(src, HEX);
  });

  it("item-card.tsx adopts the theme hook, soft shadow + airy radius", () => {
    const src = read("item-card.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    assert.match(src, /theme\.card/);
    assert.doesNotMatch(src, HEX);
  });

  it("empty-state.tsx softens the dashed container + uses the editorial font", () => {
    const src = read("empty-state.tsx");
    assert.match(src, /\bRADIUS_CARD_AIRY\b/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    assert.doesNotMatch(src, HEX);
  });

  it("bottom-nav.tsx themes the bar + plus button", () => {
    const src = read("bottom-nav.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /theme\.navBg/);
    assert.match(src, /theme\.isDark/);
    assert.doesNotMatch(src, HEX);
  });

  it("nav-tab.tsx drives icon color from the theme hook", () => {
    const src = read("nav-tab.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /navIconActive/);
    assert.match(src, /navIconInactive/);
    assert.doesNotMatch(src, HEX);
  });

  it("swipe-tabs.tsx themes the tab pills", () => {
    const src = read("swipe-tabs.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /theme\.cardElevated/);
    assert.doesNotMatch(src, HEX);
  });

  it("visibility-badge.tsx makes the neutral text/icon theme-aware", () => {
    const src = read("visibility-badge.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /theme\.text/);
    assert.doesNotMatch(src, HEX);
  });

  it("currency-input.tsx themes the input surface + text", () => {
    const src = read("currency-input.tsx");
    assert.match(src, /useAppTheme/);
    assert.match(src, /theme\.card/);
    assert.match(src, /theme\.text/);
    assert.doesNotMatch(src, HEX);
  });
});
