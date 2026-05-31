import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts useAppTheme() for
// colours, the new geometry/shadow tokens for radius/spacing/elevation, and
// FONT_DISPLAY_EDITORIAL for the hero + section headlines. Structural checks —
// they exercise the source text so they run under node --test without mounting
// React Native.

describe("visual-upgrade PR5 — home screen redesign", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /const theme = useAppTheme\(\)/);
  });

  it("imports the new geometry / shadow tokens", () => {
    assert.match(src, /RADIUS_HERO_LG/);
    assert.match(src, /RADIUS_ITEM_AIRY/);
    assert.match(src, /RADIUS_CARD_AIRY/);
    assert.match(src, /RADIUS_AVATAR/);
    assert.match(src, /SHADOW_SOFT/);
    assert.match(src, /SPACING_GUTTER/);
  });

  it("uses the editorial display font for the hero + section headlines", () => {
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // the legacy FONT_DISPLAY (non-editorial) headline import is gone
    assert.doesNotMatch(src, /\bFONT_DISPLAY\b(?!_)/);
  });

  it("rounds the hero with RADIUS_HERO_LG and pads it with SPACING_GUTTER", () => {
    assert.match(src, /hero:\s*\{[^}]*borderRadius:\s*RADIUS_HERO_LG/s);
    assert.match(src, /hero:\s*\{[^}]*padding:\s*SPACING_GUTTER/s);
  });

  it("section titles use a 600-weight editorial headline", () => {
    assert.match(
      src,
      /sectionTitle:\s*\{[^}]*fontWeight:\s*"600"[^}]*fontFamily:\s*FONT_DISPLAY_EDITORIAL/s,
    );
  });

  it("bumps the recent-row card to RADIUS_ITEM_AIRY and its image to RADIUS_AVATAR", () => {
    assert.match(src, /recentCard:\s*\{[^}]*borderRadius:\s*RADIUS_ITEM_AIRY/s);
    assert.match(src, /recentImage:\s*\{[^}]*borderRadius:\s*RADIUS_AVATAR/s);
  });

  it("matches the skeleton placeholders to the new card shapes", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*\}/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*\}/);
  });

  it("spreads SHADOW_SOFT on the wishlist banner, stats banner and recent cards", () => {
    const shadowSpreads = src.match(/\.\.\.SHADOW_SOFT/g) ?? [];
    assert.ok(shadowSpreads.length >= 3, `expected ≥3 SHADOW_SOFT spreads, found ${shadowSpreads.length}`);
  });

  it("reads surface colours from the theme rather than fixed light tokens", () => {
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /borderColor:\s*theme\.border/);
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
  });
});
