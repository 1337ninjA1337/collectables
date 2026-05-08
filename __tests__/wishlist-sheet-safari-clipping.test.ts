import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Regression test for the Safari-only bug where the bottom of the wishlist
 * "Add" sheet was clipped — the inner Pressable / ScrollView didn't flex
 * inside the 90%-of-parent maxHeight, and the iOS home-indicator area
 * occluded the action row.
 *
 * The fix relies on three coordinated changes that this test pins down:
 *   1. `useSafeAreaInsets()` + `useWindowDimensions()` are read so the
 *      sheet height is recomputed on Safari address-bar collapse / orientation
 *      change instead of relying on a static "90%" stylesheet rule.
 *   2. Inline `maxHeight` + `paddingBottom: insets.bottom` are applied to the
 *      Animated.View so the home indicator never overlaps the buttons.
 *   3. The inner Pressable + ScrollView use `flex: 1, minHeight: 0` so they
 *      shrink within the bounded sheet instead of overflowing past it.
 */
describe("app/wishlist.tsx — Safari bottom-clipping fix", () => {
  const src = read("app/wishlist.tsx");

  it("reads useSafeAreaInsets() to honour the iOS home indicator", () => {
    assert.match(
      src,
      /import\s*\{\s*useSafeAreaInsets\s*\}\s*from\s*["']react-native-safe-area-context["']/,
      "wishlist must import useSafeAreaInsets",
    );
    assert.match(
      src,
      /const\s+insets\s*=\s*useSafeAreaInsets\(\)/,
      "wishlist must invoke useSafeAreaInsets() inside the component",
    );
  });

  it("reads useWindowDimensions() so the cap reacts to Safari address-bar collapse", () => {
    assert.match(
      src,
      /useWindowDimensions/,
      "wishlist must import useWindowDimensions from react-native",
    );
    assert.match(
      src,
      /const\s*\{\s*height:\s*windowHeight\s*\}\s*=\s*useWindowDimensions\(\)/,
      "wishlist must read windowHeight via useWindowDimensions()",
    );
  });

  it("computes a viewport-relative cap with a non-zero floor and bottom-inset slice", () => {
    assert.match(
      src,
      /sheetMaxHeight\s*=\s*Math\.max\([^,]+,\s*windowHeight\s*\*\s*0\.9\s*-\s*insets\.bottom\s*\)/,
      "sheetMaxHeight must be Math.max(floor, windowHeight*0.9 - insets.bottom) so iOS Safari's dynamic viewport drives the cap",
    );
  });

  it("applies the runtime-computed maxHeight + safe-area paddingBottom inline on the sheet", () => {
    // The Animated.View style array must contain BOTH `maxHeight: sheetMaxHeight`
    // and `paddingBottom: 20 + insets.bottom` so the home indicator clearance
    // tracks the user's device.
    const sheetIdx = src.indexOf("style={[\n              styles.sheet,");
    assert.ok(sheetIdx >= 0, "Animated.View style array not found in expected shape");
    const block = src.slice(sheetIdx, sheetIdx + 600);
    assert.match(
      block,
      /maxHeight:\s*sheetMaxHeight/,
      "sheet must apply the runtime-computed maxHeight inline",
    );
    assert.match(
      block,
      /paddingBottom:\s*20\s*\+\s*insets\.bottom/,
      "sheet must pad the bottom by `20 + insets.bottom` so the home indicator never occludes the actions",
    );
  });

  it("removes the static `maxHeight: \"90%\"` from the sheet stylesheet so the inline cap wins", () => {
    // The stylesheet `sheet` rule must NOT carry a static `maxHeight: "90%"`
    // — that conflicts with the runtime cap and is what triggered the
    // Safari-specific clipping in the first place.
    const sheetStyleIdx = src.indexOf("  sheet: {");
    const styleEnd = src.indexOf("  },", sheetStyleIdx);
    const sheetStyleBlock = src.slice(sheetStyleIdx, styleEnd);
    assert.doesNotMatch(
      sheetStyleBlock,
      /maxHeight:\s*["']90%["']/,
      "stylesheet `sheet` rule must not carry a static maxHeight: '90%' — the runtime computation owns it now",
    );
  });

  it("declares sheetInner + sheetScrollView styles with `flex: 1, minHeight: 0`", () => {
    // Without `minHeight: 0` on the flex children, Safari refuses to shrink
    // them inside the bounded ancestor — overflow returns and the actions
    // disappear below the fold again.
    const inner = src.match(
      /sheetInner:\s*\{[^}]*flex:\s*1[^}]*minHeight:\s*0[^}]*\}/,
    );
    assert.ok(
      inner,
      "sheetInner style must declare both flex: 1 and minHeight: 0 for Safari to honour the bound",
    );
    const scroll = src.match(
      /sheetScrollView:\s*\{[^}]*flex:\s*1[^}]*minHeight:\s*0[^}]*\}/,
    );
    assert.ok(
      scroll,
      "sheetScrollView style must declare both flex: 1 and minHeight: 0 for the scroll area to shrink",
    );
  });

  it("attaches the new flex styles to the inner Pressable and ScrollView", () => {
    assert.match(
      src,
      /<Pressable\s+style=\{styles\.sheetInner\}/,
      "the inner Pressable wrapping the sheet content must use styles.sheetInner",
    );
    assert.match(
      src,
      /<ScrollView[\s\S]*?style=\{styles\.sheetScrollView\}/,
      "the ScrollView inside the sheet must use styles.sheetScrollView",
    );
  });
});
