import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * WLF-A structural pins: the two VM-D "screen-owning FlatList" styles
 * (`viewerFlatList` flex:1 + `viewerFlatListContent` gap: SPACING_LIST) were
 * lifted out of `app/collection/[id].tsx` into the shared
 * `lib/flat-list-styles.ts` so every screen adopting the pattern imports one
 * module instead of copying the entries. The module pulls in react-native's
 * StyleSheet so it can't be loaded under `node --test` — assertions are
 * regex-based.
 */
function readSharedSrc(): string {
  return readFileSync(path.join(process.cwd(), "lib", "flat-list-styles.ts"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("lib/flat-list-styles.ts (WLF-A shared styles)", () => {
  it("exports flatListStyles via StyleSheet.create with the two VM-D entries", () => {
    const src = readSharedSrc();
    assert.match(src, /export const flatListStyles = StyleSheet\.create\(/);
    assert.match(src, /viewerFlatList:\s*\{\s*flex:\s*1\s*,?\s*\}/);
    assert.match(src, /viewerFlatListContent:\s*\{\s*gap:\s*SPACING_LIST\s*,?\s*\}/);
  });

  it("takes the row gap from the design-tokens SPACING_LIST (no inline literal)", () => {
    const src = readSharedSrc();
    assert.match(src, /import\s*\{\s*SPACING_LIST\s*\}\s*from\s*"@\/lib\/design-tokens"/);
    assert.doesNotMatch(src, /gap:\s*\d/);
  });

  it("app/collection/[id].tsx adopts the shared styles at all three FlatList sites", () => {
    const src = readCollectionSrc();
    assert.match(src, /import\s*\{\s*flatListStyles\s*\}\s*from\s*"@\/lib\/flat-list-styles"/);
    // Two scroll-owning branches (viewer + selection) take the flex:1 list
    // style; only the viewer branch has a content style (selection uses
    // selectList for its wider row gap).
    const listStyleSites = src.match(/style=\{\s*flatListStyles\.viewerFlatList\s*\}/g) ?? [];
    assert.equal(listStyleSites.length, 2, "expected both scroll-owning FlatLists to use flatListStyles.viewerFlatList");
    assert.match(src, /contentContainerStyle=\{\s*flatListStyles\.viewerFlatListContent\s*\}/);
  });

  it("the page StyleSheet no longer re-declares the lifted entries", () => {
    const src = readCollectionSrc();
    assert.doesNotMatch(src, /viewerFlatList:\s*\{/);
    assert.doesNotMatch(src, /viewerFlatListContent:\s*\{/);
    assert.doesNotMatch(src, /styles\.viewerFlatList\b/);
  });
});
