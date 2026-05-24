import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-E structural pins: the owner+selection-mode branch in
 * `app/collection/[id].tsx` no longer renders a plain `.map(<SelectableItemRow>)`
 * — it now renders a `<FlatList data={visibleItems}>` so the same chunked-
 * window mount discipline that VM-A/B/C/D applies to the viewer branch also
 * bounds selection mode. `scrollEnabled={false}` because the outer
 * `<Screen nestable>` ScrollView owns scrolling (selection mode keeps the
 * bulk-bar pinned at the bottom so the outer scroll can't be hoisted into
 * the FlatList without losing the bulk-bar UX).
 *
 * Drag-mode keeps `NestableDraggableFlatList` as before — that's the explicit
 * decision in VM-E (the maintained `react-native-draggable-flatlist` migration
 * is its own out-of-scope task).
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("app/collection/[id].tsx — VM-E selection-mode FlatList migration", () => {
  it("selection-mode branch renders <FlatList data={visibleItems}> (NOT .map)", () => {
    const src = readSrc();
    // The structural pin: inside `isOwner && selectionMode ?` the renderer
    // is now `<FlatList data={visibleItems}>` with a SelectableItemRow
    // renderItem. A regression where someone reverts to .map would fail.
    assert.match(
      src,
      /isOwner\s*&&\s*selectionMode\s*\?\s*\([\s\S]*?<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}[\s\S]*?renderItem=\{[\s\S]*?<SelectableItemRow/,
    );
  });

  it("selection-mode FlatList keyExtractor returns item.id (so React keys survive re-renders)", () => {
    const src = readSrc();
    // Without a stable keyExtractor FlatList falls back to the index, which
    // breaks toggleSelect's set-membership state on any reorder. item.id is
    // the canonical stable key.
    assert.match(
      src,
      /isOwner\s*&&\s*selectionMode\s*\?[\s\S]*?<FlatList[\s\S]*?keyExtractor=\{\s*\(item\)\s*=>\s*item\.id\s*\}/,
    );
  });

  it("selection-mode FlatList passes scrollEnabled={false} (outer Screen nestable owns scroll)", () => {
    const src = readSrc();
    // Unlike the viewer FlatList (VM-D, where the FlatList owns the scroll),
    // selection mode keeps the outer NestableScrollContainer in charge so
    // the bulk-bar stays pinned at the bottom of the viewport. Hoisting the
    // outer scroll into a sibling FlatList would un-pin the bulk-bar.
    assert.match(
      src,
      /isOwner\s*&&\s*selectionMode\s*\?[\s\S]*?<FlatList[\s\S]*?scrollEnabled=\{\s*false\s*\}/,
    );
  });

  it("selection-mode FlatList contentContainerStyle is the existing selectList style", () => {
    const src = readSrc();
    // The selectList style has `gap: 12` — preserved by routing through
    // FlatList's contentContainerStyle so the visual spacing between rows
    // stays exactly the same as the pre-VM-E `<View style={selectList}>`
    // wrapper.
    assert.match(
      src,
      /isOwner\s*&&\s*selectionMode\s*\?[\s\S]*?<FlatList[\s\S]*?contentContainerStyle=\{\s*styles\.selectList\s*\}/,
    );
  });

  it("selection-mode FlatList wires the same virtualization props as the viewer FlatList", () => {
    const src = readSrc();
    // Even though scrollEnabled is false (outer ScrollView owns scroll),
    // FlatList still bounds the INITIAL mount via initialNumToRender and
    // batches subsequent mounts via maxToRenderPerBatch. windowSize and
    // removeClippedSubviews (iOS only) further cap render work as the
    // outer scroll moves rows in/out of view. Mirrors VM-D's tuning.
    // Use a greedy match up to `) : null}` (the end of the ternary chain)
    // so the inner `<SelectableItemRow ... />` self-close doesn't terminate
    // the non-greedy `[\s\S]*?` early.
    const m = src.match(
      /isOwner\s*&&\s*selectionMode\s*\?\s*\(\s*\n?[\s\S]*?\n\s*\)\s*:\s*null\s*\}/,
    );
    assert.ok(m, "selection-mode FlatList block not found");
    const block = m[0];
    assert.match(block, /initialNumToRender=\{\s*10\s*\}/);
    assert.match(block, /maxToRenderPerBatch=\{\s*8\s*\}/);
    assert.match(block, /windowSize=\{\s*5\s*\}/);
    assert.match(block, /removeClippedSubviews=\{\s*Platform\.OS\s*===\s*"ios"\s*\}/);
  });

  it("selection-mode FlatList renderItem omits `key=` on the SelectableItemRow (FlatList owns the key)", () => {
    const src = readSrc();
    // The pre-VM-E `.map()` carried `<SelectableItemRow key={item.id} ...>`.
    // Inside FlatList's renderItem the `key` prop is redundant (FlatList
    // already keys via keyExtractor) and React logs a warning if both are
    // present. Pin the absence.
    const m = src.match(
      /isOwner\s*&&\s*selectionMode\s*\?\s*\(\s*\n?[\s\S]*?\n\s*\)\s*:\s*null\s*\}/,
    );
    assert.ok(m, "selection-mode FlatList block not found");
    const block = m[0];
    assert.doesNotMatch(block, /<SelectableItemRow[^>]*\bkey=/);
  });

  it("drag-mode branch is UNCHANGED — still NestableDraggableFlatList (VM-E intentionally leaves drag alone)", () => {
    const src = readSrc();
    // VM-E touches selection mode ONLY. Drag-mode keeps its non-virtualized
    // NestableDraggableFlatList renderer — switching it would require the
    // upstream `react-native-draggable-flatlist` migration which is its own
    // out-of-scope task.
    assert.match(
      src,
      /isOwner\s*&&\s*!selectionMode\s*&&\s*itemFilters\.sort\s*===\s*"default"\s*\?\s*\([\s\S]*?<NestableDraggableFlatList[\s\S]*?data=\{\s*visibleItems\s*\}/,
    );
  });
});
