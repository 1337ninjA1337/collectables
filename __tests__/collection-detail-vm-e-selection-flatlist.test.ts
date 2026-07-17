import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-E (as amended by BB-B) structural pins: the owner+selection-mode
 * branch in `app/collection/[id].tsx` renders a `<FlatList data={visibleItems}>`
 * that OWNS its scroll — a VM-D-style early return inside
 * `<Screen scroll={false}>` with pageHeader + title/filters in
 * ListHeaderComponent, the Load-more CTA + bulk-bar spacer in
 * ListFooterComponent, and `<BulkBar>` as a sibling OUTSIDE the FlatList's
 * render tree (fixes the iOS touch fall-through the old absolutely-pinned
 * bar had over a nested non-scrolling list).
 *
 * VM-E's original `scrollEnabled={false}` + outer `<Screen nestable>`
 * contract is deliberately superseded by BB-B: a nested non-scrolling
 * FlatList can't virtualize. A revert to that shape must fail here.
 *
 * Drag-mode keeps `NestableDraggableFlatList` as before.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function selectionBranch(src: string): string {
  const m = src.match(
    /if\s*\(isOwner\s*&&\s*selectionMode\s*&&\s*allItems\.length\s*>\s*0\)\s*\{[\s\S]*?<\/Screen>\s*\)\s*;\s*\}/,
  );
  assert.ok(m, "selection-mode early-return branch not found");
  return m![0];
}

describe("app/collection/[id].tsx — VM-E/BB-B selection-mode FlatList", () => {
  it("selection branch is an early return inside <Screen scroll={false}>", () => {
    const block = selectionBranch(readSrc());
    assert.match(block, /<Screen\s+scroll=\{\s*false\s*\}\s*>/);
  });

  it("selection FlatList renders data={visibleItems} (NOT .map) with a stable keyExtractor", () => {
    const block = selectionBranch(readSrc());
    assert.match(block, /<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}/);
    assert.match(block, /keyExtractor=\{\s*\(item\)\s*=>\s*item\.id\s*\}/);
    // And the SelectableItemRow JSX still exists in the file (inside the
    // renderSelectableRow useCallback) without a redundant `key=` prop —
    // FlatList already keys via keyExtractor.
    const src = readSrc();
    assert.match(src, /<SelectableItemRow/);
    assert.doesNotMatch(src, /<SelectableItemRow[^>]*\bkey=/);
  });

  it("selection FlatList owns its scroll (no scrollEnabled={false} revert)", () => {
    const block = selectionBranch(readSrc());
    assert.doesNotMatch(
      block,
      /scrollEnabled=\{\s*false\s*\}/,
      "the selection FlatList must own scroll — scrollEnabled={false} means the nested-ScrollView shape is back",
    );
  });

  it("pageHeader + filters ride in ListHeaderComponent; spacer-only footer + onEndReached pagination", () => {
    const block = selectionBranch(readSrc());
    assert.match(block, /ListHeaderComponent=\{[\s\S]*?\{pageHeader\}[\s\S]*?\{listTitleAndFilters\}/);
    assert.match(block, /onLayout=\{\s*onSelectionHeaderLayout\s*\}/, "header must be measured for getItemLayout's offset");
    // The manual Load-more CTA is gone — the scroll-owning list auto-extends
    // the chunked window via onEndReached. The footer keeps ONLY the spacer
    // so the last rows scroll clear of the pinned <BulkBar>.
    assert.match(block, /ListFooterComponent=\{\s*<View\s+style=\{\s*styles\.bulkBarSpacer\s*\}\s*\/>\s*\}/);
    assert.doesNotMatch(block, /loadMoreCta/, "selection branch must not render the manual Load-more CTA");
    assert.match(block, /onEndReached=\{\s*loadMore\s*\}/);
    assert.match(block, /onEndReachedThreshold=\{\s*0\.5\s*\}/);
  });

  it("<BulkBar> is a sibling outside the FlatList render tree", () => {
    const block = selectionBranch(readSrc());
    const bulkBarIdx = block.indexOf("<BulkBar");
    const listCloseIdx = block.indexOf("</Profiler>");
    assert.ok(
      bulkBarIdx !== -1 && listCloseIdx !== -1 && bulkBarIdx > listCloseIdx,
      "<BulkBar> must render after the Profiler-wrapped FlatList closes, not inside it",
    );
  });

  it("selection FlatList keeps contentContainerStyle={styles.selectList} and the virtualization tuning", () => {
    const block = selectionBranch(readSrc());
    assert.match(block, /contentContainerStyle=\{\s*styles\.selectList\s*\}/);
    assert.match(block, /initialNumToRender=\{\s*10\s*\}/);
    assert.match(block, /maxToRenderPerBatch=\{\s*8\s*\}/);
    // BB-C: 7, not the nested-era 5 — a scroll-owning list needs the wider
    // window to avoid blank rows on fast flicks.
    assert.match(block, /windowSize=\{\s*7\s*\}/);
    assert.match(block, /removeClippedSubviews=\{\s*Platform\.OS\s*===\s*"ios"\s*\}/);
  });

  it("drag-mode branch is UNCHANGED — still NestableDraggableFlatList (VM-E intentionally leaves drag alone)", () => {
    const src = readSrc();
    // VM-E/BB-B touch selection mode ONLY. Drag-mode keeps its
    // non-virtualized NestableDraggableFlatList renderer — switching it
    // would require the upstream `react-native-draggable-flatlist`
    // migration which is its own out-of-scope task.
    assert.match(
      src,
      /isOwner\s*&&\s*!selectionMode\s*&&\s*itemFilters\.sort\s*===\s*"default"\s*\?\s*\([\s\S]*?<NestableDraggableFlatList[\s\S]*?data=\{\s*visibleItems\s*\}/,
    );
  });
});
