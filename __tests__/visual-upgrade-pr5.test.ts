import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR5 (visual-upgrade `redesign-home`): app/index.tsx adopts the editorial
// display font, the airy geometry tokens, SHADOW_SOFT, and reads its surface
// colors from useAppTheme(). Structural checks — they exercise the source text
// so they run under node --test without mounting React Native.

describe("visual-upgrade PR5 — redesign-home", () => {
  const src = read("app/index.tsx");

  it("consumes useAppTheme()", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /const theme = useAppTheme\(\)/);
  });

  it("hero uses the large hero radius", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG/);
  });

  it("hero + section titles use the editorial display font", () => {
    assert.match(src, /FONT_DISPLAY_EDITORIAL/);
    // hero title bumped to 32/38 at weight 700
    assert.match(src, /fontSize:\s*32,\s*\n\s*lineHeight:\s*38,/);
  });

  it("recent-row card uses the airy item radius and avatar image radius", () => {
    assert.match(src, /borderRadius:\s*RADIUS_ITEM_AIRY/);
    assert.match(src, /borderRadius:\s*RADIUS_AVATAR/);
  });

  it("spreads SHADOW_SOFT on the banner / recent-card surfaces", () => {
    assert.match(src, /\.\.\.SHADOW_SOFT/);
  });

  it("skeleton placeholders use the new geometry tokens", () => {
    assert.match(src, /borderRadius:\s*RADIUS_HERO_LG\s*\}/);
    assert.match(src, /borderRadius:\s*RADIUS_CARD_AIRY\s*\}/);
  });

  it("themed surfaces read colors from the theme", () => {
    assert.match(src, /backgroundColor:\s*theme\.card/);
    assert.match(src, /backgroundColor:\s*theme\.bannerBg/);
    assert.match(src, /color:\s*theme\.text/);
    assert.match(src, /color:\s*theme\.muted/);
    assert.match(src, /color:\s*theme\.meta/);
  });
});
