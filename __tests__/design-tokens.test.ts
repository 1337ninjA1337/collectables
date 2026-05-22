import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ACCENT_DEEP,
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_MUTED,
  AMBER_SOFT_2,
  BORDER,
  BORDER_3,
  CARD_BG,
  CARD_BG_4,
  DANGER,
  DANGER_DEEP,
  designTokens,
  HERO_DARK,
  HERO_DARK_4,
  HERO_DARK_5,
  HERO_DARK_6,
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
  PAGE_BG,
  PAGE_BG_2,
  PURE_WHITE,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  SUCCESS_GREEN,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
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
