import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { designTokens } from "@/lib/design-tokens";

const ROUTE_PATH = path.join(process.cwd(), "app", "_dev", "tokens.tsx");

function readRoute(): string {
  return readFileSync(ROUTE_PATH, "utf8");
}

describe("app/_dev/tokens preview route", () => {
  it("exists at the documented dev path", () => {
    const src = readRoute();
    assert.ok(src.length > 0, "expected dev tokens preview route to exist");
  });

  it("imports the full designTokens map (so every token is reachable)", () => {
    const src = readRoute();
    assert.match(
      src,
      /from\s+"@\/lib\/design-tokens"/,
      "must import tokens from the central design-tokens module",
    );
    assert.match(
      src,
      /\bdesignTokens\b/,
      "must reference the frozen `designTokens` map so future additions are auto-rendered",
    );
  });

  it("gates rendering behind isDevEnvironment()", () => {
    const src = readRoute();
    assert.match(
      src,
      /from\s+"@\/lib\/dev-menu"/,
      "must import the dev-environment helper from lib/dev-menu",
    );
    assert.match(
      src,
      /isDevEnvironment\s*\(\s*\)/,
      "must invoke isDevEnvironment() to gate the render",
    );
  });

  it("renders the geometry tokens too (radius + spacing)", () => {
    const src = readRoute();
    assert.match(src, /RADIUS_PILL/);
    assert.match(src, /RADIUS_CARD\b/);
    assert.match(src, /SPACING_LIST/);
    assert.match(src, /SPACING_CARD/);
  });

  it("has no inline hex literals (every colour routes through a token)", () => {
    const src = readRoute();
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(
      hexLiterals,
      [],
      `unexpected inline hex literals in tokens preview: ${hexLiterals.join(", ")}`,
    );
  });

  it("default-exports the route component (Expo Router contract)", () => {
    const src = readRoute();
    assert.match(
      src,
      /export\s+default\s+function\s+\w+/,
      "Expo Router routes must default-export a React component",
    );
  });

  it("covers every named colour token via the COLOR_GROUPS classifier or orphan bucket", () => {
    // Sanity-check the route ships at least one swatch per token. We import
    // the frozen map and assert each key matches at least one of the prefix
    // classes the route declares, OR falls into the orphan bucket which the
    // route always renders.
    const colorPrefixes = [
      "HERO_DARK",
      "AMBER_ACCENT",
      "AMBER_LIGHT",
      "AMBER_SOFT",
      "AMBER_MUTED",
      "ACCENT_DEEP",
      "CARD_BG",
      "PAGE_BG",
      "BORDER",
      "TEXT_DARK",
      "TEXT_ON_DARK",
      "MUTED",
      "PLACEHOLDER",
      "PURE_WHITE",
      "DANGER",
      "STATUS_",
      "SUCCESS_",
      "COOL_GRAY",
      "TAG_",
    ];
    const geometryPrefixes = ["RADIUS_", "SPACING_"];
    const colorEntries = Object.entries(designTokens).filter(
      ([, value]) => typeof value === "string",
    );
    const geometryEntries = Object.entries(designTokens).filter(
      ([, value]) => typeof value === "number",
    );
    // Every string token should match at least one colour prefix (the route
    // also has an orphan bucket but failing here would mean the prefix list
    // dropped a colour family — a real signal worth surfacing).
    const uncategorised = colorEntries.filter(
      ([name]) => !colorPrefixes.some((p) => name === p || name.startsWith(p)),
    );
    assert.deepEqual(
      uncategorised.map(([name]) => name),
      [],
      "every colour token must match one of the COLOR_GROUPS prefixes",
    );
    // Every numeric token must be a geometry one (the route splits radius +
    // spacing). If a third numeric family lands this test forces an update.
    const unknownNumeric = geometryEntries.filter(
      ([name]) => !geometryPrefixes.some((p) => name.startsWith(p)),
    );
    assert.deepEqual(
      unknownNumeric.map(([name]) => name),
      [],
      "every numeric token must belong to RADIUS_* or SPACING_* (else extend the route)",
    );
  });
});
