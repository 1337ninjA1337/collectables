import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * WLF-B structural pins: `app/wishlist.tsx` no longer renders its card list
 * as a `wishlistItems.map(...)` inside the Screen's ScrollView. The screen
 * mounts `<Screen scroll={false}>` with a single `<FlatList>` that owns the
 * scroll (the VM-D shape), a `useChunkedList` window bounding the mount
 * count, and native `onEndReached` pagination. The source pulls in
 * react-native peers so it can't be loaded under `node --test` — assertions
 * are regex-based.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "wishlist.tsx"), "utf8");
}

function readContextSrc(): string {
  return readFileSync(path.join(process.cwd(), "lib", "collections-context.tsx"), "utf8");
}

describe("app/wishlist.tsx — WLF-B FlatList migration", () => {
  it("renders <Screen scroll={false}> with the FlatList owning the scroll", () => {
    const src = readSrc();
    assert.match(src, /<Screen scroll=\{\s*false\s*\}\s*>/);
    // The old shape passed the refresh props to Screen (whose ScrollView
    // owned the scroll); they now ride on the FlatList's RefreshControl.
    assert.doesNotMatch(src, /<Screen refreshing=/);
    assert.match(
      src,
      /<FlatList[\s\S]*?refreshControl=\{\s*\n?\s*<RefreshControl[\s\S]*?refreshing=\{\s*!!refreshing\s*\}[\s\S]*?onRefresh=\{\s*handleRefresh\s*\}[\s\S]*?\/>[\s\S]*?\}/,
    );
    assert.match(src, /<FlatList[\s\S]*?style=\{\s*flatListStyles\.viewerFlatList\s*\}/);
  });

  it("feeds the FlatList from the chunked window, never the raw array", () => {
    const src = readSrc();
    assert.match(src, /useChunkedList\(\s*wishlistItems\s*\)/);
    assert.match(src, /<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}/);
    assert.doesNotMatch(src, /data=\{\s*wishlistItems\s*\}/);
  });

  it("paginates via a gated onEndReached (no manual Load-more CTA)", () => {
    const src = readSrc();
    // Gated: once the window covers everything, the prop goes undefined so
    // FlatList stops calling back (an ungated loadMore would keep setting
    // state on every end-scroll).
    assert.match(src, /onEndReached=\{\s*hasMore \? loadMore : undefined\s*\}/);
    assert.match(src, /onEndReachedThreshold=\{\s*0\.5\s*\}/);
  });

  it("hoists header chrome, empty state and renderItem into stable hooks", () => {
    const src = readSrc();
    assert.match(src, /const listHeader = useMemo\(/);
    assert.match(src, /const listEmpty = useMemo\(/);
    assert.match(src, /const renderWishlistCard = useCallback\(/);
    assert.match(src, /ListHeaderComponent=\{\s*listHeader\s*\}/);
    assert.match(src, /ListEmptyComponent=\{\s*listEmpty\s*\}/);
    assert.match(src, /renderItem=\{\s*renderWishlistCard\s*\}/);
    // confirmDelete is a renderItem dep, so it must be a useCallback (a plain
    // function would re-arm the memoized renderItem every render).
    assert.match(src, /const confirmDelete = useCallback\(/);
    assert.doesNotMatch(src, /function confirmDelete\(/);
    // The old inline map shape must not survive anywhere in the file.
    assert.doesNotMatch(src, /wishlistItems\.map\(/);
  });

  it("keeps virtualization props tuned for a scroll-owning single-column list", () => {
    const src = readSrc();
    assert.match(src, /initialNumToRender=\{\s*10\s*\}/);
    assert.match(src, /maxToRenderPerBatch=\{\s*8\s*\}/);
    assert.match(src, /windowSize=\{\s*7\s*\}/);
    assert.match(src, /removeClippedSubviews=\{\s*Platform\.OS === "ios"\s*\}/);
  });

  it("collections-context memoizes wishlistItems separately so the chunked window survives unrelated context updates", () => {
    const src = readContextSrc();
    // useChunkedList resets its window whenever the array identity changes;
    // computing the filter inline in the big value-memo factory handed the
    // screen a fresh array on every context update.
    assert.match(src, /const wishlistItems = useMemo\(\s*\(\)\s*=>\s*\n?\s*localItems\s*\n?\s*\.filter\(\(item\) => item\.isWishlist\)/);
    assert.match(src, /^\s*wishlistItems,$/m);
    assert.doesNotMatch(src, /wishlistItems:\s*localItems/);
  });
});
