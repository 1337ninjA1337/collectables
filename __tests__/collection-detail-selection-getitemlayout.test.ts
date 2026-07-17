import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Selection-mode FlatList `getItemLayout` pins (as amended by BB-B): rows
 * are fixed-height, so FlatList is handed the geometry up-front. Since
 * BB-B the selection FlatList owns its scroll and renders pageHeader via
 * ListHeaderComponent, so every row offset is shifted by the measured
 * header height plus the contentContainer gap between header and first
 * row. Three legs, each independently revertable:
 *
 *   1. `components/selectable-item-row.tsx` exports SELECTABLE_ROW_HEIGHT
 *      matching the style-derived geometry (104px image + 2*12px card
 *      padding + 2*1px card border + 2*2px selection border).
 *   2. `app/collection/[id].tsx` derives `getSelectableRowLayout` as a
 *      useCallback over the measured `selectionHeaderHeight` whose offset
 *      is `selectionHeaderHeight + SPACING_CARD + (SELECTABLE_ROW_HEIGHT +
 *      SPACING_CARD) * index` — dropping either gap term drifts the
 *      windowing math 12px per row.
 *   3. The selection-mode FlatList passes
 *      `getItemLayout={getSelectableRowLayout}`.
 */
function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function readRowSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "selectable-item-row.tsx"), "utf8");
}

describe("selection-mode FlatList getItemLayout", () => {
  it("components/selectable-item-row.tsx exports SELECTABLE_ROW_HEIGHT = 134", () => {
    const src = readRowSrc();
    const m = src.match(/export\s+const\s+SELECTABLE_ROW_HEIGHT\s*=\s*(\d+)\s*;/);
    assert.ok(m, "SELECTABLE_ROW_HEIGHT must be exported as a numeric constant");
    // 104 (ItemCard image) + 24 (card padding) + 2 (card border) + 4
    // (selection border). If this fails because the card geometry changed,
    // update BOTH the constant and this expectation together.
    assert.equal(Number(m![1]), 134);
  });

  it("getSelectableRowLayout is a useCallback with a header-and-gap-aware offset", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /const\s+getSelectableRowLayout\s*=\s*useCallback\(\s*\([^)]*\)\s*=>\s*\(\{\s*length:\s*SELECTABLE_ROW_HEIGHT\s*,\s*offset:\s*selectionHeaderHeight\s*\+\s*SPACING_CARD\s*\+\s*\(SELECTABLE_ROW_HEIGHT\s*\+\s*SPACING_CARD\)\s*\*\s*index\s*,\s*index\s*,?\s*\}\)\s*,\s*\[\s*selectionHeaderHeight\s*\]\s*,?\s*\)/,
    );
    assert.ok(
      m,
      "getSelectableRowLayout must be a useCallback returning { length: SELECTABLE_ROW_HEIGHT, offset: selectionHeaderHeight + SPACING_CARD + (SELECTABLE_ROW_HEIGHT + SPACING_CARD) * index, index } with deps [selectionHeaderHeight]",
    );
    // Hoisted above the early returns like every other hook in this file.
    const declIdx = src.indexOf("const getSelectableRowLayout");
    const earlyReturnIdx = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(declIdx !== -1 && earlyReturnIdx !== -1 && declIdx < earlyReturnIdx);
  });

  it("the header height feeding the offset is measured via onSelectionHeaderLayout", () => {
    const src = readCollectionSrc();
    assert.match(src, /const\s+\[selectionHeaderHeight,\s*setSelectionHeaderHeight\]\s*=\s*useState\(0\)/);
    assert.match(
      src,
      /const\s+onSelectionHeaderLayout\s*=\s*useCallback\(\s*\(e:\s*LayoutChangeEvent\)\s*=>\s*\{\s*setSelectionHeaderHeight\(e\.nativeEvent\.layout\.height\)/,
    );
  });

  it("the selection-mode FlatList passes getItemLayout={getSelectableRowLayout}", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /if\s*\(isOwner\s*&&\s*selectionMode\s*&&\s*allItems\.length\s*>\s*0\)\s*\{[\s\S]*?<\/Screen>\s*\)\s*;\s*\}/,
    );
    assert.ok(m, "selection-mode branch not found");
    assert.match(m![0], /getItemLayout=\{\s*getSelectableRowLayout\s*\}/);
  });

  it("the selectList contentContainer gap the offset stride assumes is still SPACING_CARD", () => {
    const src = readCollectionSrc();
    // The offset math bakes in SPACING_CARD as the inter-row gap; if the
    // selectList style migrates to a different token the stride must follow.
    const m = src.match(/selectList:\s*\{\s*gap:\s*SPACING_CARD\s*,?\s*\}/);
    assert.ok(m, "styles.selectList must keep gap: SPACING_CARD (or update getSelectableRowLayout's stride)");
  });
});
