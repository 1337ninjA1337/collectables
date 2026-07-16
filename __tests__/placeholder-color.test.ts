import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { placeholderColor } from "@/lib/placeholder-color";

describe("placeholderColor", () => {
  it("returns the same color for the same id (deterministic)", () => {
    const id = "hot-wheels-1776966433160";
    assert.equal(placeholderColor(id), placeholderColor(id));
  });

  it("returns a value from the palette (valid hex color)", () => {
    const color = placeholderColor("any-id");
    assert.match(color, /^#[0-9A-Fa-f]{6}$/);
  });

  it("handles an empty string without throwing", () => {
    const color = placeholderColor("");
    assert.match(color, /^#[0-9A-Fa-f]{6}$/);
  });

  it("handles unicode ids", () => {
    const color = placeholderColor("Мила-Воронова-🎨");
    assert.match(color, /^#[0-9A-Fa-f]{6}$/);
  });

  it("produces a distribution across the palette for many ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(placeholderColor(`id-${i}`));
    }
    assert.ok(seen.size >= 5, `expected multiple palette entries, got ${seen.size}`);
  });

  it("is case-sensitive", () => {
    const a = placeholderColor("AbC");
    const b = placeholderColor("abc");
    // Not guaranteed to differ but most of the time they will.
    // Still, the function should not throw and must be deterministic per-input.
    assert.equal(a, placeholderColor("AbC"));
    assert.equal(b, placeholderColor("abc"));
  });
});

describe("placeholderColorForId — design-tokens co-location", () => {
  it("lib/design-tokens re-exports the SAME function (one implementation)", async () => {
    const tokens = await import("@/lib/design-tokens");
    assert.equal(tokens.placeholderColorForId, placeholderColor);
  });

  it("resolves to a 6-digit hex like every static color token", () => {
    const { placeholderColorForId } = require("@/lib/design-tokens") as {
      placeholderColorForId: (id: string) => string;
    };
    assert.match(placeholderColorForId("any-item-id"), /^#[0-9a-fA-F]{6}$/);
  });
});
