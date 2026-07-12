import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { designTokens } from "../lib/design-tokens";
import { tokens } from "../lib/styles";

describe("lib/styles — tokens aggregator", () => {
  it("is the SAME object as designTokens (re-export, not a copy)", () => {
    // Identity, not deep-equality: a copy could drift if design-tokens adds
    // an entry while a hand-rolled aggregate misses it.
    assert.equal(tokens, designTokens);
  });

  it("carries both palette and geometry tokens in one namespace", () => {
    // One representative per family — the identity check above covers the
    // full surface; these pin that the families the doc block promises
    // actually resolve through the aggregator.
    assert.equal(typeof tokens.CARD_BG, "string");
    assert.match(tokens.CARD_BG, /^#[0-9a-fA-F]{6}$/);
    assert.equal(typeof tokens.RADIUS_CARD, "number");
    assert.equal(typeof tokens.RADIUS_PILL, "number");
    assert.equal(typeof tokens.SPACING_LIST, "number");
    assert.equal(typeof tokens.SPACING_CARD, "number");
    assert.equal(typeof tokens.SPACING_INLINE, "number");
  });

  it("stays frozen — consumers cannot mutate the design system", () => {
    assert.ok(Object.isFrozen(tokens));
  });

  it("geometry values match the named exports (no drift by construction)", async () => {
    const named = await import("../lib/design-tokens");
    assert.equal(tokens.RADIUS_PILL, named.RADIUS_PILL);
    assert.equal(tokens.SPACING_LIST, named.SPACING_LIST);
    assert.equal(tokens.SPACING_CARD, named.SPACING_CARD);
    assert.equal(tokens.SPACING_INLINE, named.SPACING_INLINE);
  });
});
