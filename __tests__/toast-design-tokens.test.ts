import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { luminance } from "@/lib/color-luminance";
import {
  AMBER_ACCENT,
  AMBER_SOFT_3,
  CARD_BG_15,
  DANGER_DEEP_7,
  DANGER_DEEP_8,
  DANGER_SOFT_6,
  DANGER_SOFT_7,
  HERO_DARK_2,
  HERO_DARK_9,
  SUCCESS_DEEP,
  SUCCESS_GREEN_3,
  SUCCESS_SOFT,
  SUCCESS_SOFT_2,
  designTokens,
} from "@/lib/design-tokens";
import { HEX_ALLOWLIST, findInlineHexLiterals } from "@/lib/check-inline-hex";

/**
 * `lib/toast-context.tsx` design-tokens migration (2026-08-09).
 *
 * The toast host carried the last standing block of un-tokenised colour in the
 * app: a 3×4 `PALETTES` table plus a shadow colour, 13 hex literals in total,
 * held under an explicit `HEX_ALLOWLIST` exemption. Three of the values were
 * already named elsewhere in the palette (`AMBER_SOFT_3`, `AMBER_ACCENT`,
 * `HERO_DARK_2`) and were drifting free of it, which is what the batch-migrate
 * task was filed for; the remaining nine got tokens of their own so the file
 * could come off the allowlist entirely.
 *
 * The provider pulls react-native's `Animated` and cannot be mounted under
 * `tsx --test`, so adoption is pinned at the source level — plus the real
 * guarantee, which is that the hex lint now covers the file.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const HEX = /^#[0-9a-f]{6}$/;

describe("tokens shipped for the toast migration", () => {
  it("declares the nine new values and exports them from the aggregate", () => {
    const expected: Record<string, string> = {
      CARD_BG_15: "#fff4e0",
      DANGER_SOFT_6: "#fbe7e1",
      DANGER_SOFT_7: "#f0b8ac",
      DANGER_DEEP_7: "#c94a2a",
      DANGER_DEEP_8: "#3d1a11",
      SUCCESS_GREEN_3: "#5f9a2f",
      SUCCESS_SOFT: "#c5e39a",
      SUCCESS_SOFT_2: "#eef7e0",
      SUCCESS_DEEP: "#2a3b16",
    };
    const named: Record<string, string> = {
      CARD_BG_15,
      DANGER_SOFT_6,
      DANGER_SOFT_7,
      DANGER_DEEP_7,
      DANGER_DEEP_8,
      SUCCESS_GREEN_3,
      SUCCESS_SOFT,
      SUCCESS_SOFT_2,
      SUCCESS_DEEP,
    };
    for (const [name, value] of Object.entries(expected)) {
      assert.match(value, HEX, `${name} is not a 6-digit lowercase hex`);
      assert.equal(named[name], value, `${name} drifted`);
      assert.equal(
        (designTokens as Record<string, unknown>)[name],
        value,
        `${name} is missing from the designTokens aggregate`,
      );
    }
  });

  it("introduces no value that an existing token already carried", () => {
    // A second name for an existing hex is how a family quietly loses its
    // meaning — a later rebrand edits one name and not the other. Scoped to the
    // nine new tokens on purpose: the palette already contains a few historical
    // aliases (e.g. TEXT_ON_DARK / CARD_BG_2), and retiring those is its own
    // task rather than something to smuggle into a toast migration.
    const colors = (Object.entries(designTokens) as [string, unknown][]).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    const NEW_NAMES = [
      "CARD_BG_15",
      "DANGER_SOFT_6",
      "DANGER_SOFT_7",
      "DANGER_DEEP_7",
      "DANGER_DEEP_8",
      "SUCCESS_GREEN_3",
      "SUCCESS_SOFT",
      "SUCCESS_SOFT_2",
      "SUCCESS_DEEP",
    ];
    for (const name of NEW_NAMES) {
      const value = (designTokens as Record<string, unknown>)[name] as string;
      const aliases = colors
        .filter(([other, otherValue]) => other !== name && otherValue === value)
        .map(([other]) => other);
      assert.deepEqual(
        aliases,
        [],
        `${name} (${value}) duplicates ${aliases.join(", ")} — reuse the existing token instead`,
      );
    }
  });

  it("orders each new soft/deep pair the way its family name claims", () => {
    // `_SOFT` must be lighter than `_DEEP` within a family, otherwise the
    // suffix stops describing the value and the next contributor picks wrong.
    assert.ok(
      luminance(DANGER_SOFT_6) > luminance(DANGER_SOFT_7),
      "DANGER_SOFT_6 (surface) should be lighter than DANGER_SOFT_7 (border)",
    );
    assert.ok(
      luminance(DANGER_SOFT_7) > luminance(DANGER_DEEP_7),
      "DANGER_SOFT_7 (border) should be lighter than DANGER_DEEP_7 (accent)",
    );
    assert.ok(
      luminance(DANGER_DEEP_7) > luminance(DANGER_DEEP_8),
      "DANGER_DEEP_7 (accent) should be lighter than DANGER_DEEP_8 (text)",
    );
    assert.ok(
      luminance(SUCCESS_SOFT_2) > luminance(SUCCESS_SOFT),
      "SUCCESS_SOFT_2 (surface) should be lighter than SUCCESS_SOFT (border)",
    );
    assert.ok(
      luminance(SUCCESS_SOFT) > luminance(SUCCESS_GREEN_3),
      "SUCCESS_SOFT (border) should be lighter than SUCCESS_GREEN_3 (accent)",
    );
    assert.ok(
      luminance(SUCCESS_GREEN_3) > luminance(SUCCESS_DEEP),
      "SUCCESS_GREEN_3 (accent) should be lighter than SUCCESS_DEEP (text)",
    );
  });
});

describe("lib/toast-context.tsx adoption", () => {
  const source = read("lib/toast-context.tsx");

  it("carries no inline hex literal at all", () => {
    // The real guarantee. `findInlineHexLiterals` is the same matcher
    // `npm run lint:hex` runs, so this fails the moment a colour is re-inlined.
    assert.deepEqual(findInlineHexLiterals("lib/toast-context.tsx", source), []);
  });

  it("is no longer exempt from the hex lint", () => {
    assert.ok(
      !HEX_ALLOWLIST.has("lib/toast-context.tsx"),
      "the toast palette is tokenised — its allowlist exemption must be gone",
    );
  });

  it("imports every token the palette and shadow reference", () => {
    for (const name of [
      "AMBER_ACCENT",
      "AMBER_SOFT_3",
      "CARD_BG_15",
      "DANGER_DEEP_7",
      "DANGER_DEEP_8",
      "DANGER_SOFT_6",
      "DANGER_SOFT_7",
      "HERO_DARK_2",
      "HERO_DARK_9",
      "SUCCESS_DEEP",
      "SUCCESS_GREEN_3",
      "SUCCESS_SOFT",
      "SUCCESS_SOFT_2",
    ]) {
      assert.match(
        source,
        new RegExp(`^\\s+${name},$`, "m"),
        `${name} is not imported from @/lib/design-tokens`,
      );
    }
  });

  it("maps each toast type to the tokens its role calls for", () => {
    // Pinned per-slot rather than per-file so a copy-paste that gives the error
    // toast the success accent is caught, not just a missing import.
    assert.match(
      source,
      /success: \{\s*bg: SUCCESS_SOFT_2,\s*border: SUCCESS_SOFT,\s*accent: SUCCESS_GREEN_3,\s*text: SUCCESS_DEEP,/,
    );
    assert.match(
      source,
      /error: \{\s*bg: DANGER_SOFT_6,\s*border: DANGER_SOFT_7,\s*accent: DANGER_DEEP_7,\s*text: DANGER_DEEP_8,/,
    );
    assert.match(
      source,
      /info: \{\s*bg: CARD_BG_15,\s*border: AMBER_SOFT_3,\s*accent: AMBER_ACCENT,\s*text: HERO_DARK_2,/,
    );
    assert.match(source, /shadowColor: HERO_DARK_9,/);
  });

  it("still declares all three toast types, so no palette slot was dropped", () => {
    assert.match(source, /export type ToastType = "success" \| "error" \| "info";/);
    for (const type of ["success", "error", "info"]) {
      assert.ok(source.includes(`${type}: {`), `PALETTES lost the ${type} entry`);
    }
  });
});

describe("AMBER_SOFT_3 has no inline consumers left", () => {
  it("is referenced by name in both of its call sites", () => {
    // The batch-migrate task this closes named three consumers; empty-state was
    // already migrated, leaving the toast palette as the last inline copy.
    for (const rel of ["components/empty-state.tsx", "lib/toast-context.tsx"]) {
      const src = read(rel);
      assert.ok(
        src.includes("AMBER_SOFT_3"),
        `${rel} should reference AMBER_SOFT_3 by name`,
      );
      assert.ok(
        !src.includes(AMBER_SOFT_3),
        `${rel} still inlines ${AMBER_SOFT_3}`,
      );
    }
  });
});
