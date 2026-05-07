import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  BORDER,
  CARD_BG,
  DANGER,
  designTokens,
  HERO_DARK,
  MUTED,
  PAGE_BG,
  SUCCESS_GREEN,
  TEXT_DARK,
  TEXT_ON_DARK,
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
});
