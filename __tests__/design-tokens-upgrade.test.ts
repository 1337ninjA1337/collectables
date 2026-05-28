import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  designTokens,
  RADIUS_HERO_LG, RADIUS_CARD_AIRY, RADIUS_ITEM_AIRY,
  SPACING_GUTTER, SPACING_AIRY,
  SHADOW_SOFT,
  HERO_DARK,
} from "../lib/design-tokens";

describe("Mixed direction token additions", () => {
  it("exports the new geometry tokens with expected values", () => {
    assert.equal(RADIUS_HERO_LG, 32);
    assert.equal(RADIUS_CARD_AIRY, 32);
    assert.equal(RADIUS_ITEM_AIRY, 28);
    assert.equal(SPACING_GUTTER, 24);
    assert.equal(SPACING_AIRY, 20);
  });

  it("registers each new geometry token in the frozen designTokens map", () => {
    assert.equal(designTokens.RADIUS_HERO_LG, 32);
    assert.equal(designTokens.RADIUS_CARD_AIRY, 32);
    assert.equal(designTokens.RADIUS_ITEM_AIRY, 28);
    assert.equal(designTokens.SPACING_GUTTER, 24);
    assert.equal(designTokens.SPACING_AIRY, 20);
  });

  it("exposes SHADOW_SOFT with the expected shape", () => {
    assert.equal(SHADOW_SOFT.shadowColor, HERO_DARK);
    assert.equal(SHADOW_SOFT.shadowOpacity, 0.08);
    assert.deepEqual(SHADOW_SOFT.shadowOffset, { width: 0, height: 6 });
    assert.equal(SHADOW_SOFT.shadowRadius, 18);
    assert.equal(SHADOW_SOFT.elevation, 4);
  });
});
