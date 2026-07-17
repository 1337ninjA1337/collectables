import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * onEndReached pagination pins: the two scroll-owning FlatLists in
 * `app/collection/[id].tsx` (viewer branch via VM-D, selection branch via
 * BB-B) auto-extend the chunked window with FlatList's native
 * `onEndReached={loadMore}` + `onEndReachedThreshold={0.5}` instead of the
 * manual Load-more CTA. The nested drag-mode branch keeps the CTA because it
 * sits inside `<Screen nestable>` — the OUTER ScrollView owns scroll there,
 * so a nested list's onEndReached would never fire and removing the CTA
 * would strand users at the first page.
 *
 * The source file pulls in `@expo/vector-icons` + react-native peers and
 * can't be loaded under `node --test`, so the assertions are regex-based.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function viewerBranch(src: string): string {
  const m = src.match(/if\s*\(\s*isViewerFlatListBranch\s*\)\s*\{[\s\S]*?<\/Screen>\s*\)\s*;\s*\}/);
  assert.ok(m, "viewer-FlatList early-return branch not found");
  return m![0];
}

function selectionBranch(src: string): string {
  const m = src.match(
    /if\s*\(isOwner\s*&&\s*selectionMode\s*&&\s*allItems\.length\s*>\s*0\)\s*\{[\s\S]*?<\/Screen>\s*\)\s*;\s*\}/,
  );
  assert.ok(m, "selection-mode early-return branch not found");
  return m![0];
}

function dragFallback(src: string): string {
  const m = src.match(/<Screen\s+nestable\s+refreshing=[\s\S]*?<\/Screen>/);
  assert.ok(m, "nestable fallback return not found");
  return m![0];
}

describe("app/collection/[id].tsx — onEndReached pagination on scroll-owning FlatLists", () => {
  it("viewer FlatList wires onEndReached={loadMore} with a 0.5 threshold", () => {
    const block = viewerBranch(readSrc());
    assert.match(block, /onEndReached=\{\s*loadMore\s*\}/);
    assert.match(block, /onEndReachedThreshold=\{\s*0\.5\s*\}/);
  });

  it("selection FlatList wires onEndReached={loadMore} with a 0.5 threshold", () => {
    const block = selectionBranch(readSrc());
    assert.match(block, /onEndReached=\{\s*loadMore\s*\}/);
    assert.match(block, /onEndReachedThreshold=\{\s*0\.5\s*\}/);
  });

  it("neither scroll-owning branch renders the manual Load-more CTA anymore", () => {
    const src = readSrc();
    assert.doesNotMatch(viewerBranch(src), /loadMoreCta/);
    assert.doesNotMatch(selectionBranch(src), /loadMoreCta/);
  });

  it("selection footer keeps ONLY the bulk-bar spacer (rows must scroll clear of the pinned bar)", () => {
    const block = selectionBranch(readSrc());
    assert.match(block, /ListFooterComponent=\{\s*<View\s+style=\{\s*styles\.bulkBarSpacer\s*\}\s*\/>\s*\}/);
  });

  it("nested drag-mode fallback KEEPS the Load-more CTA (onEndReached can't fire without owning scroll)", () => {
    const block = dragFallback(readSrc());
    assert.match(block, /\{\s*loadMoreCta\s*\}/);
    assert.doesNotMatch(block, /onEndReached/);
  });

  it("loadMoreCta const survives (still needed by the drag branch) and stays gated on hasMore", () => {
    const src = readSrc();
    assert.match(src, /const\s+loadMoreCta\s*=\s*hasMore\s*\?/);
  });
});
