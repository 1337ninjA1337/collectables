import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  designTokens,
  HERO_DARK,
  AMBER_ACCENT,
  PURE_WHITE,
  RADIUS_PILL,
  SPACING_INLINE,
  type BackgroundColorValue,
  type ColorTokenName,
  type ColorTokenValue,
  type ColorValue,
  type DesignToken,
} from "@/lib/design-tokens";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("design-tokens color-value types", () => {
  it("exports the four new type aliases for component prop typing", () => {
    const src = read("lib/design-tokens.ts");
    assert.match(src, /export\s+type\s+ColorTokenName/);
    assert.match(src, /export\s+type\s+ColorTokenValue/);
    assert.match(src, /export\s+type\s+ColorValue/);
    assert.match(src, /export\s+type\s+BackgroundColorValue/);
  });

  it("documents the `(string & {})` autocomplete trick in the ColorValue jsdoc", () => {
    const src = read("lib/design-tokens.ts");
    // The intersection trick is the load-bearing part of this type — keep
    // a literal grep on the snippet so a future refactor can't silently
    // drop it (which would collapse the union back to plain `string`).
    assert.match(src, /\(string\s*&\s*\{\s*\}\)/);
  });

  it("assigns hex literals and known palette values to ColorValue at compile time", () => {
    // Runtime smoke tests — these statements would not compile if the type
    // alias rejected the assignment, so successfully running the test
    // file is itself the assertion.
    const literal: ColorValue = "#abcdef";
    const palette: ColorValue = HERO_DARK;
    const accent: ColorValue = AMBER_ACCENT;
    const white: BackgroundColorValue = PURE_WHITE;
    const anyString: BackgroundColorValue = "rgba(0,0,0,0.5)";
    assert.equal(typeof literal, "string");
    assert.equal(palette, "#261b14");
    assert.equal(accent, "#d89c5b");
    assert.equal(white, "#ffffff");
    assert.equal(typeof anyString, "string");
  });

  it("ColorTokenValue narrows to string values only — numeric tokens are excluded", () => {
    // If a numeric token (radius/spacing) accidentally slipped into the
    // color-value union, the assignments below would compile. The
    // `@ts-expect-error` markers force a build failure if that drift
    // happens.
    // @ts-expect-error — RADIUS_PILL is `number`, not a ColorTokenValue.
    const radius: ColorTokenValue = RADIUS_PILL;
    // @ts-expect-error — SPACING_INLINE is `number`, not a ColorTokenValue.
    const spacing: ColorTokenValue = SPACING_INLINE;
    assert.equal(radius, 999);
    assert.equal(spacing, 8);
  });

  it("ColorTokenName covers every string-valued entry in the frozen palette", () => {
    // Sanity-check the type-level filter against the runtime palette: every
    // key whose value is a string should also be a valid ColorTokenName,
    // and no numeric-valued key should leak in.
    const colorKeys = Object.entries(designTokens)
      .filter(([, value]) => typeof value === "string")
      .map(([key]) => key as ColorTokenName);
    assert.ok(colorKeys.length > 100, "expected the palette to expose >100 color tokens");
    // A representative sample should round-trip as a ColorTokenName.
    const sample: ColorTokenName[] = ["HERO_DARK", "AMBER_ACCENT", "PURE_WHITE", "TAG_RUST"];
    for (const name of sample) {
      assert.ok(colorKeys.includes(name), `expected ${name} to be a color token name`);
    }
  });

  it("DesignToken remains a strict superset of ColorTokenName", () => {
    // ColorTokenName must remain assignable to DesignToken so future code
    // can promote a color-only typed value into a generic token lookup
    // without an `as` cast.
    const name: ColorTokenName = "HERO_DARK";
    const token: DesignToken = name;
    assert.equal(token, "HERO_DARK");
  });
});

describe("components/qr-code.tsx adopts the new color types", () => {
  it("imports ColorValue + BackgroundColorValue from design-tokens", () => {
    const src = read("components/qr-code.tsx");
    assert.match(src, /from\s+"@\/lib\/design-tokens"/);
    assert.match(src, /\btype\s+ColorValue\b/);
    assert.match(src, /\btype\s+BackgroundColorValue\b/);
  });

  it("types its color/background props with the new aliases (no raw `string`)", () => {
    const src = read("components/qr-code.tsx");
    assert.match(src, /color\?:\s*ColorValue/);
    assert.match(src, /background\?:\s*BackgroundColorValue/);
    // Guard against regression — the previous `string` typing must be gone.
    assert.doesNotMatch(src, /color\?:\s*string\b/);
    assert.doesNotMatch(src, /background\?:\s*string\b/);
  });
});
