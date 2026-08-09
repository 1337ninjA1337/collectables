import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { luminance, rgbChannels } from "@/lib/color-luminance";
import {
  COOL_GRAY,
  COOL_GRAY_DARK,
  COOL_GRAY_LIGHT,
  STATUS_OFFLINE,
  designTokens,
} from "@/lib/design-tokens";

/**
 * The `COOL_*` family — the palette's only deliberately non-warm axis.
 *
 * `COOL_GRAY` shipped alone with the settings diagnostics toggle, which made it
 * a one-off: the next neutral surface had nothing to reach for and would either
 * invent a second grey or borrow a warm `MUTED_*` and read as a brand accent.
 * The light/dark pair turns it into an axis, and these tests are what keep it
 * one — a family whose ordering and hue are conventions in a comment drifts the
 * first time someone appends a fourth value.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const HEX = /^#[0-9a-f]{6}$/;

/** Non-null channel read — every value in this file is a checked 6-digit hex. */
function rgb(hex: string): [number, number, number] {
  const channels = rgbChannels(hex);
  assert.ok(channels, `${hex} is not a hex colour`);
  return channels;
}

const FAMILY = [
  ["COOL_GRAY_LIGHT", COOL_GRAY_LIGHT, "#cbd5e1"],
  ["COOL_GRAY", COOL_GRAY, "#94a3b8"],
  ["COOL_GRAY_DARK", COOL_GRAY_DARK, "#64748b"],
] as const;

describe("COOL_* token declarations", () => {
  it("declares all three shades and exports them from the aggregate", () => {
    for (const [name, value, expected] of FAMILY) {
      assert.match(value, HEX, `${name} is not a 6-digit lowercase hex`);
      assert.equal(value, expected, `${name} drifted`);
      assert.equal(
        (designTokens as Record<string, unknown>)[name],
        expected,
        `${name} is missing from the designTokens aggregate`,
      );
    }
  });

  it("keeps COOL_GRAY at its original value so the diagnostics toggle is untouched", () => {
    // The family was added around an existing token; changing it would be a
    // visual change to settings that nobody asked for.
    assert.equal(COOL_GRAY, "#94a3b8");
  });
});

describe("COOL_* family conventions", () => {
  it("darkens monotonically from _LIGHT through the base to _DARK", () => {
    assert.ok(
      luminance(COOL_GRAY_LIGHT) > luminance(COOL_GRAY),
      "COOL_GRAY_LIGHT must be lighter than COOL_GRAY",
    );
    assert.ok(
      luminance(COOL_GRAY) > luminance(COOL_GRAY_DARK),
      "COOL_GRAY must be lighter than COOL_GRAY_DARK",
    );
  });

  it("is actually cool-toned — blue channel above red on every shade", () => {
    // This is the whole reason the family exists. A warm grey here would make
    // the axis indistinguishable from MUTED_* and quietly defeat its purpose.
    for (const [name, value] of FAMILY) {
      const [r, g, b] = rgb(value);
      assert.ok(b > r, `${name} (${value}) is not cool-toned: blue ${b} <= red ${r}`);
      assert.ok(b > g, `${name} (${value}) is not cool-toned: blue ${b} <= green ${g}`);
    }
  });

  it("steps evenly enough that adjacent shades stay distinguishable", () => {
    // Tailwind slate-300/400/500 are one ramp step apart each. A future insert
    // that lands 4 units from its neighbour would be invisible on screen while
    // still passing the monotonicity check above.
    const light = luminance(COOL_GRAY_LIGHT);
    const base = luminance(COOL_GRAY);
    const dark = luminance(COOL_GRAY_DARK);
    assert.ok(light - base > 20, `COOL_GRAY_LIGHT → COOL_GRAY step too small (${light - base})`);
    assert.ok(base - dark > 20, `COOL_GRAY → COOL_GRAY_DARK step too small (${base - dark})`);
  });

  it("does not collide with STATUS_OFFLINE, which stays warm on purpose", () => {
    // The suggestion that filed this family proposed a `COOL_OFFLINE`. Offline
    // is a warning state, not a neutral one, so its colour is amber and belongs
    // to STATUS_*; pinning the distinction stops the two roles merging later.
    const [r, , b] = rgb(STATUS_OFFLINE);
    assert.ok(r > b, "STATUS_OFFLINE should stay warm (red above blue)");
    for (const [name, value] of FAMILY) {
      assert.notEqual(value, STATUS_OFFLINE, `${name} aliases STATUS_OFFLINE`);
    }
  });

  it("introduces no value another token already carried", () => {
    const colors = (Object.entries(designTokens) as [string, unknown][]).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    for (const [name, value] of FAMILY) {
      const aliases = colors
        .filter(([other, otherValue]) => other !== name && otherValue === value)
        .map(([other]) => other);
      assert.deepEqual(
        aliases,
        [],
        `${name} (${value}) duplicates ${aliases.join(", ")} — reuse the existing token`,
      );
    }
  });
});

describe("COOL_* discoverability", () => {
  it("is documented in the palette's naming-convention header", () => {
    // The header lists every family prefix; a family absent from it is one the
    // next contributor will not know to reach for.
    assert.match(read("lib/design-tokens.ts"), /^ \*\s+`COOL_\*`\s+—/m);
  });

  it("declares the family light → dark in source order", () => {
    const src = read("lib/design-tokens.ts");
    const at = (name: string) => src.indexOf(`export const ${name} =`);
    assert.ok(at("COOL_GRAY_LIGHT") > 0, "COOL_GRAY_LIGHT is not declared");
    assert.ok(
      at("COOL_GRAY_LIGHT") < at("COOL_GRAY"),
      "declare COOL_GRAY_LIGHT before COOL_GRAY so the ramp reads light → dark",
    );
    assert.ok(
      at("COOL_GRAY") < at("COOL_GRAY_DARK"),
      "declare COOL_GRAY before COOL_GRAY_DARK so the ramp reads light → dark",
    );
  });

  it("lands in the dev token-preview route via its existing COOL_GRAY prefix", () => {
    // `app/_dev/tokens.tsx` groups by prefix, so the two new shades are picked
    // up without editing the route — this pins that the prefix is still there.
    assert.match(read("app/_dev/tokens.tsx"), /"COOL_GRAY"/);
  });
});
