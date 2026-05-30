import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme() for
// adaptive surface colors, the new geometry/shadow tokens for radius/spacing,
// and FONT_DISPLAY_EDITORIAL on the hero + section titles. Structural checks —
// they exercise the source text so they run under node --test without mounting
// React Native.

describe("visual-upgrade PR5 — redesign-home", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /const\s+theme\s*=\s*useAppTheme\(\)/);
  });

  it("hero card uses RADIUS_HERO_LG and the editorial display font", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
  });

  it("hero title is bumped to fontSize 32 / lineHeight 38 / weight 700", () => {
    assert.match(src, /title:\s*\{[^}]*fontSize:\s*32[^}]*lineHeight:\s*38[^}]*fontWeight:\s*"700"/s);
  });

  it("section titles use FONT_DISPLAY_EDITORIAL at weight 600", () => {
    assert.match(src, /sectionTitle:\s*\{[^}]*fontWeight:\s*"600"[^}]*FONT_DISPLAY_EDITORIAL/s);
  });

  it("recent-row outer card uses RADIUS_ITEM_AIRY and inner image RADIUS_AVATAR", () => {
    assert.match(src, /recentCard:\s*\{[^}]*borderRadius:\s*RADIUS_ITEM_AIRY/s);
    assert.match(src, /recentImage:\s*\{[^}]*borderRadius:\s*RADIUS_AVATAR/s);
  });

  it("skeleton placeholders use the airy radii", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*\}/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*\}/);
  });

  it("spreads SHADOW_SOFT on the banner + recent-row surfaces", () => {
    assert.match(src, /SHADOW_SOFT/);
    const shadowSpreads = src.match(/\.\.\.SHADOW_SOFT/g) ?? [];
    assert.ok(shadowSpreads.length >= 3, `expected SHADOW_SOFT on >=3 surfaces, got ${shadowSpreads.length}`);
  });

  it("adaptive surfaces read colors from theme.* instead of static tokens", () => {
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /color:\s*theme\.muted/);
    assert.match(src, /color:\s*theme\.meta/);
  });

  it("drops the now-unused Syne display fonts from the import", () => {
    assert.doesNotMatch(src, /FONT_DISPLAY_BOLD/);
    assert.doesNotMatch(src, /\bFONT_DISPLAY\b(?!_)/);
  });
});
