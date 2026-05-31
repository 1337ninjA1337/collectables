import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme()
// for its light-surface colors, the new geometry/shadow tokens, and the
// editorial display font on the hero + section titles. Structural checks —
// they exercise the source text so they run under node --test without
// mounting React Native.

describe("visual-upgrade PR5 — redesign-home", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
  });

  it("hero uses RADIUS_HERO_LG, SPACING_GUTTER and the editorial title font", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
    assert.match(src, /padding:\s*SPACING_GUTTER/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("hero title is sized 32 / lineHeight 38 / weight 700", () => {
    assert.match(src, /fontSize:\s*32,\s*\n\s*lineHeight:\s*38,\s*\n\s*fontWeight:\s*"700"/);
  });

  it("section titles use the editorial font at weight 600", () => {
    assert.match(src, /sectionTitle:\s*\{[^}]*fontWeight:\s*"600"[^}]*FONT_DISPLAY_EDITORIAL/s);
  });

  it("recent-row card uses RADIUS_ITEM_AIRY and the avatar radius on its image", () => {
    assert.match(src, /recentCard:\s*\{[^}]*borderRadius:\s*RADIUS_ITEM_AIRY/s);
    assert.match(src, /recentImage:\s*\{[^}]*borderRadius:\s*RADIUS_AVATAR/s);
  });

  it("spreads SHADOW_SOFT on the banners and recent card", () => {
    const shadows = src.match(/\.\.\.SHADOW_SOFT/g) ?? [];
    assert.ok(shadows.length >= 3, `expected >=3 SHADOW_SOFT spreads, got ${shadows.length}`);
  });

  it("skeleton placeholders adopt the airy radii", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*\}/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*\}/);
  });

  it("reads light-surface colors from the theme", () => {
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /color:\s*theme\.muted/);
    assert.match(src, /color:\s*theme\.meta/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
  });

  it("carries no inline 6-digit hex literals", () => {
    const hex = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hex, [], `app/index.tsx has inline hex: ${hex.join(", ")}`);
  });
});
