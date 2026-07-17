import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Selection-mode FlatList `getItemLayout` pins: rows are fixed-height, so
 * FlatList is handed the geometry up-front (skipping the per-row onLayout
 * measurement pass). Three legs, each independently revertable:
 *
 *   1. `components/selectable-item-row.tsx` exports SELECTABLE_ROW_HEIGHT
 *      and its value matches the style-derived geometry (104px image +
 *      2*12px card padding + 2*1px card border + 2*2px selection border).
 *   2. `app/collection/[id].tsx` declares a module-level
 *      `getSelectableRowLayout` whose offset stride includes the
 *      `selectList` contentContainer gap (SPACING_CARD) — without the gap
 *      term the windowing math drifts 12px per row.
 *   3. The selection-mode FlatList actually passes
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
    assert.equal(Number(m[1]), 134);
  });

  it("app/collection/[id].tsx declares a module-level getSelectableRowLayout with a gap-aware offset", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /const\s+getSelectableRowLayout\s*=\s*\([^)]*\)\s*=>\s*\(\{\s*length:\s*SELECTABLE_ROW_HEIGHT\s*,\s*offset:\s*\(SELECTABLE_ROW_HEIGHT\s*\+\s*SPACING_CARD\)\s*\*\s*index\s*,\s*index\s*,?\s*\}\)/,
    );
    assert.ok(
      m,
      "getSelectableRowLayout must return { length: SELECTABLE_ROW_HEIGHT, offset: (SELECTABLE_ROW_HEIGHT + SPACING_CARD) * index, index }",
    );
    // Module-level, not a hook: it must appear BEFORE the component function
    // so its reference is stable without useCallback.
    const declIdx = src.indexOf("const getSelectableRowLayout");
    const componentIdx = src.indexOf("export default function CollectionDetailsScreen");
    assert.ok(declIdx !== -1 && componentIdx !== -1 && declIdx < componentIdx);
  });

  it("the selection-mode FlatList passes getItemLayout={getSelectableRowLayout}", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /isOwner\s*&&\s*selectionMode\s*\?\s*\(\s*\n?[\s\S]*?\n\s*\)\s*:\s*null\s*\}/,
    );
    assert.ok(m, "selection-mode FlatList block not found");
    assert.match(m[0], /getItemLayout=\{\s*getSelectableRowLayout\s*\}/);
  });

  it("the selectList contentContainer gap the offset stride assumes is still SPACING_CARD", () => {
    const src = readCollectionSrc();
    // The offset math bakes in SPACING_CARD as the inter-row gap; if the
    // selectList style migrates to a different token the stride must follow.
    const m = src.match(/selectList:\s*\{\s*gap:\s*SPACING_CARD\s*,?\s*\}/);
    assert.ok(m, "styles.selectList must keep gap: SPACING_CARD (or update getSelectableRowLayout's stride)");
  });
});
