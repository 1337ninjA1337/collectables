import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ACCENT_DEEP,
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_MUTED,
  AMBER_MUTED_2,
  AMBER_MUTED_3,
  AMBER_MUTED_4,
  AMBER_MUTED_5,
  AMBER_SOFT_2,
  AMBER_SOFT_3,
  BORDER,
  BORDER_2,
  BORDER_3,
  BORDER_4,
  BORDER_5,
  BORDER_6,
  CARD_BG,
  CARD_BG_4,
  CARD_BG_5,
  CARD_BG_6,
  CARD_BG_7,
  CARD_BG_8,
  CARD_BG_9,
  CARD_BG_10,
  CARD_BG_11,
  COOL_GRAY,
  DANGER,
  DANGER_DEEP,
  DANGER_DEEP_2,
  DANGER_DEEP_3,
  DANGER_DEEP_4,
  DANGER_DEEP_5,
  DANGER_MEDIUM,
  DANGER_SOFT,
  DANGER_SOFT_2,
  DANGER_SOFT_3,
  designTokens,
  HERO_DARK,
  HERO_DARK_4,
  HERO_DARK_5,
  HERO_DARK_6,
  HERO_DARK_7,
  MUTED,
  MUTED_3,
  MUTED_4,
  MUTED_5,
  MUTED_6,
  MUTED_7,
  MUTED_8,
  MUTED_9,
  MUTED_10,
  MUTED_11,
  MUTED_12,
  MUTED_13,
  MUTED_14,
  MUTED_15,
  MUTED_16,
  MUTED_17,
  MUTED_18,
  MUTED_19,
  MUTED_20,
  MUTED_21,
  PAGE_BG,
  PAGE_BG_2,
  PURE_WHITE,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  SUCCESS_GREEN,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_DARK_4,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
  TEXT_ON_DARK_6,
  TEXT_ON_DARK_MUTED,
} from "@/lib/design-tokens";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("design-tokens module", () => {
  it("exposes the documented brand palette as 6-digit hex strings", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(HERO_DARK, hex);
    assert.match(AMBER_ACCENT, hex);
    assert.match(AMBER_LIGHT, hex);
    assert.match(CARD_BG, hex);
    assert.match(BORDER, hex);
    assert.match(TEXT_DARK, hex);
    assert.match(TEXT_ON_DARK, hex);
    assert.match(MUTED, hex);
    assert.match(PAGE_BG, hex);
    assert.match(DANGER, hex);
    assert.match(SUCCESS_GREEN, hex);
  });

  it("matches the hex values that previously lived inline across the codebase", () => {
    // These are the four anchor names the original task called out.
    assert.equal(HERO_DARK, "#261b14");
    assert.equal(AMBER_ACCENT, "#d89c5b");
    assert.equal(CARD_BG, "#fffaf3");
    assert.equal(BORDER, "#eadbc8");
  });

  it("exposes the additional cream / muted-brown variants shipped for the bottom-nav migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(TEXT_ON_DARK_2, hex);
    assert.match(MUTED_3, hex);
    assert.equal(TEXT_ON_DARK_2, "#fff5ea");
    assert.equal(MUTED_3, "#5f4734");
    // Frozen palette includes both new keys.
    assert.equal(designTokens.TEXT_ON_DARK_2, "#fff5ea");
    assert.equal(designTokens.MUTED_3, "#5f4734");
  });

  it("exposes the MUTED_4 inactive-nav-icon variant shipped for the nav-tab migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_4, hex);
    assert.equal(MUTED_4, "#bbb0a6");
    assert.equal(designTokens.MUTED_4, "#bbb0a6");
  });

  it("exposes the AMBER_MUTED + TEXT_ON_DARK_3 variants shipped for the chats migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_MUTED, hex);
    assert.match(TEXT_ON_DARK_3, hex);
    assert.equal(AMBER_MUTED, "#d9c2a8");
    assert.equal(TEXT_ON_DARK_3, "#fff8ef");
    assert.equal(designTokens.AMBER_MUTED, "#d9c2a8");
    assert.equal(designTokens.TEXT_ON_DARK_3, "#fff8ef");
  });

  it("exposes the ACCENT_DEEP + PAGE_BG_2 + MUTED_9 + STATUS_ONLINE/OFFLINE variants shipped for the _layout migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(ACCENT_DEEP, hex);
    assert.match(PAGE_BG_2, hex);
    assert.match(MUTED_9, hex);
    assert.match(STATUS_ONLINE, hex);
    assert.match(STATUS_OFFLINE, hex);
    assert.equal(ACCENT_DEEP, "#8a5a2b");
    assert.equal(PAGE_BG_2, "#fffaf4");
    assert.equal(MUTED_9, "#6d5645");
    assert.equal(STATUS_ONLINE, "#22c55e");
    assert.equal(STATUS_OFFLINE, "#eab308");
    assert.equal(designTokens.ACCENT_DEEP, "#8a5a2b");
    assert.equal(designTokens.PAGE_BG_2, "#fffaf4");
    assert.equal(designTokens.MUTED_9, "#6d5645");
    assert.equal(designTokens.STATUS_ONLINE, "#22c55e");
    assert.equal(designTokens.STATUS_OFFLINE, "#eab308");
  });

  it("exposes the MUTED_8 variant shipped for the swipe-tabs migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_8, hex);
    assert.equal(MUTED_8, "#6b5543");
    assert.equal(designTokens.MUTED_8, "#6b5543");
  });

  it("exposes the HERO_DARK_4/5/6 + MUTED_6/7 + TEXT_ON_DARK_4 + PURE_WHITE + DANGER_DEEP variants shipped for the login-screen migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(HERO_DARK_4, hex);
    assert.match(HERO_DARK_5, hex);
    assert.match(HERO_DARK_6, hex);
    assert.match(MUTED_6, hex);
    assert.match(MUTED_7, hex);
    assert.match(TEXT_ON_DARK_4, hex);
    assert.match(PURE_WHITE, hex);
    assert.match(DANGER_DEEP, hex);
    assert.equal(HERO_DARK_4, "#3d2810");
    assert.equal(HERO_DARK_5, "#1e140e");
    assert.equal(HERO_DARK_6, "#2c2017");
    assert.equal(MUTED_6, "#6f5c4d");
    assert.equal(MUTED_7, "#856d5a");
    assert.equal(TEXT_ON_DARK_4, "#fff4e8");
    assert.equal(PURE_WHITE, "#ffffff");
    assert.equal(DANGER_DEEP, "#a13434");
    assert.equal(designTokens.HERO_DARK_4, "#3d2810");
    assert.equal(designTokens.HERO_DARK_5, "#1e140e");
    assert.equal(designTokens.HERO_DARK_6, "#2c2017");
    assert.equal(designTokens.MUTED_6, "#6f5c4d");
    assert.equal(designTokens.MUTED_7, "#856d5a");
    assert.equal(designTokens.TEXT_ON_DARK_4, "#fff4e8");
    assert.equal(designTokens.PURE_WHITE, "#ffffff");
    assert.equal(designTokens.DANGER_DEEP, "#a13434");
  });

  it("exposes the TEXT_DARK_3 + MUTED_5 + TEXT_ON_DARK_MUTED + BORDER_3 variants shipped for the stats migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(TEXT_DARK_3, hex);
    assert.match(MUTED_5, hex);
    assert.match(TEXT_ON_DARK_MUTED, hex);
    assert.match(BORDER_3, hex);
    assert.equal(TEXT_DARK_3, "#2d2117");
    assert.equal(MUTED_5, "#715d4d");
    assert.equal(TEXT_ON_DARK_MUTED, "#dfc8b2");
    assert.equal(BORDER_3, "#f0e4d0");
    assert.equal(designTokens.TEXT_DARK_3, "#2d2117");
    assert.equal(designTokens.MUTED_5, "#715d4d");
    assert.equal(designTokens.TEXT_ON_DARK_MUTED, "#dfc8b2");
    assert.equal(designTokens.BORDER_3, "#f0e4d0");
  });

  it("exposes the MUTED_10 sectionLabel variant shipped for the friends migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_10, hex);
    assert.equal(MUTED_10, "#624a35");
    assert.equal(designTokens.MUTED_10, "#624a35");
  });

  it("exposes the MUTED_15 clear-icon variant shipped for the search-overlay migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_15, hex);
    assert.equal(MUTED_15, "#b8a08a");
    assert.equal(designTokens.MUTED_15, "#b8a08a");
  });

  it("exposes the BORDER_4 + MUTED_16 disabled-button variants shipped for the people migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(BORDER_4, hex);
    assert.match(MUTED_16, hex);
    assert.equal(BORDER_4, "#e4d5c4");
    assert.equal(MUTED_16, "#a89480");
    assert.equal(designTokens.BORDER_4, "#e4d5c4");
    assert.equal(designTokens.MUTED_16, "#a89480");
  });

  it("exposes the AMBER_SOFT_3 + BORDER_5/6 + CARD_BG_11 + COOL_GRAY + DANGER_DEEP_5 + DANGER_MEDIUM + DANGER_SOFT_3 variants shipped for the settings migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_SOFT_3, hex);
    assert.match(BORDER_5, hex);
    assert.match(BORDER_6, hex);
    assert.match(CARD_BG_11, hex);
    assert.match(COOL_GRAY, hex);
    assert.match(DANGER_DEEP_5, hex);
    assert.match(DANGER_MEDIUM, hex);
    assert.match(DANGER_SOFT_3, hex);
    assert.equal(AMBER_SOFT_3, "#f0d6a1");
    assert.equal(BORDER_5, "#f1e3d0");
    assert.equal(BORDER_6, "#f5ead8");
    assert.equal(CARD_BG_11, "#fff5f5");
    assert.equal(COOL_GRAY, "#94a3b8");
    assert.equal(DANGER_DEEP_5, "#7a2020");
    assert.equal(DANGER_MEDIUM, "#8d4444");
    assert.equal(DANGER_SOFT_3, "#e8b4b4");
    assert.equal(designTokens.AMBER_SOFT_3, "#f0d6a1");
    assert.equal(designTokens.BORDER_5, "#f1e3d0");
    assert.equal(designTokens.BORDER_6, "#f5ead8");
    assert.equal(designTokens.CARD_BG_11, "#fff5f5");
    assert.equal(designTokens.COOL_GRAY, "#94a3b8");
    assert.equal(designTokens.DANGER_DEEP_5, "#7a2020");
    assert.equal(designTokens.DANGER_MEDIUM, "#8d4444");
    assert.equal(designTokens.DANGER_SOFT_3, "#e8b4b4");
  });

  it("exposes the CARD_BG_10 + DANGER_DEEP_4 + DANGER_SOFT_2 variants shipped for the item-filters migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(CARD_BG_10, hex);
    assert.match(DANGER_DEEP_4, hex);
    assert.match(DANGER_SOFT_2, hex);
    assert.equal(CARD_BG_10, "#fff3f3");
    assert.equal(DANGER_DEEP_4, "#8d2b2b");
    assert.equal(DANGER_SOFT_2, "#d9a0a0");
    assert.equal(designTokens.CARD_BG_10, "#fff3f3");
    assert.equal(designTokens.DANGER_DEEP_4, "#8d2b2b");
    assert.equal(designTokens.DANGER_SOFT_2, "#d9a0a0");
  });

  it("exposes the CARD_BG_7/8/9 + MUTED_20/21 + DANGER_DEEP_3 + DANGER_SOFT variants shipped for the wishlist migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(CARD_BG_7, hex);
    assert.match(CARD_BG_8, hex);
    assert.match(CARD_BG_9, hex);
    assert.match(MUTED_20, hex);
    assert.match(MUTED_21, hex);
    assert.match(DANGER_DEEP_3, hex);
    assert.match(DANGER_SOFT, hex);
    assert.equal(CARD_BG_7, "#f4ecdf");
    assert.equal(CARD_BG_8, "#fdf0eb");
    assert.equal(CARD_BG_9, "#fff4e5");
    assert.equal(MUTED_20, "#735f50");
    assert.equal(MUTED_21, "#b59a80");
    assert.equal(DANGER_DEEP_3, "#a5402d");
    assert.equal(DANGER_SOFT, "#e0bcb3");
    assert.equal(designTokens.CARD_BG_7, "#f4ecdf");
    assert.equal(designTokens.CARD_BG_8, "#fdf0eb");
    assert.equal(designTokens.CARD_BG_9, "#fff4e5");
    assert.equal(designTokens.MUTED_20, "#735f50");
    assert.equal(designTokens.MUTED_21, "#b59a80");
    assert.equal(designTokens.DANGER_DEEP_3, "#a5402d");
    assert.equal(designTokens.DANGER_SOFT, "#e0bcb3");
  });

  it("exposes the AMBER_MUTED_5 + MUTED_18/19 + DANGER_DEEP_2 variants shipped for the profile-detail migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_MUTED_5, hex);
    assert.match(MUTED_18, hex);
    assert.match(MUTED_19, hex);
    assert.match(DANGER_DEEP_2, hex);
    assert.equal(AMBER_MUTED_5, "#d2b89a");
    assert.equal(MUTED_18, "#6e5541");
    assert.equal(MUTED_19, "#c7b19b");
    assert.equal(DANGER_DEEP_2, "#922a2a");
    assert.equal(designTokens.AMBER_MUTED_5, "#d2b89a");
    assert.equal(designTokens.MUTED_18, "#6e5541");
    assert.equal(designTokens.MUTED_19, "#c7b19b");
    assert.equal(designTokens.DANGER_DEEP_2, "#922a2a");
  });

  it("exposes the HERO_DARK_7 + AMBER_MUTED_3/4 + TEXT_ON_DARK_6 variants shipped for the listing-detail migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(HERO_DARK_7, hex);
    assert.match(AMBER_MUTED_3, hex);
    assert.match(AMBER_MUTED_4, hex);
    assert.match(TEXT_ON_DARK_6, hex);
    assert.equal(HERO_DARK_7, "#2a1e17");
    assert.equal(AMBER_MUTED_3, "#d8c7b1");
    assert.equal(AMBER_MUTED_4, "#ddc9af");
    assert.equal(TEXT_ON_DARK_6, "#fff7ed");
    assert.equal(designTokens.HERO_DARK_7, "#2a1e17");
    assert.equal(designTokens.AMBER_MUTED_3, "#d8c7b1");
    assert.equal(designTokens.AMBER_MUTED_4, "#ddc9af");
    assert.equal(designTokens.TEXT_ON_DARK_6, "#fff7ed");
  });

  it("exposes the AMBER_MUTED_2 + CARD_BG_5/6 + TEXT_DARK_4 + MUTED_17 variants shipped for the create-collection migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_MUTED_2, hex);
    assert.match(CARD_BG_5, hex);
    assert.match(CARD_BG_6, hex);
    assert.match(TEXT_DARK_4, hex);
    assert.match(MUTED_17, hex);
    assert.equal(AMBER_MUTED_2, "#dbc7ae");
    assert.equal(CARD_BG_5, "#efe1cf");
    assert.equal(CARD_BG_6, "#fff3e0");
    assert.equal(TEXT_DARK_4, "#2b2017");
    assert.equal(MUTED_17, "#7a6453");
    assert.equal(designTokens.AMBER_MUTED_2, "#dbc7ae");
    assert.equal(designTokens.CARD_BG_5, "#efe1cf");
    assert.equal(designTokens.CARD_BG_6, "#fff3e0");
    assert.equal(designTokens.TEXT_DARK_4, "#2b2017");
    assert.equal(designTokens.MUTED_17, "#7a6453");
  });

  it("exposes the AMBER_SOFT_2 + CARD_BG_4 + TEXT_ON_DARK_5 + MUTED_11/12/13/14 variants shipped for the chat-detail migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_SOFT_2, hex);
    assert.match(CARD_BG_4, hex);
    assert.match(TEXT_ON_DARK_5, hex);
    assert.match(MUTED_11, hex);
    assert.match(MUTED_12, hex);
    assert.match(MUTED_13, hex);
    assert.match(MUTED_14, hex);
    assert.equal(AMBER_SOFT_2, "#e0b87a");
    assert.equal(CARD_BG_4, "#fff0d6");
    assert.equal(TEXT_ON_DARK_5, "#fff7ea");
    assert.equal(MUTED_11, "#6f5a44");
    assert.equal(MUTED_12, "#7a4f1a");
    assert.equal(MUTED_13, "#8a6e54");
    assert.equal(MUTED_14, "#a08970");
    assert.equal(designTokens.AMBER_SOFT_2, "#e0b87a");
    assert.equal(designTokens.CARD_BG_4, "#fff0d6");
    assert.equal(designTokens.TEXT_ON_DARK_5, "#fff7ea");
    assert.equal(designTokens.MUTED_11, "#6f5a44");
    assert.equal(designTokens.MUTED_12, "#7a4f1a");
    assert.equal(designTokens.MUTED_13, "#8a6e54");
    assert.equal(designTokens.MUTED_14, "#a08970");
  });

  it("freezes the designTokens object so accidental mutation is rejected", () => {
    assert.equal(Object.isFrozen(designTokens), true);
    assert.throws(() => {
      // @ts-expect-error — runtime mutation should not be allowed.
      designTokens.HERO_DARK = "#000000";
    });
  });
});

