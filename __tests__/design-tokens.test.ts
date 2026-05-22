import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_MUTED,
  BORDER,
  BORDER_3,
  CARD_BG,
  DANGER,
  designTokens,
  HERO_DARK,
  MUTED,
  MUTED_3,
  MUTED_4,
  MUTED_5,
  PAGE_BG,
  SUCCESS_GREEN,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_3,
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
