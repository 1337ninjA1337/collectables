import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ItemCard memoization pins (the VM-F recipe applied to the viewer branch):
 * the masonry FlatList renderer is memoized end-to-end so React.memo on
 * `<ItemCard>` can skip re-render work when the parent re-renders with a
 * referentially stable `data` array.
 *
 * Two independent moving parts:
 *   1. `components/item-card.tsx` exports the card wrapped in `memo` using
 *      the NAMED-function form (`memo(function ItemCard(...)`) so React
 *      DevTools shows a real component name instead of "Anonymous".
 *   2. `app/collection/[id].tsx` hoists the masonry wrapper JSX into a
 *      `renderMasonryItem` useCallback (empty deps — it closes over nothing
 *      render-scoped) and the viewer FlatList consumes it as `renderItem`.
 *
 * Reverting either leg silently regresses the perf win — pinned separately.
 */
function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function readCardSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "item-card.tsx"), "utf8");
}

describe("ItemCard memoization end-to-end", () => {
  it("components/item-card.tsx wraps the export in memo with a NAMED function", () => {
    const src = readCardSrc();
    // The named form specifically — `memo((props) => ...)` would show up as
    // "Anonymous" in the DevTools profiler tree.
    assert.match(
      src,
      /export\s+const\s+ItemCard\s*=\s*(?:React\.)?memo\s*\(\s*function\s+ItemCard\b/,
      "ItemCard must be memo(function ItemCard(...)) — named for DevTools",
    );
    assert.match(
      src,
      /(?:import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"|import\s+React\s+from\s*"react")/,
    );
  });

  it("app/collection/[id].tsx hoists the masonry renderItem into a useCallback", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /const\s+renderMasonryItem\s*=\s*useCallback\s*\(\s*\([\s\S]*?\)\s*=>\s*\([\s\S]*?<ItemCard\s+item=\{item\}\s+compact\s+style=\{styles\.masonryItem\}\s*\/>[\s\S]*?\),\s*\[([^\]]*)\]\s*,?\s*\)/,
    );
    assert.ok(m, "renderMasonryItem must be a useCallback rendering <ItemCard compact style={styles.masonryItem}>");
    assert.equal(
      m[1].trim(),
      "",
      "renderMasonryItem deps must be empty — it closes over nothing render-scoped",
    );
  });

  it("the viewer FlatList consumes renderMasonryItem (no inline arrow)", () => {
    const src = readCollectionSrc();
    assert.match(src, /renderItem=\{renderMasonryItem\}/);
    // The old inline form must be gone — an inline arrow allocates a fresh
    // closure per parent render and defeats the card memo.
    assert.doesNotMatch(src, /renderItem=\{\(\{\s*item\s*\}\)\s*=>\s*\(\s*<View style=\{styles\.masonryItem\}>/);
  });
});
