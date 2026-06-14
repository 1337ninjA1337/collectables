import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// PR7 (visual-upgrade `redesign-item-detail`): app/item/[id].tsx gets the
// editorial cover treatment — an edge-to-edge hero photo, a serif title block,
// a description paragraph reading theme.muted, a single themed meta card with
// key/value rows, and an actions row (Edit amber / Share + delete ghost).
// Structural checks only — they read the source so they run under node --test
// without mounting React Native.

describe("visual-upgrade PR7 — item-detail redesign", () => {
  const src = read("app/item/[id].tsx");

  it("adopts the theme hook and airy geometry tokens", () => {
    assert.match(src, /from\s+"@\/components\/use-app-theme"/);
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /\bRADIUS_ITEM_AIRY\b/);
    assert.match(src, /\bSHADOW_SOFT\b/);
    assert.match(src, /\bSPACING_GUTTER\b/);
    assert.match(src, /\bFONT_DISPLAY_EDITORIAL\b/);
  });

  it("renders an edge-to-edge hero photo (negative gutter, fixed 280 height, no radius)", () => {
    assert.match(src, /photoHero:\s*\{[^}]*marginHorizontal:\s*-SPACING_GUTTER/);
    assert.match(src, /photoHero:\s*\{[^}]*height:\s*280/);
    // No borderRadius on the hero — it must bleed to the screen edges.
    assert.doesNotMatch(src, /photoHero:\s*\{[^}]*borderRadius/);
    assert.match(src, /styles\.photoHero/);
  });

  it("title uses the editorial serif at 32/700/38 and reads theme.text", () => {
    assert.match(src, /itemTitle:\s*\{[^}]*fontSize:\s*32/);
    assert.match(src, /itemTitle:\s*\{[^}]*fontWeight:\s*"700"/);
    assert.match(src, /itemTitle:\s*\{[^}]*lineHeight:\s*38/);
    assert.match(src, /itemTitle:\s*\{[^}]*fontFamily:\s*FONT_DISPLAY_EDITORIAL/);
    assert.match(src, /\.\.\.styles\.itemTitle,\s*color:\s*theme\.text/);
  });

  it("description paragraph reads theme.muted with a 24 line-height", () => {
    assert.match(src, /\.\.\.styles\.description,\s*color:\s*theme\.muted/);
    assert.match(src, /description:\s*\{[^}]*lineHeight:\s*24/);
  });

  it("lays the metadata out as a single themed card with key/value rows", () => {
    assert.match(src, /metaCard:\s*\{[^}]*borderRadius:\s*RADIUS_ITEM_AIRY/);
    assert.match(src, /\.\.\.styles\.metaCard,\s*backgroundColor:\s*theme\.card,\s*borderColor:\s*theme\.border,\s*\.\.\.SHADOW_SOFT/);
    assert.match(src, /function MetaRow\(/);
    // The standalone per-field "sheet" cards are gone.
    assert.doesNotMatch(src, /styles\.sheet\b/);
  });

  it("actions row: Edit is the amber primary, Share + delete are ghosts", () => {
    assert.match(src, /editButton:\s*\{[^}]*backgroundColor:\s*AMBER_ACCENT/);
    assert.match(src, /editButtonText:\s*\{[^}]*color:\s*TEXT_DARK_2/);
    assert.match(src, /\bghostButton\b/);
    assert.match(src, /\bghostDangerButton\b/);
    assert.match(src, /ghostDangerText:\s*\{[^}]*color:\s*DANGER_DEEP_6/);
  });

  it("has no inline 6-digit hex literals", () => {
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, []);
  });
});
