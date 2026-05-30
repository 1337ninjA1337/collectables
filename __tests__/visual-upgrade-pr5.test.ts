import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme() for
// the light "body" surfaces, the new geometry tokens for hero/card radius, the
// editorial display font for headlines, and SHADOW_SOFT on the banners +
// recent-row cards. Structural checks only — they exercise the source text so
// they run under node --test without mounting React Native.

describe("visual-upgrade PR5 — redesign-home", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /const\s+theme\s*=\s*useAppTheme\(\)/);
  });

  it("hero uses RADIUS_HERO_LG + SPACING_GUTTER and an editorial 32/38 title", () => {
    assert.match(src, /hero:\s*{[^}]*borderRadius:\s*RADIUS_HERO_LG/s);
    assert.match(src, /hero:\s*{[^}]*padding:\s*SPACING_GUTTER/s);
    assert.match(src, /title:\s*{[^}]*fontSize:\s*32[^}]*lineHeight:\s*38[^}]*fontFamily:\s*FONT_DISPLAY_EDITORIAL/s);
  });

  it("section titles use the editorial font at weight 600", () => {
    assert.match(src, /sectionTitle:\s*{[^}]*fontWeight:\s*"600"[^}]*fontFamily:\s*FONT_DISPLAY_EDITORIAL/s);
  });

  it("recent-row card uses RADIUS_ITEM_AIRY and its image uses RADIUS_AVATAR", () => {
    assert.match(src, /recentCard:\s*{[^}]*borderRadius:\s*RADIUS_ITEM_AIRY/s);
    assert.match(src, /recentImage:\s*{[^}]*borderRadius:\s*RADIUS_AVATAR/s);
  });

  it("skeleton placeholders adopt the airy radii", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*}/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*}/);
  });

  it("spreads SHADOW_SOFT on the wishlist banner, stats banner and recent cards", () => {
    assert.match(src, /styles\.wishlistBanner[^>]*SHADOW_SOFT/s);
    assert.match(src, /styles\.statsBanner[^>]*SHADOW_SOFT/s);
    assert.match(src, /styles\.recentCard[^>]*SHADOW_SOFT/s);
  });

  it("themes body surfaces through theme.* rather than baked-in light tokens", () => {
    // The body cards/banners read their colors from the theme hook so they
    // adapt to dark mode (the hero gradient stays intentionally dark).
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /color:\s*theme\.meta/);
    assert.match(src, /color:\s*theme\.muted/);
  });

  it("carries no inline 6-digit hex literals", () => {
    const hex = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hex, [], `app/index.tsx has inline hex: ${hex.join(", ")}`);
  });
});
