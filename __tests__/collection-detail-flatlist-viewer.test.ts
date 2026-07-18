import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-C structural pins: the viewer/read-only branch in
 * `app/collection/[id].tsx` now renders a `<FlatList numColumns={masonryColumnCount}>` over
 * `visibleItems` instead of the previous two-column `<View>` masonry pair
 * driven by `distributeIntoMasonryColumns`. FlatList itself handles column
 * distribution, so the helper import is gone and the masonry styles
 * (`masonryGrid` / `masonryCol` / `masonryColOffset`) were replaced with a
 * FlatList-shaped trio (`masonryList` / `masonryRow` / `masonryItem`).
 *
 * The source file pulls in `@expo/vector-icons` + react-native peers and
 * can't be loaded under `node --test`, so the assertions are regex-based —
 * the behavioural coverage of FlatList itself lives in react-native and is
 * not retested here.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("app/collection/[id].tsx — FlatList viewer-masonry migration (VM-C)", () => {
  it("imports FlatList from react-native", () => {
    const src = readSrc();
    // The import line is the single source of truth that FlatList is in
    // scope. A regression where someone replaces the JSX but forgets the
    // import would crash at runtime — pin it.
    assert.match(src, /import\s*\{[^}]*\bFlatList\b[^}]*\}\s*from\s*"react-native"/);
  });

  it("no longer imports distributeIntoMasonryColumns from @/lib/masonry", () => {
    const src = readSrc();
    // VM-C drops the masonry helper from this file — column distribution
    // is now FlatList's job. The helper still lives in `lib/masonry.ts` for
    // future reuse, but its import here is gone.
    assert.doesNotMatch(src, /distributeIntoMasonryColumns/);
  });

  it("no longer declares a masonryColumns useMemo", () => {
    const src = readSrc();
    // The pre-VM-C `useMemo(() => distributeIntoMasonryColumns(...))`
    // memoization is obsolete — FlatList consumes `visibleItems` directly.
    assert.doesNotMatch(src, /masonryColumns\b/);
  });

  it("no modulo-by-2 column split can sneak back in (broader than the literal i % 2 === N pins)", () => {
    const src = readSrc();
    // The pre-VM-B masonry split was `.filter((_, i) => i % 2 === 0)` /
    // `=== 1`. A narrow guard on those exact literals would miss subtle
    // re-rolls (`i % 2 !== 0`, `idx % 2 < 1`), so this catches ANY
    // identifier-mod-2 in the file — FlatList owns column distribution
    // now, and no legitimate code here should mod by 2. If one ever does,
    // rewriting this pin is the deliberate act the guard exists to force.
    assert.doesNotMatch(src, /[A-Za-z_$][\w$]*\s*%\s*2\b/);
  });

  it("viewer branch renders FlatList numColumns={masonryColumnCount} data={visibleItems}", () => {
    const src = readSrc();
    // The `numColumns={masonryColumnCount}` and `data={visibleItems}` props
    // are load-bearing: numColumns must consume the same responsive value
    // getMasonryRowLayout divides by (a literal here could drift from the
    // divisor), and switching the data source to `items` would undo the
    // chunked-window memory bound that VM-A/B shipped.
    assert.match(src, /<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}[\s\S]*?\/>/);
    assert.match(src, /<FlatList[\s\S]*?numColumns=\{\s*masonryColumnCount\s*\}[\s\S]*?\/>/);
  });

  it("viewer FlatList passes keyExtractor item.id (so React keys survive re-renders)", () => {
    const src = readSrc();
    assert.match(
      src,
      /<FlatList[\s\S]*?keyExtractor=\{\s*\(item\)\s*=>\s*item\.id\s*\}[\s\S]*?\/>/,
    );
  });

  it("viewer FlatList renders <ItemCard item={item} compact /> per slot", () => {
    const src = readSrc();
    // The renderItem must mount the compact variant of ItemCard — the
    // full-size variant breaks the two-column layout and was never used
    // in the masonry branch pre-VM-C. Since the ItemCard-memo work the
    // renderer is hoisted into a `renderMasonryItem` useCallback, so the
    // pin follows the reference: FlatList consumes the hoisted callback,
    // and the callback body mounts the compact card.
    assert.match(src, /renderItem=\{renderMasonryItem\}/);
    assert.match(
      src,
      /const\s+renderMasonryItem\s*=\s*useCallback\s*\([\s\S]*?<ItemCard\s+item=\{\s*item\s*\}\s+compact\s+style=\{\s*styles\.masonryItem\s*\}\s*\/>[\s\S]*?\)/,
    );
  });

  it("viewer FlatList no longer carries scrollEnabled={false} after VM-D", () => {
    const src = readSrc();
    // VM-D hoists the outer scroll INTO the viewer-branch FlatList itself,
    // so the FlatList is now the scrollable surface (not nested inside a
    // ScrollView). The viewer FlatList is identified by `numColumns={masonryColumnCount}` —
    // the selection-mode FlatList (VM-E) is a different list with NO
    // numColumns prop and intentionally keeps scrollEnabled={false}
    // because the outer ScrollView still owns scroll for selection mode.
    const viewerFlatListBlock = src.match(/<FlatList[\s\S]*?numColumns=\{\s*masonryColumnCount\s*\}[\s\S]*?\/>/);
    assert.ok(viewerFlatListBlock, "viewer FlatList (numColumns={masonryColumnCount}) not found");
    assert.doesNotMatch(viewerFlatListBlock[0], /scrollEnabled=\{\s*false\s*\}/);
  });

  it("declares masonryList / masonryRow / masonryItem styles for the FlatList", () => {
    const src = readSrc();
    // The previous `masonryGrid` / `masonryCol` / `masonryColOffset` trio
    // matched a hand-rolled two-column <View> layout. FlatList has its own
    // shape: contentContainerStyle (`masonryList`), columnWrapperStyle
    // (`masonryRow`), and a per-item wrapper (`masonryItem`).
    assert.match(src, /masonryList:\s*\{[\s\S]*?gap:[\s\S]*?\}/);
    assert.match(src, /masonryRow:\s*\{[\s\S]*?gap:[\s\S]*?\}/);
    assert.match(src, /masonryItem:\s*\{[\s\S]*?flex:\s*1[\s\S]*?\}/);
  });

  it("no longer carries the legacy masonryGrid / masonryCol / masonryColOffset styles", () => {
    const src = readSrc();
    // Regression guard — if a future change re-introduces the hand-rolled
    // two-column View layout it'll fail loudly here instead of leaving a
    // half-migrated file with both shapes coexisting.
    assert.doesNotMatch(src, /masonryGrid\s*:/);
    assert.doesNotMatch(src, /styles\.masonryGrid/);
    assert.doesNotMatch(src, /styles\.masonryCol\b/);
    assert.doesNotMatch(src, /styles\.masonryColOffset/);
  });
});
