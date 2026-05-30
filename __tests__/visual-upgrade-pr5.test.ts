import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme() for
// surface colors, the new geometry/shadow tokens for radius + elevation, and
// FONT_DISPLAY_EDITORIAL for the hero + section headings. Structural checks —
// they read the source text so they run under node --test without mounting RN.

describe("visual-upgrade PR5 — home screen redesign", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
  });

  it("hero surface uses RADIUS_HERO_LG", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
  });

  it("hero title + section titles use FONT_DISPLAY_EDITORIAL", () => {
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // hero title sized up to 32 / lineHeight 38, weight 700
    assert.match(src, /fontSize:\s*32/);
    assert.match(src, /lineHeight:\s*38/);
    // FONT_DISPLAY is no longer referenced now that both headings moved over
    assert.doesNotMatch(src, /\bFONT_DISPLAY\b(?!_)/);
  });

  it("recent-row card uses RADIUS_ITEM_AIRY + image RADIUS_AVATAR + SHADOW_SOFT", () => {
    assert.match(src, /borderRadius:\s*RADIUS_ITEM_AIRY/);
    assert.match(src, /borderRadius:\s*RADIUS_AVATAR/);
  });

  it("wishlist, stats, and recent cards spread SHADOW_SOFT", () => {
    const shadowCount = (src.match(/\.\.\.SHADOW_SOFT/g) ?? []).length;
    assert.ok(shadowCount >= 3, `expected >=3 SHADOW_SOFT spreads, got ${shadowCount}`);
  });

  it("skeleton placeholders use the airy radii", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*\}/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*\}/);
  });

  it("light-surface text + banners read theme.* colors", () => {
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /color:\s*theme\.meta/);
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
  });
});
