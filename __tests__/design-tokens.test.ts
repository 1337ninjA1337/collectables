import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ACCENT_DEEP,
  ACCENT_DEEP_2,
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_LIGHT_2,
  AMBER_MUTED,
  AMBER_MUTED_2,
  AMBER_MUTED_3,
  AMBER_MUTED_4,
  AMBER_MUTED_5,
  AMBER_MUTED_6,
  AMBER_MUTED_7,
  AMBER_MUTED_8,
  AMBER_SOFT_2,
  AMBER_SOFT_3,
  AMBER_SOFT_4,
  AMBER_SOFT_5,
  BORDER,
  BORDER_2,
  BORDER_3,
  BORDER_4,
  BORDER_5,
  BORDER_6,
  BORDER_7,
  CARD_BG,
  CARD_BG_4,
  CARD_BG_5,
  CARD_BG_6,
  CARD_BG_7,
  CARD_BG_8,
  CARD_BG_9,
  CARD_BG_10,
  CARD_BG_11,
  CARD_BG_12,
  CARD_BG_13,
  CARD_BG_14,
  COOL_GRAY,
  DANGER,
  DANGER_DEEP,
  DANGER_DEEP_2,
  DANGER_DEEP_3,
  DANGER_DEEP_4,
  DANGER_DEEP_5,
  DANGER_DEEP_6,
  DANGER_MEDIUM,
  DANGER_SOFT,
  DANGER_SOFT_2,
  DANGER_SOFT_3,
  DANGER_SOFT_4,
  DANGER_SOFT_5,
  designTokens,
  HERO_DARK,
  HERO_DARK_4,
  HERO_DARK_5,
  HERO_DARK_6,
  HERO_DARK_7,
  HERO_DARK_8,
  HERO_DARK_9,
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
  MUTED_22,
  MUTED_23,
  MUTED_24,
  MUTED_25,
  MUTED_26,
  MUTED_27,
  MUTED_28,
  MUTED_29,
  PAGE_BG,
  PAGE_BG_2,
  PAGE_BG_3,
  PURE_WHITE,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  SUCCESS_GREEN,
  SUCCESS_GREEN_2,
  TAG_BLUE,
  TAG_BROWN,
  TAG_CYAN,
  TAG_GOLD,
  TAG_PURPLE,
  TAG_RUST,
  TAG_SAGE,
  TAG_TEAL,
  TAG_TERRACOTTA,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_DARK_4,
  TEXT_DARK_5,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
  TEXT_ON_DARK_6,
  TEXT_ON_DARK_7,
  TEXT_ON_DARK_8,
  TEXT_ON_DARK_9,
  TEXT_ON_DARK_10,
  TEXT_ON_DARK_11,
  TEXT_ON_DARK_12,
  TEXT_ON_DARK_13,
  TEXT_ON_DARK_MUTED,
  RADIUS_PILL,
  RADIUS_CARD,
  RADIUS_CARD_LG,
  RADIUS_CARD_SM,
  RADIUS_INPUT,
  RADIUS_AVATAR_LG,
  RADIUS_AVATAR,
  SPACING_MICRO,
  SPACING_TIGHT,
  SPACING_INLINE,
  SPACING_LIST,
  SPACING_CARD,
  SPACING_SECTION,
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

  it("exposes the TEXT_ON_DARK_7/8 variants shipped for the home-screen migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(TEXT_ON_DARK_7, hex);
    assert.match(TEXT_ON_DARK_8, hex);
    assert.equal(TEXT_ON_DARK_7, "#f8e7d1");
    assert.equal(TEXT_ON_DARK_8, "#fff3e4");
    assert.equal(designTokens.TEXT_ON_DARK_7, "#f8e7d1");
    assert.equal(designTokens.TEXT_ON_DARK_8, "#fff3e4");
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

  it("exposes the AMBER_MUTED_6 + TAG_* categorical palette shipped for the create-item migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_MUTED_6, hex);
    assert.match(TAG_RUST, hex);
    assert.match(TAG_SAGE, hex);
    assert.match(TAG_BLUE, hex);
    assert.match(TAG_PURPLE, hex);
    assert.match(TAG_TERRACOTTA, hex);
    assert.match(TAG_CYAN, hex);
    assert.match(TAG_GOLD, hex);
    assert.match(TAG_BROWN, hex);
    assert.match(TAG_TEAL, hex);
    assert.equal(AMBER_MUTED_6, "#d9c8b4");
    assert.equal(TAG_RUST, "#c47a5a");
    assert.equal(TAG_SAGE, "#7a9e7e");
    assert.equal(TAG_BLUE, "#5b8fd8");
    assert.equal(TAG_PURPLE, "#9b7ec8");
    assert.equal(TAG_TERRACOTTA, "#d4765b");
    assert.equal(TAG_CYAN, "#5bbbd8");
    assert.equal(TAG_GOLD, "#c4a35b");
    assert.equal(TAG_BROWN, "#8b6b5b");
    assert.equal(TAG_TEAL, "#6b8f8f");
    assert.equal(designTokens.AMBER_MUTED_6, "#d9c8b4");
    assert.equal(designTokens.TAG_RUST, "#c47a5a");
    assert.equal(designTokens.TAG_SAGE, "#7a9e7e");
    assert.equal(designTokens.TAG_BLUE, "#5b8fd8");
    assert.equal(designTokens.TAG_PURPLE, "#9b7ec8");
    assert.equal(designTokens.TAG_TERRACOTTA, "#d4765b");
    assert.equal(designTokens.TAG_CYAN, "#5bbbd8");
    assert.equal(designTokens.TAG_GOLD, "#c4a35b");
    assert.equal(designTokens.TAG_BROWN, "#8b6b5b");
    assert.equal(designTokens.TAG_TEAL, "#6b8f8f");
    const tagValues = [
      TAG_RUST, TAG_SAGE, TAG_BLUE, TAG_PURPLE, TAG_TERRACOTTA,
      TAG_CYAN, TAG_GOLD, TAG_BROWN, TAG_TEAL,
    ];
    assert.equal(new Set(tagValues).size, tagValues.length, "TAG_* palette must be a set of distinct hues");
  });

  it("exposes the AMBER_MUTED_7 + CARD_BG_12 + DANGER_DEEP_6 + DANGER_SOFT_4 + SUCCESS_GREEN_2 variants shipped for the item-detail migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_MUTED_7, hex);
    assert.match(CARD_BG_12, hex);
    assert.match(DANGER_DEEP_6, hex);
    assert.match(DANGER_SOFT_4, hex);
    assert.match(SUCCESS_GREEN_2, hex);
    assert.equal(AMBER_MUTED_7, "#c4a87a");
    assert.equal(CARD_BG_12, "#fff1f1");
    assert.equal(DANGER_DEEP_6, "#8a2727");
    assert.equal(DANGER_SOFT_4, "#d99393");
    assert.equal(SUCCESS_GREEN_2, "#4a7c59");
    assert.equal(designTokens.AMBER_MUTED_7, "#c4a87a");
    assert.equal(designTokens.CARD_BG_12, "#fff1f1");
    assert.equal(designTokens.DANGER_DEEP_6, "#8a2727");
    assert.equal(designTokens.DANGER_SOFT_4, "#d99393");
    assert.equal(designTokens.SUCCESS_GREEN_2, "#4a7c59");
  });

  it("exposes the 10 new variants shipped for the app/collection/[id] migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_LIGHT_2, hex);
    assert.match(AMBER_MUTED_8, hex);
    assert.match(BORDER_7, hex);
    assert.match(CARD_BG_13, hex);
    assert.match(DANGER_SOFT_5, hex);
    assert.match(HERO_DARK_8, hex);
    assert.match(HERO_DARK_9, hex);
    assert.match(MUTED_22, hex);
    assert.match(MUTED_23, hex);
    assert.match(TEXT_ON_DARK_9, hex);
    assert.equal(AMBER_LIGHT_2, "#ffd7ab");
    assert.equal(AMBER_MUTED_8, "#cfb394");
    assert.equal(BORDER_7, "#f0e4d4");
    assert.equal(CARD_BG_13, "#fff8ee");
    assert.equal(DANGER_SOFT_5, "#ffe6e0");
    assert.equal(HERO_DARK_8, "#3d2c1f");
    assert.equal(HERO_DARK_9, "#1a0e06");
    assert.equal(MUTED_22, "#6b4d35");
    assert.equal(MUTED_23, "#6a4d35");
    assert.equal(TEXT_ON_DARK_9, "#f8eee3");
    assert.equal(designTokens.AMBER_LIGHT_2, "#ffd7ab");
    assert.equal(designTokens.AMBER_MUTED_8, "#cfb394");
    assert.equal(designTokens.BORDER_7, "#f0e4d4");
    assert.equal(designTokens.CARD_BG_13, "#fff8ee");
    assert.equal(designTokens.DANGER_SOFT_5, "#ffe6e0");
    assert.equal(designTokens.HERO_DARK_8, "#3d2c1f");
    assert.equal(designTokens.HERO_DARK_9, "#1a0e06");
    assert.equal(designTokens.MUTED_22, "#6b4d35");
    assert.equal(designTokens.MUTED_23, "#6a4d35");
    assert.equal(designTokens.TEXT_ON_DARK_9, "#f8eee3");
  });

  it("exposes the AMBER_SOFT_4 + MUTED_25 variants shipped for the realtime-status-pill migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_SOFT_4, hex);
    assert.match(MUTED_25, hex);
    assert.equal(AMBER_SOFT_4, "#fde7c2");
    assert.equal(MUTED_25, "#7a4d18");
    assert.equal(designTokens.AMBER_SOFT_4, "#fde7c2");
    assert.equal(designTokens.MUTED_25, "#7a4d18");
  });

  it("exposes the PAGE_BG_3 variant shipped for the screen.tsx migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(PAGE_BG_3, hex);
    assert.equal(PAGE_BG_3, "#f4f1ea");
    assert.equal(designTokens.PAGE_BG_3, "#f4f1ea");
  });

  it("exposes the MUTED_24 variant shipped for the crash-fallback migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_24, hex);
    assert.equal(MUTED_24, "#8a705a");
    assert.equal(designTokens.MUTED_24, "#8a705a");
  });

  it("exposes the MUTED_26 + TEXT_ON_DARK_10..13 variants shipped for the collection-card migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_26, hex);
    assert.match(TEXT_ON_DARK_10, hex);
    assert.match(TEXT_ON_DARK_11, hex);
    assert.match(TEXT_ON_DARK_12, hex);
    assert.match(TEXT_ON_DARK_13, hex);
    assert.equal(MUTED_26, "#c8b8a4");
    assert.equal(TEXT_ON_DARK_10, "#fff1de");
    assert.equal(TEXT_ON_DARK_11, "#f5ebdf");
    assert.equal(TEXT_ON_DARK_12, "#f3eee7");
    assert.equal(TEXT_ON_DARK_13, "#f8dfc5");
    assert.equal(designTokens.MUTED_26, "#c8b8a4");
    assert.equal(designTokens.TEXT_ON_DARK_10, "#fff1de");
    assert.equal(designTokens.TEXT_ON_DARK_11, "#f5ebdf");
    assert.equal(designTokens.TEXT_ON_DARK_12, "#f3eee7");
    assert.equal(designTokens.TEXT_ON_DARK_13, "#f8dfc5");
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
    // PR8d (visual-upgrade `redesign-secondary`): the marketplace screen adopts
    // the theme hook, airy hero/card radii + soft shadow, and the editorial font.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_HERO_LG\b/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
  });

  it("components/bottom-nav.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // PR4: nav bar + plus-button colors now come from useAppTheme(); the static
    // tokens that remain are the accent/modal palette.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /HERO_DARK/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_SOFT/);
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
    // PR4: active/inactive icon + active-dot colors now come from useAppTheme().
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /DANGER/);
    assert.match(src, /TEXT_ON_DARK/);
    assert.match(src, /AMBER_ACCENT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/chats.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/chats.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_3/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    assert.match(src, /DANGER/);
    // PR8e (visual-upgrade `redesign-secondary`): the chats screen adopts the
    // theme hook, airy hero/card radii + soft shadow, and the editorial display font.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_HERO_LG\b/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
    assert.match(src, /color:\s*theme\.muted\b/);
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
    // PR4: tab pill / label / header colors now come from useAppTheme(); the
    // remaining static tokens are the amber-accent (sub variant) + dot highlight.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_SOFT/);
    assert.match(src, /DANGER\b/);
    assert.match(src, /TEXT_DARK_2/);
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
    // PR8b (visual-upgrade `redesign-secondary`): the people screen adopts the
    // theme hook, airy hero/card radii + soft shadow, and the editorial font.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_HERO_LG\b/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
    assert.match(src, /color:\s*theme\.muted\b/);
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

  it("app/index.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/index.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_MUTED_2/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_9/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /HERO_DARK_4/);
    assert.match(src, /HERO_DARK_5/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_18/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_5/);
    assert.match(src, /TEXT_ON_DARK_7/);
    assert.match(src, /TEXT_ON_DARK_8/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  // PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme()
  // for body colors, the airy geometry tokens for hero/card radii, the soft
  // shadow on banners + recent cards, and the editorial display font for the
  // hero title and section headings.
  it("app/index.tsx adopts useAppTheme + airy geometry tokens for the home redesign", () => {
    const src = read("app/index.tsx");
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /RADIUS_HERO_LG/);
    assert.match(src, /RADIUS_CARD_AIRY/);
    assert.match(src, /RADIUS_ITEM_AIRY/);
    assert.match(src, /RADIUS_AVATAR\b/);
    assert.match(src, /SPACING_GUTTER/);
    assert.match(src, /SHADOW_SOFT/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // body surfaces read their colors from the theme rather than fixed tokens
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
  });

  // PR6 (visual-upgrade `redesign-collection-detail`): app/collection/[id].tsx
  // adopts useAppTheme() for the summary cards, RADIUS_HERO_LG on the cover
  // hero, a LinearGradient overlay, RADIUS_ITEM_AIRY + SHADOW_SOFT on summary
  // cards, SPACING_GUTTER hero padding, SPACING_AIRY list spacing, and the
  // editorial display font on the collection name.
  it("app/collection/[id].tsx adopts useAppTheme + airy geometry tokens for the collection-detail redesign", () => {
    const src = read("app/collection/[id].tsx");
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /from\s+"expo-linear-gradient"/);
    assert.match(src, /RADIUS_HERO_LG/);
    assert.match(src, /RADIUS_ITEM_AIRY/);
    assert.match(src, /SPACING_GUTTER/);
    assert.match(src, /SPACING_AIRY/);
    assert.match(src, /SHADOW_SOFT/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // summary cards read their colors from the theme rather than fixed tokens
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
  });

  it("app/settings.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/settings.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_LIGHT/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /AMBER_SOFT_3/);
    assert.match(src, /BORDER_5/);
    assert.match(src, /BORDER_6/);
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
    assert.match(src, /TEXT_DARK_2/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_3/);
    assert.match(src, /TEXT_ON_DARK_4/);
    assert.match(src, /TEXT_ON_DARK_SOFT/);
    // PR8f (visual-upgrade `redesign-secondary`): the settings screen adopts the
    // theme hook, airy hero/card radii + soft shadow, and the editorial display font.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_HERO_LG\b/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
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
    // PR8a (visual-upgrade `redesign-secondary`): the wishlist screen adopts the
    // theme hook, airy card radius + soft shadow, and the editorial display font.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
    assert.match(src, /color:\s*theme\.muted\b/);
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
    // PR8c (visual-upgrade `redesign-secondary`): the profile screen adopts the
    // theme hook, airy hero/card radii + soft shadow, and the editorial font.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_HERO_LG\b/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
    assert.match(src, /color:\s*theme\.muted\b/);
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

  it("app/item/[id].tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/item/[id].tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bACCENT_DEEP\b/);
    assert.match(src, /\bAMBER_ACCENT\b/);
    assert.match(src, /\bAMBER_MUTED_4\b/);
    assert.match(src, /\bAMBER_SOFT\b/);
    assert.match(src, /\bBORDER\b/);
    assert.match(src, /\bBORDER_2\b/);
    assert.match(src, /\bCARD_BG\b/);
    assert.match(src, /\bCARD_BG_3\b/);
    assert.match(src, /\bCARD_BG_12\b/);
    assert.match(src, /\bDANGER\b/);
    assert.match(src, /\bDANGER_DEEP_6\b/);
    assert.match(src, /\bDANGER_SOFT_4\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bMUTED\b/);
    assert.match(src, /\bMUTED_2\b/);
    assert.match(src, /\bMUTED_3\b/);
    assert.match(src, /\bMUTED_10\b/);
    assert.match(src, /\bPLACEHOLDER\b/);
    assert.match(src, /\bSUCCESS_GREEN\b/);
    assert.match(src, /\bSUCCESS_GREEN_2\b/);
    assert.match(src, /\bTAG_BLUE\b/);
    assert.match(src, /\bTAG_BROWN\b/);
    assert.match(src, /\bTAG_CYAN\b/);
    assert.match(src, /\bTAG_GOLD\b/);
    assert.match(src, /\bTAG_PURPLE\b/);
    assert.match(src, /\bTAG_RUST\b/);
    assert.match(src, /\bTAG_SAGE\b/);
    assert.match(src, /\bTAG_TEAL\b/);
    assert.match(src, /\bTAG_TERRACOTTA\b/);
    assert.match(src, /\bTEXT_DARK\b/);
    assert.match(src, /\bTEXT_DARK_2\b/);
    assert.match(src, /\bTEXT_DARK_3\b/);
    assert.match(src, /\bTEXT_DARK_4\b/);
    assert.match(src, /\bTEXT_ON_DARK\b/);
    assert.match(src, /\bTEXT_ON_DARK_2\b/);
    // PR7 (visual-upgrade `redesign-item-detail`): edge-to-edge hero, editorial
    // title, and a single themed meta card now drive the item screen.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bSPACING_GUTTER\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text\b/);
    assert.match(src, /color:\s*theme\.meta\b/);
    assert.match(src, /color:\s*theme\.muted\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/create.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/create.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /AMBER_ACCENT/);
    assert.match(src, /AMBER_MUTED_6/);
    assert.match(src, /AMBER_SOFT\b/);
    assert.match(src, /BORDER\b/);
    assert.match(src, /BORDER_2\b/);
    assert.match(src, /BORDER_3\b/);
    assert.match(src, /CARD_BG\b/);
    assert.match(src, /CARD_BG_3\b/);
    assert.match(src, /DANGER\b/);
    assert.match(src, /HERO_DARK\b/);
    assert.match(src, /HERO_DARK_2/);
    assert.match(src, /MUTED\b/);
    assert.match(src, /MUTED_2\b/);
    assert.match(src, /MUTED_3\b/);
    assert.match(src, /MUTED_8\b/);
    assert.match(src, /MUTED_10\b/);
    assert.match(src, /MUTED_13\b/);
    assert.match(src, /MUTED_15\b/);
    assert.match(src, /PAGE_BG_2/);
    assert.match(src, /PLACEHOLDER/);
    assert.match(src, /TAG_BLUE/);
    assert.match(src, /TAG_BROWN/);
    assert.match(src, /TAG_CYAN/);
    assert.match(src, /TAG_GOLD/);
    assert.match(src, /TAG_PURPLE/);
    assert.match(src, /TAG_RUST/);
    assert.match(src, /TAG_SAGE/);
    assert.match(src, /TAG_TEAL/);
    assert.match(src, /TAG_TERRACOTTA/);
    assert.match(src, /TEXT_DARK\b/);
    assert.match(src, /TEXT_DARK_2\b/);
    assert.match(src, /TEXT_DARK_3\b/);
    assert.match(src, /TEXT_DARK_4\b/);
    assert.match(src, /TEXT_ON_DARK\b/);
    assert.match(src, /TEXT_ON_DARK_2/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/collection/[id].tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/collection/[id].tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bACCENT_DEEP\b/);
    assert.match(src, /\bAMBER_ACCENT\b/);
    assert.match(src, /\bAMBER_LIGHT_2\b/);
    assert.match(src, /\bAMBER_MUTED_2\b/);
    assert.match(src, /\bAMBER_MUTED_7\b/);
    assert.match(src, /\bAMBER_MUTED_8\b/);
    assert.match(src, /\bAMBER_SOFT\b/);
    assert.match(src, /\bBORDER\b/);
    assert.match(src, /\bBORDER_7\b/);
    assert.match(src, /\bCARD_BG\b/);
    assert.match(src, /\bCARD_BG_3\b/);
    assert.match(src, /\bCARD_BG_9\b/);
    assert.match(src, /\bCARD_BG_10\b/);
    assert.match(src, /\bCARD_BG_13\b/);
    assert.match(src, /\bDANGER\b/);
    assert.match(src, /\bDANGER_DEEP_4\b/);
    assert.match(src, /\bDANGER_SOFT_2\b/);
    assert.match(src, /\bDANGER_SOFT_5\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bHERO_DARK_2\b/);
    assert.match(src, /\bHERO_DARK_8\b/);
    assert.match(src, /\bHERO_DARK_9\b/);
    assert.match(src, /\bMUTED\b/);
    assert.match(src, /\bMUTED_2\b/);
    assert.match(src, /\bMUTED_3\b/);
    assert.match(src, /\bMUTED_5\b/);
    assert.match(src, /\bMUTED_10\b/);
    assert.match(src, /\bMUTED_17\b/);
    assert.match(src, /\bMUTED_22\b/);
    assert.match(src, /\bMUTED_23\b/);
    assert.match(src, /\bPLACEHOLDER\b/);
    assert.match(src, /\bPURE_WHITE\b/);
    assert.match(src, /\bSUCCESS_GREEN_2\b/);
    assert.match(src, /\bTEXT_DARK\b/);
    assert.match(src, /\bTEXT_DARK_2\b/);
    assert.match(src, /\bTEXT_DARK_3\b/);
    assert.match(src, /\bTEXT_ON_DARK\b/);
    assert.match(src, /\bTEXT_ON_DARK_2\b/);
    assert.match(src, /\bTEXT_ON_DARK_4\b/);
    assert.match(src, /\bTEXT_ON_DARK_9\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/realtime-status-pill.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/realtime-status-pill.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bAMBER_SOFT\b/);
    assert.match(src, /\bAMBER_SOFT_4\b/);
    assert.match(src, /\bMUTED_25\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/screen.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/screen.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // PR4 migrated the page surface onto useAppTheme() (flat color, no gradient).
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /\bACCENT_DEEP\b/);
    assert.match(src, /\bSPACING_GUTTER\b/);
    assert.match(src, /\bSPACING_AIRY\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/crash-fallback.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/crash-fallback.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bMUTED_24\b/);
    assert.match(src, /\bPAGE_BG_2\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/qr-code.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/qr-code.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bPURE_WHITE\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/skeleton.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/skeleton.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bBORDER_2\b/);
    assert.match(src, /\bPAGE_BG_2\b/);
    assert.match(src, /\bTEXT_ON_DARK_SOFT\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/collections-feed.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/collections-feed.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bAMBER_LIGHT\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bTEXT_ON_DARK_3\b/);
    assert.match(src, /\bTEXT_ON_DARK_SOFT\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("app/auth/callback.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("app/auth/callback.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bACCENT_DEEP\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bMUTED_9\b/);
    assert.match(src, /\bTEXT_DARK\b/);
    assert.match(src, /\bTEXT_ON_DARK_2\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/collection-card.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/collection-card.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bMUTED_26\b/);
    assert.match(src, /\bPURE_WHITE\b/);
    assert.match(src, /\bTEXT_ON_DARK_10\b/);
    assert.match(src, /\bTEXT_ON_DARK_11\b/);
    assert.match(src, /\bTEXT_ON_DARK_12\b/);
    assert.match(src, /\bTEXT_ON_DARK_13\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/selectable-item-row.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/selectable-item-row.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bAMBER_ACCENT\b/);
    assert.match(src, /\bCARD_BG\b/);
    assert.match(src, /\bCARD_BG_3\b/);
    assert.match(src, /\bTEXT_ON_DARK_5\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/reaction-bar.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/reaction-bar.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bBORDER\b/);
    assert.match(src, /\bCARD_BG\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bMUTED\b/);
    assert.match(src, /\bMUTED_2\b/);
    assert.match(src, /\bTEXT_ON_DARK\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("components/photo-preview.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/photo-preview.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bAMBER_MUTED_2\b/);
    assert.match(src, /\bBORDER\b/);
    assert.match(src, /\bCARD_BG\b/);
    assert.match(src, /\bMUTED_17\b/);
    assert.match(src, /\bPLACEHOLDER\b/);
    assert.match(src, /\bPURE_WHITE\b/);
    assert.match(src, /\bTEXT_ON_DARK\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("exposes the ACCENT_DEEP_2 variant shipped for the visibility-badge migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(ACCENT_DEEP_2, hex);
    assert.equal(ACCENT_DEEP_2, "#8a6520");
    assert.equal(designTokens.ACCENT_DEEP_2, "#8a6520");
  });

  it("components/visibility-badge.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/visibility-badge.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\bACCENT_DEEP_2\b/);
    assert.match(src, /\bMUTED_2\b/);
    assert.match(src, /\bSUCCESS_GREEN_2\b/);
    assert.match(src, /\bTEXT_ON_DARK\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("exposes the AMBER_SOFT_5 + CARD_BG_14 variants shipped for the empty-state migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(AMBER_SOFT_5, hex);
    assert.equal(AMBER_SOFT_5, "#eed4a0");
    assert.equal(designTokens.AMBER_SOFT_5, "#eed4a0");
    assert.match(CARD_BG_14, hex);
    assert.equal(CARD_BG_14, "#ffe8c7");
    assert.equal(designTokens.CARD_BG_14, "#ffe8c7");
  });

  it("components/empty-state.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/empty-state.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // PR4: title/hint/wrap colors now come from useAppTheme(); container radius
    // bumped to RADIUS_CARD_AIRY.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /\bAMBER_ACCENT\b/);
    assert.match(src, /\bAMBER_SOFT_3\b/);
    assert.match(src, /\bAMBER_SOFT_5\b/);
    assert.match(src, /\bCARD_BG_2\b/);
    assert.match(src, /\bCARD_BG_3\b/);
    assert.match(src, /\bCARD_BG_14\b/);
    assert.match(src, /\bRADIUS_CARD_AIRY\b/);
    assert.match(src, /\bTEXT_ON_DARK_5\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("exposes the MUTED_27 variant shipped for the currency-input migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(MUTED_27, hex);
    assert.equal(MUTED_27, "#5a4030");
    assert.equal(designTokens.MUTED_27, "#5a4030");
  });

  it("components/currency-input.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/currency-input.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // PR4: input bg/border/text now come from useAppTheme(); chip palette stays.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /\bBORDER\b/);
    assert.match(src, /\bCARD_BG_2\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bMUTED_27\b/);
    assert.match(src, /\bPLACEHOLDER\b/);
    assert.match(src, /\bTEXT_ON_DARK_2\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("exposes the TEXT_DARK_5 + MUTED_28 + MUTED_29 variants shipped for the item-card migration", () => {
    const hex = /^#[0-9a-f]{6}$/;
    assert.match(TEXT_DARK_5, hex);
    assert.match(MUTED_28, hex);
    assert.match(MUTED_29, hex);
    assert.equal(TEXT_DARK_5, "#312218");
    assert.equal(MUTED_28, "#6a5647");
    assert.equal(MUTED_29, "#8d6c4a");
    assert.equal(designTokens.TEXT_DARK_5, "#312218");
    assert.equal(designTokens.MUTED_28, "#6a5647");
    assert.equal(designTokens.MUTED_29, "#8d6c4a");
  });

  it("components/item-card.tsx imports tokens from lib/design-tokens and has no inline hex literals", () => {
    const src = read("components/item-card.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    // PR4: card/title/meta colors now come from useAppTheme(); radius bumped to
    // RADIUS_ITEM_AIRY and the row gains SHADOW_SOFT.
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /\bAMBER_MUTED_3\b/);
    assert.match(src, /\bHERO_DARK\b/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bTEXT_ON_DARK\b/);
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals remain: ${hexLiterals.join(", ")}`);
  });

  it("exposes semantic RADIUS_* tokens shipped for the geometry-tokens migration", () => {
    assert.equal(RADIUS_PILL, 999);
    assert.equal(RADIUS_CARD, 22);
    assert.equal(RADIUS_CARD_LG, 24);
    assert.equal(RADIUS_CARD_SM, 20);
    assert.equal(RADIUS_INPUT, 16);
    assert.equal(RADIUS_AVATAR_LG, 28);
    assert.equal(RADIUS_AVATAR, 18);
    assert.equal(designTokens.RADIUS_PILL, 999);
    assert.equal(designTokens.RADIUS_CARD, 22);
    assert.equal(designTokens.RADIUS_CARD_LG, 24);
    assert.equal(designTokens.RADIUS_CARD_SM, 20);
    assert.equal(designTokens.RADIUS_INPUT, 16);
    assert.equal(designTokens.RADIUS_AVATAR_LG, 28);
    assert.equal(designTokens.RADIUS_AVATAR, 18);
  });

  it("exposes semantic SPACING_* tokens shipped for the geometry-tokens migration", () => {
    assert.equal(SPACING_MICRO, 4);
    assert.equal(SPACING_TIGHT, 6);
    assert.equal(SPACING_INLINE, 8);
    assert.equal(SPACING_LIST, 10);
    assert.equal(SPACING_CARD, 12);
    assert.equal(SPACING_SECTION, 14);
    assert.equal(designTokens.SPACING_MICRO, 4);
    assert.equal(designTokens.SPACING_TIGHT, 6);
    assert.equal(designTokens.SPACING_INLINE, 8);
    assert.equal(designTokens.SPACING_LIST, 10);
    assert.equal(designTokens.SPACING_CARD, 12);
    assert.equal(designTokens.SPACING_SECTION, 14);
  });

  it("RADIUS_* and SPACING_* tokens are ascending within their families", () => {
    // Pins the ordering convention so a future "add RADIUS_MEDIUM=21" insertion
    // forces a re-ordering rather than silently breaking the visual rhythm.
    assert.ok(RADIUS_CARD_SM < RADIUS_CARD, "CARD_SM < CARD");
    assert.ok(RADIUS_CARD < RADIUS_CARD_LG, "CARD < CARD_LG");
    assert.ok(RADIUS_AVATAR < RADIUS_AVATAR_LG, "AVATAR < AVATAR_LG");
    assert.ok(RADIUS_INPUT < RADIUS_CARD_SM, "INPUT < CARD_SM");
    assert.ok(SPACING_MICRO < SPACING_TIGHT, "MICRO < TIGHT");
    assert.ok(SPACING_TIGHT < SPACING_INLINE, "TIGHT < INLINE");
    assert.ok(SPACING_INLINE < SPACING_LIST, "INLINE < LIST");
    assert.ok(SPACING_LIST < SPACING_CARD, "LIST < CARD");
    assert.ok(SPACING_CARD < SPACING_SECTION, "CARD < SECTION");
  });
});
