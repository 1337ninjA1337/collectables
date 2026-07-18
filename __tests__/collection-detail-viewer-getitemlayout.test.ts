import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Viewer-branch FlatList `getItemLayout` pins: the 2-column masonry rows are
 * fixed-height, so FlatList is handed the geometry up-front and skips the
 * per-row onLayout measurement pass. Mirrors the selection-branch
 * `getSelectableRowLayout` shape (measured ListHeaderComponent + row-gap
 * stride) with two viewer-specific twists:
 *
 *   1. `numColumns={2}` — FlatList calls getItemLayout per ITEM index, so
 *      the vertical offset divides by the column count
 *      (`Math.floor(index / 2)`; the literal 2 must match numColumns).
 *   2. The fixed height is only legal because the compact `<ItemCard>` was
 *      made deterministic: the title reserves a 2-line block
 *      (lineHeight 18 / minHeight 36 with numberOfLines={2}) and the
 *      conditional `<CostBadge>` renders inside a fixed 16px slot so a
 *      cost-less item can't shrink the card. Those style pins live here
 *      because breaking any of them silently corrupts the scroll math.
 */
function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function readCardSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "item-card.tsx"), "utf8");
}

describe("viewer FlatList getItemLayout", () => {
  it("components/item-card.tsx exports COMPACT_ITEM_CARD_HEIGHT = 190", () => {
    const src = readCardSrc();
    const m = src.match(/export\s+const\s+COMPACT_ITEM_CARD_HEIGHT\s*=\s*(\d+)\s*;/);
    assert.ok(m, "COMPACT_ITEM_CARD_HEIGHT must be exported as a numeric constant");
    // 1 (border) + 110 (image) + 8 (gap) + 36 (title block) + 8 (gap) +
    // 16 (cost slot) + 10 (paddingBottom) + 1 (border). If this fails
    // because the card geometry changed, update BOTH the constant and this
    // expectation together.
    assert.equal(Number(m![1]), 190);
  });

  it("compact card geometry is deterministic (2-line title block + fixed cost slot)", () => {
    const src = readCardSrc();
    // Title: capped at 2 lines AND reserving 2 lines — either half alone
    // makes the height content-dependent.
    assert.match(src, /compactTitle,[\s\S]*?numberOfLines=\{2\}/);
    assert.match(src, /compactTitle:\s*\{[\s\S]*?lineHeight:\s*18[\s\S]*?minHeight:\s*36[\s\S]*?\}/);
    // Cost: <CostBadge> returns null for cost-less items, so it must render
    // inside the always-mounted fixed-height slot.
    assert.match(src, /<View style=\{styles\.compactCostSlot\}>\s*\n\s*<CostBadge/);
    assert.match(src, /compactCostSlot:\s*\{\s*height:\s*16\s*,?\s*\}/);
    assert.match(src, /compactCost:\s*\{[\s\S]*?lineHeight:\s*16[\s\S]*?\}/);
  });

  it("getMasonryRowLayout divides by the column count with a header-and-gap-aware offset", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /const\s+getMasonryRowLayout\s*=\s*useCallback\(\s*\([^)]*\)\s*=>\s*\(\{\s*length:\s*COMPACT_ITEM_CARD_HEIGHT\s*,\s*offset:\s*\n?\s*viewerHeaderHeight\s*\+\s*\n?\s*SPACING_LIST\s*\+\s*\n?\s*\(COMPACT_ITEM_CARD_HEIGHT\s*\+\s*SPACING_LIST\)\s*\*\s*Math\.floor\(index\s*\/\s*2\)\s*,\s*index\s*,?\s*\}\)\s*,\s*\[\s*viewerHeaderHeight\s*\]\s*,?\s*\)/,
    );
    assert.ok(
      m,
      "getMasonryRowLayout must be a useCallback returning { length: COMPACT_ITEM_CARD_HEIGHT, offset: viewerHeaderHeight + SPACING_LIST + (COMPACT_ITEM_CARD_HEIGHT + SPACING_LIST) * Math.floor(index / 2), index } with deps [viewerHeaderHeight]",
    );
    // Hoisted above the early returns like every other hook in this file.
    const declIdx = src.indexOf("const getMasonryRowLayout");
    const earlyReturnIdx = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(declIdx !== -1 && earlyReturnIdx !== -1 && declIdx < earlyReturnIdx);
  });

  it("the header height feeding the offset is measured via onViewerHeaderLayout", () => {
    const src = readCollectionSrc();
    assert.match(src, /const\s+\[viewerHeaderHeight,\s*setViewerHeaderHeight\]\s*=\s*useState\(0\)/);
    assert.match(
      src,
      /const\s+onViewerHeaderLayout\s*=\s*useCallback\(\s*\(e:\s*LayoutChangeEvent\)\s*=>\s*\{\s*setViewerHeaderHeight\(e\.nativeEvent\.layout\.height\)/,
    );
  });

  it("the viewer FlatList passes getItemLayout + measures its ListHeaderComponent", () => {
    const src = readCollectionSrc();
    const viewerBlock = src.match(/<FlatList[\s\S]*?numColumns=\{\s*2\s*\}[\s\S]*?\/>/);
    assert.ok(viewerBlock, "viewer FlatList (numColumns={2}) not found");
    assert.match(viewerBlock![0], /getItemLayout=\{\s*getMasonryRowLayout\s*\}/);
    assert.match(viewerBlock![0], /ListHeaderComponent=\{[\s\S]*?onLayout=\{\s*onViewerHeaderLayout\s*\}/);
    // The divisor (2) is only correct while numColumns stays 2.
    assert.match(viewerBlock![0], /numColumns=\{\s*2\s*\}/);
  });

  it("the contentContainer row gap the offset stride assumes is still SPACING_LIST", () => {
    // The offset math bakes in SPACING_LIST as the inter-row gap; the style
    // now lives in the shared lib/flat-list-styles.ts (WLF-A) — if it
    // migrates to a different token the stride must follow.
    const src = readCollectionSrc();
    assert.match(
      src,
      /contentContainerStyle=\{\s*flatListStyles\.viewerFlatListContent\s*\}/,
      "viewer FlatList must take its content style from the shared flatListStyles",
    );
    const sharedSrc = readFileSync(path.join(process.cwd(), "lib", "flat-list-styles.ts"), "utf8");
    const m = sharedSrc.match(/viewerFlatListContent:\s*\{\s*gap:\s*SPACING_LIST\s*,?\s*\}/);
    assert.ok(m, "flatListStyles.viewerFlatListContent must keep gap: SPACING_LIST (or update getMasonryRowLayout's stride)");
  });
});
