/**
 * Pins the shared `TAG_COLORS` rotation (promoted to `lib/design-tokens.ts`
 * on 2026-08-07) and the 3/4-digit shorthand half of the inline-hex gate.
 *
 * Both concerns come from the same `.tasks/.tasks.md` block:
 *
 *  - The rotation used to be duplicated character-for-character between
 *    `app/create.tsx` and `app/item/[id].tsx`. A tweak to one copy (an 11th
 *    hue, a re-ordered slot) would silently make the new-item form and the
 *    item-edit form assign different colours to the same tag position, so the
 *    array now has exactly one definition and both screens import it.
 *
 *  - The per-file design-tokens sweeps assert "no inline hex" with a 6-digit
 *    `#[0-9a-fA-F]{6}` regex, which by construction cannot see a `"#fff"`
 *    shorthand. `lib/check-inline-hex.ts` grew a quoted 3/4-digit pattern to
 *    close that gap; these cases pin that the pattern is wired into the same
 *    scanner the `lint:hex` script runs, and that the two screens carrying the
 *    tag palette hold at zero shorthands of any width.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMBER_ACCENT,
  TAG_BLUE,
  TAG_BROWN,
  TAG_COLORS,
  TAG_CYAN,
  TAG_GOLD,
  TAG_PURPLE,
  TAG_RUST,
  TAG_SAGE,
  TAG_TEAL,
  TAG_TERRACOTTA,
  nextTagColor,
} from "@/lib/design-tokens";
import {
  INLINE_HEX_SHORT_PATTERN,
  findInlineHexLiterals,
  isHexAllowlisted,
} from "@/lib/check-inline-hex";
import { readRepoFile as read } from "./helpers/repo-file";

const TAG_CONSUMERS = ["app/create.tsx", "app/item/[id].tsx"] as const;

describe("TAG_COLORS shared rotation", () => {
  it("exposes the 10-slot rotation in its documented order", () => {
    assert.deepEqual(
      [...TAG_COLORS],
      [
        AMBER_ACCENT,
        TAG_RUST,
        TAG_SAGE,
        TAG_BLUE,
        TAG_PURPLE,
        TAG_TERRACOTTA,
        TAG_CYAN,
        TAG_GOLD,
        TAG_BROWN,
        TAG_TEAL,
      ],
    );
  });

  it("keeps the brand accent in the first slot", () => {
    // The first tag a user adds gets the brand accent; downstream screenshots
    // and the onboarding copy both assume that.
    assert.equal(TAG_COLORS[0], AMBER_ACCENT);
  });

  it("has no duplicate hues, so 10 consecutive tags all look different", () => {
    assert.equal(new Set(TAG_COLORS).size, TAG_COLORS.length);
  });

  it("is defined exactly once across app/, components/ and lib/", () => {
    const definitions = [
      "lib/design-tokens.ts",
      ...TAG_CONSUMERS,
    ].filter((file) => /(?:^|\n)(?:export )?const TAG_COLORS\b/.test(read(file)));
    assert.deepEqual(
      definitions,
      ["lib/design-tokens.ts"],
      "TAG_COLORS must have a single definition — re-inlining a copy re-opens the drift class",
    );
  });

  for (const file of TAG_CONSUMERS) {
    it(`${file} reaches the palette through nextTagColor, not the 9 hues`, () => {
      const src = read(file);
      assert.match(src, /\bnextTagColor\b/);
      for (const hue of [
        "TAG_RUST",
        "TAG_SAGE",
        "TAG_BLUE",
        "TAG_PURPLE",
        "TAG_TERRACOTTA",
        "TAG_CYAN",
        "TAG_GOLD",
        "TAG_BROWN",
        "TAG_TEAL",
      ]) {
        assert.doesNotMatch(
          src,
          new RegExp(`\\b${hue}\\b`),
          `${file} should reach the tag palette through TAG_COLORS, not ${hue}`,
        );
      }
    });

    it(`${file} feeds nextTagColor the colours already in use`, () => {
      // Passing the used colours (rather than a count) is what makes the
      // delete-then-add case pick an unused hue.
      assert.match(
        read(file),
        /nextTagColor\((?:edit)?[Tt]ags\.map\(\(tag\) => tag\.color\)\)/,
      );
    });

    it(`${file} adds a tag through a single shared handler`, () => {
      // Both screens had (or, in create.tsx, duplicated) the same
      // trim → dedupe → append ceremony; one `addTag()` per screen now.
      const src = read(file);
      assert.equal(
        (src.match(/\bfunction addTag\(\)/g) ?? []).length,
        1,
        "expected exactly one addTag() definition per screen",
      );
      assert.equal(
        (src.match(/\bsetTags\(\[|\bsetEditTags\(\[/g) ?? []).length,
        1,
        "a second inline tag-append path re-opens the drift this consolidated",
      );
    });
  }
});

describe("nextTagColor", () => {
  it("hands out the brand accent to the very first tag", () => {
    assert.equal(nextTagColor([]), AMBER_ACCENT);
  });

  it("walks the rotation while colours are unused", () => {
    assert.equal(nextTagColor([AMBER_ACCENT]), TAG_RUST);
    assert.equal(nextTagColor([AMBER_ACCENT, TAG_RUST]), TAG_SAGE);
  });

  it("skips a gap left by a deleted tag instead of repeating a visible hue", () => {
    // Add 3 tags, delete the 2nd (TAG_RUST), add a 4th. Naive
    // `TAG_COLORS[length % 10]` indexing would return TAG_SAGE — the colour
    // the surviving 3rd tag is already wearing.
    const afterDelete = [AMBER_ACCENT, TAG_SAGE];
    assert.equal(nextTagColor(afterDelete), TAG_RUST);
    assert.notEqual(nextTagColor(afterDelete), TAG_SAGE);
  });

  it("never returns a colour that is already in use while slots remain", () => {
    for (let used = 0; used < TAG_COLORS.length; used++) {
      const inUse = TAG_COLORS.slice(0, used);
      assert.ok(!inUse.includes(nextTagColor(inUse) as (typeof TAG_COLORS)[number]));
    }
  });

  it("falls back to the modulo rotation once all 10 slots are taken", () => {
    assert.equal(nextTagColor([...TAG_COLORS]), AMBER_ACCENT);
    assert.equal(nextTagColor([...TAG_COLORS, AMBER_ACCENT]), TAG_RUST);
  });

  it("tolerates colours outside the palette (legacy/imported tags)", () => {
    // Items synced from an older build can carry a hue that is no longer in
    // the rotation; it must not shift the pick or throw.
    assert.equal(nextTagColor(["#123456"]), AMBER_ACCENT);
    assert.equal(nextTagColor(["#123456", AMBER_ACCENT]), TAG_RUST);
  });

  it("is pure — the input array is never mutated", () => {
    const used = [AMBER_ACCENT, TAG_RUST];
    nextTagColor(used);
    assert.deepEqual(used, [AMBER_ACCENT, TAG_RUST]);
  });
});

describe("inline-hex gate covers 3/4-digit shorthands", () => {
  it("flags a quoted #fff that the 6-digit pattern cannot see", () => {
    const source = 'const s = { color: "#fff" };';
    assert.deepEqual((source.match(/#[0-9a-fA-F]{6}/g) ?? []), []);
    const matches = findInlineHexLiterals("app/example.tsx", source);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].value, "#fff");
    // Column points at the `#`, not at the opening quote.
    assert.equal(source[matches[0].column - 1], "#");
  });

  it("flags a 4-digit shorthand with alpha", () => {
    const matches = findInlineHexLiterals("app/example.tsx", "borderColor: '#fffa',");
    assert.deepEqual(matches.map((m) => m.value), ["#fffa"]);
  });

  it("ignores unquoted shorthands in prose so comments never false-positive", () => {
    const source = "// see issue #15b and the old #fff treatment";
    assert.deepEqual(findInlineHexLiterals("app/example.tsx", source), []);
  });

  it("still honours the allowlist for shorthands", () => {
    assert.ok(isHexAllowlisted("lib/design-tokens.ts"));
    assert.deepEqual(
      findInlineHexLiterals("lib/design-tokens.ts", 'const x = "#fff";'),
      [],
    );
  });

  it("requires matching quotes, so a template-literal boundary is not a match", () => {
    const re = new RegExp(INLINE_HEX_SHORT_PATTERN.source, "g");
    assert.equal(re.test("\"#fff'"), false);
  });

  for (const file of TAG_CONSUMERS) {
    it(`${file} carries zero hex literals of any width`, () => {
      // The per-file sweeps only pin the 6-digit half; this pins the whole
      // scanner (both patterns) over the two tag-palette screens.
      const matches = findInlineHexLiterals(file, read(file));
      assert.deepEqual(
        matches.map((m) => `${m.line}:${m.column} ${m.value}`),
        [],
      );
    });
  }
});
