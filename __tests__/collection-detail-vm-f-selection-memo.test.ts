import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-F structural pins: the selection-mode FlatList renderer is memoized
 * end-to-end so React.memo on `<SelectableItemRow>` can actually skip
 * re-render work for rows whose `selected` flag didn't change.
 *
 * Three independent moving parts:
 *   1. `components/selectable-item-row.tsx` exports the row wrapped in
 *      `React.memo` (or `memo`) — without this, the parent useCallback
 *      buys nothing because every child still re-renders.
 *   2. `app/collection/[id].tsx` declares `toggleSelect` as a `useCallback`
 *      with an empty dep list — so the `onToggle` prop the row receives is
 *      referentially stable across parent renders.
 *   3. `app/collection/[id].tsx` declares `renderSelectableRow` as a
 *      `useCallback` and the selection-mode FlatList uses it as `renderItem`
 *      AND passes `extraData={selectedIds}` so virtualization considers
 *      re-renders when the selection set mutates while `data={visibleItems}`
 *      reference stays stable.
 *
 * A future contributor reverting any one of the three would silently
 * regress the perf win — this file pins each leg independently.
 */
function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function readRowSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "selectable-item-row.tsx"), "utf8");
}

describe("VM-F — SelectableItemRow memoization end-to-end", () => {
  it("components/selectable-item-row.tsx wraps the export in React.memo / memo", () => {
    const src = readRowSrc();
    // Accept either the `memo(function SelectableItemRow(...) {...})` form
    // (named function for React DevTools) or `memo(({...}) => {...})`.
    // The export must be the memoized component, NOT a plain function.
    assert.match(
      src,
      /export\s+const\s+SelectableItemRow\s*=\s*(?:React\.)?memo\s*\(/,
      "SelectableItemRow must be wrapped in React.memo / memo",
    );
    // And the `memo` symbol is imported from "react" (or accessed via React).
    assert.match(
      src,
      /(?:import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"|import\s+React\s+from\s*"react")/,
    );
    // The inner function must be the NAMED form — `memo(function
    // SelectableItemRow(...))`, not `memo((props) => ...)`. The named form
    // gives React DevTools a real component name in the profiler tree;
    // anonymous rows show up as "Anonymous" and are much harder to diagnose
    // — which matters now that the selection FlatList ships a __DEV__
    // Profiler wrapper.
    assert.match(
      src,
      /memo\(\s*function\s+SelectableItemRow\b/,
      "SelectableItemRow's inner function must be named (memo(function SelectableItemRow(...)))",
    );
  });

  it("app/collection/[id].tsx declares toggleSelect as a stable useCallback", () => {
    const src = readCollectionSrc();
    // `useCallback` is imported alongside the other hooks.
    assert.match(src, /import\s*\{[^}]*\buseCallback\b[^}]*\}\s*from\s*"react"/);
    // toggleSelect is a useCallback with an empty dep list — the React state
    // setter `setSelectedIds` is stable, so deps are intentionally empty.
    assert.match(
      src,
      /const\s+toggleSelect\s*=\s*useCallback\s*\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\},\s*\[\s*\]\s*\)/,
    );
  });

  it("app/collection/[id].tsx hoists renderSelectableRow into a useCallback that closes over selectedById + toggleSelect", () => {
    const src = readCollectionSrc();
    // The useCallback body renders <SelectableItemRow> with selected/onToggle
    // props sourced from the memoized selectedById map + toggleSelect.
    const m = src.match(
      /const\s+renderSelectableRow\s*=\s*useCallback\s*\(\s*\([\s\S]*?\)\s*=>\s*\([\s\S]*?<SelectableItemRow[\s\S]*?\),\s*\[([^\]]*)\]\s*,?\s*\)/,
    );
    assert.ok(m, "renderSelectableRow must be a useCallback wrapping <SelectableItemRow>");
    const deps = m[1].replace(/\s+/g, "");
    // Deps must include both selectedById and toggleSelect (order doesn't
    // matter). selectedById is rebuilt whenever the selection Set's
    // reference changes (each toggle produces a new Set), so the closure
    // rebuilds and the child memo can compare its `selected` prop;
    // toggleSelect is stable but listed for honest-deps hygiene.
    assert.ok(deps.includes("selectedById"), `deps must include selectedById, got "${deps}"`);
    assert.ok(deps.includes("toggleSelect"), `deps must include toggleSelect, got "${deps}"`);
  });

  it("app/collection/[id].tsx derives selectedById once per selection change and reads it per-row", () => {
    const src = readCollectionSrc();
    // The map is a useMemo keyed on the selection Set — rebuilt once per
    // toggle instead of paying Set.prototype.has per visible row.
    assert.match(
      src,
      /const\s+selectedById\s*=\s*useMemo\(\s*\(\)\s*=>\s*Object\.fromEntries\([\s\S]{0,120}?\),\s*\[\s*selectedIds\s*\]\s*,?\s*\)/,
      "selectedById must be a useMemo over Object.fromEntries keyed on [selectedIds]",
    );
    // The row prop reads the map, not the Set.
    assert.match(src, /selected=\{\s*!!selectedById\[item\.id\]\s*\}/);
    assert.doesNotMatch(src, /selected=\{\s*selectedIds\.has\(item\.id\)\s*\}/);
  });

  it("app/collection/[id].tsx selection-mode FlatList passes renderItem={renderSelectableRow} (not inline)", () => {
    const src = readCollectionSrc();
    // Inline `renderItem={({ item }) => (<SelectableItemRow ...>)}` defeats
    // the useCallback memoization — pin the absence of the inline arrow
    // AND the presence of the hoisted-callback reference.
    const m = src.match(
      /isOwner\s*&&\s*selectionMode\s*\?\s*\(\s*\n?[\s\S]*?\n\s*\)\s*:\s*null\s*\}/,
    );
    assert.ok(m, "selection-mode FlatList block not found");
    const block = m[0];
    assert.match(block, /renderItem=\{\s*renderSelectableRow\s*\}/);
    // Negative pin: no inline arrow allocating <SelectableItemRow> inside
    // the selection-mode block.
    assert.doesNotMatch(block, /renderItem=\{\s*\(\s*\{\s*item\s*\}\s*\)\s*=>\s*\(\s*<SelectableItemRow/);
  });

  it("app/collection/[id].tsx selection-mode FlatList passes extraData={selectedIds}", () => {
    const src = readCollectionSrc();
    // FlatList's `data={visibleItems}` reference stays stable across a
    // single toggle (the array is memoized upstream by useChunkedList).
    // Without `extraData={selectedIds}` FlatList's bailout would skip the
    // re-render entirely and the freshly-selected checkmark wouldn't render
    // until something else changed. extraData restores the re-render trigger
    // without forcing data to change.
    const m = src.match(
      /isOwner\s*&&\s*selectionMode\s*\?\s*\(\s*\n?[\s\S]*?\n\s*\)\s*:\s*null\s*\}/,
    );
    assert.ok(m, "selection-mode FlatList block not found");
    const block = m[0];
    assert.match(block, /extraData=\{\s*selectedIds\s*\}/);
  });
});
