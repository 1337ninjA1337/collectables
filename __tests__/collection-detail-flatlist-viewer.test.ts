import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-C structural pins: the viewer/read-only branch in
 * `app/collection/[id].tsx` now renders a `<FlatList numColumns={2}>` over
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
    assert.doesNotMatch(src, /masonryColumns/);
  });

  it("viewer branch renders FlatList numColumns={2} data={visibleItems}", () => {
    const src = readSrc();
    // The literal `numColumns={2}` and `data={visibleItems}` props are
    // load-bearing: a typo collapsing to 1 column would silently destroy
    // the two-column grid, and switching the data source to `items` would
    // undo the chunked-window memory bound that VM-A/B shipped.
    assert.match(src, /<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}[\s\S]*?\/>/);
    assert.match(src, /<FlatList[\s\S]*?numColumns=\{\s*2\s*\}[\s\S]*?\/>/);
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
    // in the masonry branch pre-VM-C.
    assert.match(
      src,
      /renderItem=\{[\s\S]*?<ItemCard\s+item=\{\s*item\s*\}\s+compact\s*\/>[\s\S]*?\}/,
    );
  });

  it("viewer FlatList no longer carries scrollEnabled={false} after VM-D", () => {
    const src = readSrc();
    // VM-D hoists the outer scroll INTO the viewer-branch FlatList itself,
    // so the FlatList is now the scrollable surface (not nested inside a
    // ScrollView). The pre-VM-D `scrollEnabled={false}` gate is gone —
    // without it iOS can recycle off-screen rows. The only `<FlatList ... />`
    // in this file is the viewer-branch one (drag uses NestableDraggableFlatList).
    assert.doesNotMatch(src, /<FlatList[\s\S]*?scrollEnabled=\{\s*false\s*\}[\s\S]*?\/>/);
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
