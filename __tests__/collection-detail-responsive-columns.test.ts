import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Responsive masonry column count (Masonry VM-B follow-up): the viewer
 * FlatList in `app/collection/[id].tsx` renders 2 columns on mobile (and
 * always on native — `useResponsive`'s tablet/desktop breakpoints are
 * web-only), 3 on tablet, 4 on desktop. Three wiring legs must agree on the
 * SAME `masonryColumnCount` value or the grid silently corrupts:
 *
 *   1. `numColumns={masonryColumnCount}` — the actual column layout.
 *   2. `getMasonryRowLayout` divides item index by `masonryColumnCount`
 *      (and lists it in its useCallback deps) — a drifted divisor makes
 *      virtualization scroll to wrong offsets on wide layouts.
 *   3. The FlatList `key` embeds the count — React Native throws
 *      "Changing numColumns on the fly is not supported" on a mounted
 *      list, so a breakpoint flip (web window resize) must remount.
 *
 * The source file pulls in react-native peers and can't be loaded under
 * `node --test`, so the assertions are regex-based like the sibling
 * collection-detail pins.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("app/collection/[id].tsx — responsive masonry column count", () => {
  it("imports useResponsive from @/components/screen", () => {
    const src = readSrc();
    assert.match(src, /import\s*\{[^}]*\buseResponsive\b[^}]*\}\s*from\s*"@\/components\/screen"/);
  });

  it("derives masonryColumnCount as isDesktop ? 4 : isTablet ? 3 : 2", () => {
    const src = readSrc();
    // The breakpoint→count mapping is the contract: 2 stays the mobile and
    // native default (both flags are false off-web), tablet widens to 3,
    // desktop to 4. Any other shape (e.g. width math inline) should be a
    // deliberate rewrite of this pin, not a drive-by.
    assert.match(src, /const\s*\{\s*isTablet\s*,\s*isDesktop\s*\}\s*=\s*useResponsive\(\)/);
    assert.match(src, /const\s+masonryColumnCount\s*=\s*isDesktop\s*\?\s*4\s*:\s*isTablet\s*\?\s*3\s*:\s*2/);
  });

  it("masonryColumnCount is derived above the early returns (hooks run unconditionally)", () => {
    const src = readSrc();
    const declIdx = src.indexOf("const masonryColumnCount");
    const earlyReturnIdx = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(
      declIdx !== -1 && earlyReturnIdx !== -1 && declIdx < earlyReturnIdx,
      "useResponsive()/masonryColumnCount must sit above the loading early return",
    );
  });

  it("the viewer FlatList consumes masonryColumnCount for numColumns — no literal column count", () => {
    const src = readSrc();
    assert.match(src, /<FlatList[\s\S]*?numColumns=\{\s*masonryColumnCount\s*\}[\s\S]*?\/>/);
    // The pre-responsive literal must not come back on any list.
    assert.doesNotMatch(src, /numColumns=\{\s*\d+\s*\}/);
  });

  it("the viewer FlatList key embeds the column count so a breakpoint flip remounts the list", () => {
    const src = readSrc();
    // RN forbids changing numColumns on a mounted list; the key is the
    // documented escape hatch. It must live on the SAME FlatList block that
    // carries numColumns.
    const viewerBlock = src.match(/<FlatList[\s\S]*?numColumns=\{\s*masonryColumnCount\s*\}[\s\S]*?\/>/);
    assert.ok(viewerBlock, "viewer FlatList (numColumns={masonryColumnCount}) not found");
    assert.match(viewerBlock![0], /key=\{\s*`viewer-masonry-\$\{masonryColumnCount\}`\s*\}/);
  });

  it("getMasonryRowLayout divides by masonryColumnCount and lists it in its deps", () => {
    const src = readSrc();
    // Leg 2 of the agreement: the virtualization offset math must divide by
    // the same value numColumns consumes. The dep entry keeps the callback
    // honest when a resize changes the count.
    assert.match(src, /Math\.floor\(index\s*\/\s*masonryColumnCount\)/);
    assert.match(
      src,
      /const\s+getMasonryRowLayout\s*=\s*useCallback\([\s\S]*?\[\s*viewerHeaderHeight\s*,\s*masonryColumnCount\s*\]\s*,?\s*\)/,
    );
    // No hard-coded divisor may survive anywhere in the row math.
    assert.doesNotMatch(src, /Math\.floor\(index\s*\/\s*\d/);
  });
});
