import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * WLF-C structural pins: `app/collections-feed.tsx` bounds its per-tab card
 * mounts via `useChunkedList` windows + the manual Load-more CTA. The screen
 * deliberately does NOT take the VM-D scroll-owning-FlatList shape: the
 * `<SwipeTabs>` pager renders prev/next panels absolutely positioned with a
 * height-tracking container, so a FlatList inside a panel could never own
 * the screen scroll. The manual CTA is the same surviving pattern as the
 * drag-mode fallback on collection detail. Source pulls in react-native
 * peers so assertions are regex-based.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collections-feed.tsx"), "utf8");
}

describe("app/collections-feed.tsx — WLF-C chunked tab mounts", () => {
  it("chunks both tab sources with one window each", () => {
    const src = readSrc();
    assert.match(src, /const friendsWindow = useChunkedList\(\s*friendCollections\s*\)/);
    assert.match(src, /const subscribedWindow = useChunkedList\(\s*subscribedCollections\s*\)/);
  });

  it("renders tab cards from the chunked window, never the raw arrays", () => {
    const src = readSrc();
    assert.match(src, /const cols = window\.visibleItems/);
    // The raw arrays may only feed the windows, the emptiness check (length)
    // and the count fetch — never a .map over the full list.
    assert.doesNotMatch(src, /friendCollections\.map\(/);
    assert.doesNotMatch(src, /subscribedCollections\.map\(/);
  });

  it("shows a Load-more CTA gated on hasMore with the shared i18n strings", () => {
    const src = readSrc();
    assert.match(src, /\{window\.hasMore \? \(/);
    assert.match(src, /onPress=\{\s*window\.loadMore\s*\}/);
    assert.match(src, /accessibilityLabel=\{\s*t\("loadMoreItemsA11y",\s*\{\s*count:\s*total - cols\.length\s*\}\)\s*\}/);
    assert.match(src, /accessibilityHint=\{\s*t\("loadMoreItemsHint"\)\s*\}/);
    assert.match(src, /t\("loadMoreItems",\s*\{\s*count:\s*total - cols\.length\s*\}\)/);
  });

  it("empty-state check reads the FULL list length (a chunked window is never empty when the source isn't)", () => {
    const src = readSrc();
    assert.match(src, /const total = key === "friends" \? friendCollections\.length : subscribedCollections\.length/);
    assert.match(src, /if \(total === 0\)/);
  });

  it("the item-count fetch fans out over the mounted window only", () => {
    const src = readSrc();
    assert.match(
      src,
      /mainTab === "friends" \? friendsWindow\.visibleItems : subscribedWindow\.visibleItems/,
    );
    assert.match(src, /\}, \[mainTab, friendsWindow\.visibleItems, subscribedWindow\.visibleItems\]\);/);
  });

  it("documents why the VM-D FlatList flip does not apply here (SwipeTabs pager)", () => {
    const src = readSrc();
    // The decision comment is load-bearing: without it a future contributor
    // would "finish the migration" by forcing a FlatList into the pager.
    assert.match(src, /can't live inside <SwipeTabs>' pager/);
    assert.doesNotMatch(src, /<FlatList/);
    // Screen keeps its default ScrollView (no scroll={false} without a
    // scroll-owning list inside).
    assert.match(src, /<Screen>/);
  });
});
