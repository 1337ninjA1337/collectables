import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme()
// for page-surface colors, the new geometry/shadow tokens for radii + shadow,
// and FONT_DISPLAY_EDITORIAL for the hero + section titles. Structural checks
// over the source so they run under node --test without mounting React.

describe("visual-upgrade PR5 — redesign-home", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /const theme = useAppTheme\(\)/);
  });

  it("hero + section titles use the editorial display font", () => {
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // The old display font is no longer referenced.
    assert.doesNotMatch(src, /\bFONT_DISPLAY\b(?!_EDITORIAL)/);
  });

  it("hero surface uses RADIUS_HERO_LG and the gutter padding token", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
    assert.match(src, /padding:\s*SPACING_GUTTER/);
  });

  it("recent card uses RADIUS_ITEM_AIRY and its image uses RADIUS_AVATAR", () => {
    assert.match(src, /borderRadius:\s*RADIUS_ITEM_AIRY/);
    assert.match(src, /borderRadius:\s*RADIUS_AVATAR/);
  });

  it("skeleton placeholders adopt the airy radii", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY/);
  });

  it("spreads SHADOW_SOFT on the wishlist banner, stats banner and recent card", () => {
    const shadowCount = (src.match(/\.\.\.SHADOW_SOFT/g) ?? []).length;
    assert.ok(shadowCount >= 3, `expected >=3 SHADOW_SOFT spreads, found ${shadowCount}`);
  });

  it("reads page-surface colors from the theme rather than removed tokens", () => {
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /color:\s*theme\.meta/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
    // Migrated tokens are gone from the import surface.
    assert.doesNotMatch(src, /\bCARD_BG\b(?!_9)/);
    assert.doesNotMatch(src, /\bTEXT_DARK\b(?!_2)/);
  });

  it("carries no inline 6-digit hex literals", () => {
    const hex = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hex, [], `inline hex: ${hex.join(", ")}`);
  });
});