describe("design-tokens adoption", () => {
  it("app/marketplace.tsx imports tokens from lib/design-tokens", () => {
    const src = read("app/marketplace.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK/);
    assert.match(src, /AMBER_ACCENT/);
  });

  it("components/bottom-nav.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // Every hex literal that previously lived inline now maps to a named token.
    assert.match(src, /HERO_DARK/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /BORDER/);
    assert.match(src, /CARD_BG_2/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /MUTED_3/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK_2/);
    // No raw 6-digit hex literals should remain in the migrated file.
    // (The semi-transparent backdrop is an rgba(), not a hex literal.)
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/nav-tab.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/nav-tab.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // Every hex literal that previously lived inline now maps to a named token.
    assert.match(src, /HERO_DARK/);
    assert.match(src, /MUTED_4/);
    assert.match(src, /DANGER/);
    assert.match(src, /TEXT_ON_DARK/);
    assert.match(src, /AMBER_ACCENT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/chats.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/chats.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK/);
    assert.match(src, /HERO_DARK_3/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    assert.match(src, /CARD_BG/);
    assert.match(src, /BORDER/);
    assert.match(src, /TEXT_DARK/);
    assert.match(src, /MUTED/);
    assert.match(src, /MUTED_2/);
    assert.match(src, /DANGER/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/_layout.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/_layout.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /ACCENT_DEEP/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /DANGER\b/);
    assert.match(src, /PAGE_BG_2/);
    assert.match(src, /MUTED_9/);
    assert.match(src, /STATUS_ONLINE/);
    assert.match(src, /STATUS_OFFLINE/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_4/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/swipe-tabs.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/swipe-tabs.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /DANGER\b/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /MUTED_3/);
    assert.match(src, /MUTED_8/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/login-screen.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/login-screen.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_4/);
    assert.match(src, /HERO_DARK_5/);
    assert.match(src, /HERO_DARK_6/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    assert.match(src, /MUTED_6/);
    assert.match(src, /MUTED_7/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /PURE_WHITE/);
    assert.match(src, /DANGER_DEEP/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/people.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/people.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_2/);
    assert.match(src, /BORDER_4/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2/);
    assert.match(src, /MUTED_3/);
    assert.match(src, /MUTED_8/);
    assert.match(src, /MUTED_10/);
    assert.match(src, /MUTED_16/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /PURE_WHITE/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/search-overlay.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/search-overlay.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_MUTED/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_3/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2/);
    assert.match(src, /MUTED_3/);
    assert.match(src, /MUTED_10/);
    assert.match(src, /MUTED_13/);
    assert.match(src, /MUTED_15/);
    assert.match(src, /PAGE_BG_2/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_5/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/chat/[id].tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/chat/[id].tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_3/);
    assert.match(src, /AMBER_MUTED/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /AMBER_SOFT_2/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /CARD_BG_4/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_5/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_11/);
    assert.match(src, /MUTED_12/);
    assert.match(src, /MUTED_13/);
    assert.match(src, /MUTED_14/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/friends.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/friends.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /HERO_DARK_3/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /DANGER\b/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2/);
    assert.match(src, /MUTED_10/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/settings.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/settings.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /AMBER_SOFT_3/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_5/);
    assert.match(src, /BORDER_6/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /CARD_BG_10/);
    assert.match(src, /CARD_BG_11/);
    assert.match(src, /COOL_GRAY/);
    assert.match(src, /DANGER_DEEP_2/);
    assert.match(src, /DANGER_DEEP_4/);
    assert.match(src, /DANGER_DEEP_5/);
    assert.match(src, /DANGER_MEDIUM/);
    assert.match(src, /DANGER_SOFT_2/);
    assert.match(src, /DANGER_SOFT_3/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /HERO_DARK_4/);
    assert.match(src, /HERO_DARK_5/);
    assert.match(src, /HERO_DARK_7/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_11/);
    assert.match(src, /STATUS_ONLINE/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/item-filters.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/item-filters.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /CARD_BG_10/);
    assert.match(src, /DANGER_DEEP_4/);
    assert.match(src, /DANGER_SOFT_2/);
    assert.match(src, /HERO_DARK/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_3\b/);
    assert.match(src, /MUTED_10/);
    assert.match(src, /MUTED_15/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /PURE_WHITE/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_3/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_5/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/wishlist.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/wishlist.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_MUTED_2/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_7/);
    assert.match(src, /CARD_BG_8/);
    assert.match(src, /CARD_BG_9/);
    assert.match(src, /DANGER_DEEP_3/);
    assert.match(src, /DANGER_SOFT/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_20/);
    assert.match(src, /MUTED_21/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK_5/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/profile/[id].tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/profile/[id].tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED_5/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_2/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /DANGER_DEEP_2/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_8\b/);
    assert.match(src, /MUTED_18/);
    assert.match(src, /MUTED_19/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /PURE_WHITE/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_3/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/listing/[id].tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED\b/);
    assert.match(src, /AMBER_MUTED_3/);
    assert.match(src, /AMBER_MUTED_4/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_2/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_3/);
    assert.match(src, /HERO_DARK_7/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_3/);
    assert.match(src, /SUCCESS_GREEN/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_2/);
    assert.match(src, /TEXT_ON_DARK_6/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/create-collection.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/create-collection.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_MUTED_2/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_5/);
    assert.match(src, /CARD_BG_6/);
    assert.match(src, /DANGER\b/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_8\b/);
    assert.match(src, /MUTED_10\b/);
    assert.match(src, /MUTED_17\b/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_DARK_4/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_2/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/stats.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/stats.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /CARD_BG/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_3/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_3/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_MUTED/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2/);
    assert.match(src, /MUTED_5/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });
});
