import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme()
// for adaptive surfaces, the new geometry/shadow tokens for the hero, recent
// cards and banners, and FONT_DISPLAY_EDITORIAL for the hero + section titles.
// Structural checks — they exercise the source text so they run under
// node --test without mounting React Native.

describe("visual-upgrade PR5 — redesign-home", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /const theme = useAppTheme\(\)/);
  });

  it("hero uses RADIUS_HERO_LG + SPACING_GUTTER", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
    assert.match(src, /padding:\s*SPACING_GUTTER/);
  });

  it("hero gradient keeps the dark hero token ramp", () => {
    assert.match(src, /colors=\{\[HERO_DARK_4,\s*HERO_DARK,\s*HERO_DARK_5\]\}/);
  });

  it("hero title is the editorial serif at 32/38", () => {
    assert.match(src, /title:\s*\{[^}]*fontSize:\s*32[^}]*\}/s);
    assert.match(src, /title:\s*\{[^}]*lineHeight:\s*38[^}]*\}/s);
    assert.match(src, /title:\s*\{[^}]*fontFamily:\s*FONT_DISPLAY_EDITORIAL[^}]*\}/s);
  });

  it("section titles use the editorial serif at weight 600", () => {
    assert.match(src, /sectionTitle:\s*\{[^}]*fontWeight:\s*"600"[^}]*\}/s);
    assert.match(src, /sectionTitle:\s*\{[^}]*fontFamily:\s*FONT_DISPLAY_EDITORIAL[^}]*\}/s);
    // Syne display font no longer referenced on the home screen.
    assert.doesNotMatch(src, /FONT_DISPLAY\b(?!_)/);
  });

  it("recent-row card uses RADIUS_ITEM_AIRY + SHADOW_SOFT, image uses RADIUS_AVATAR", () => {
    assert.match(src, /recentCard:\s*\{[^}]*borderRadius:\s*RADIUS_ITEM_AIRY[^}]*\}/s);
    assert.match(src, /recentCard:\s*\{[^}]*\.\.\.SHADOW_SOFT[^}]*\}/s);
    assert.match(src, /recentImage:\s*\{[^}]*borderRadius:\s*RADIUS_AVATAR[^}]*\}/s);
  });

  it("wishlist + stats banners spread SHADOW_SOFT", () => {
    assert.match(src, /wishlistBanner:\s*\{[^}]*\.\.\.SHADOW_SOFT[^}]*\}/s);
    assert.match(src, /statsBanner:\s*\{[^}]*\.\.\.SHADOW_SOFT[^}]*\}/s);
  });

  it("skeleton placeholders match the new shape tokens", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*\}\}\s*\/>/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*\}\}\s*\/>/);
  });

  it("adaptive surfaces read colors from the theme", () => {
    assert.match(src, /\.\.\.styles\.sectionTitle,\s*color:\s*theme\.text/);
    assert.match(src, /\.\.\.styles\.sectionDescription,\s*color:\s*theme\.muted/);
    assert.match(src, /\.\.\.styles\.summaryCard,\s*backgroundColor:\s*theme\.card/);
    assert.match(src, /\.\.\.styles\.recentCard,\s*backgroundColor:\s*theme\.card/);
    assert.match(src, /\.\.\.styles\.statsBanner,\s*backgroundColor:\s*theme\.card/);
    assert.match(src, /\.\.\.styles\.wishlistBanner,\s*backgroundColor:\s*theme\.bannerBg/);
  });
});
