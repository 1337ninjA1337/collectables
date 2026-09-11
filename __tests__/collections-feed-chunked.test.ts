import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "./helpers/repo-file";

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
  return readRepoFile("app/collections-feed.tsx");
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

  it("shows a Load-more CTA, and it is the shared button", () => {
    // The `{window.hasMore ? (<Pressable …/>) : null}` here was one of three
    // copies of one button; `<LoadMoreButton>` owns the markup, the three
    // strings and the two style rules since 2026-09-11, and renders nothing
    // at a `remaining` of zero — which is what `hasMore` was saying. The
    // arithmetic stays here because only this screen knows which list the
    // window is over.
    const src = readSrc();
    assert.match(src, /import \{ LoadMoreButton \} from "@\/components\/load-more-button";/);
    assert.match(src, /<LoadMoreButton remaining=\{total - cols\.length\} onPress=\{window\.loadMore\} \/>/);
    assert.doesNotMatch(src, /loadMoreItemsA11y/);
    assert.doesNotMatch(src, /styles\.loadMoreText/);
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
