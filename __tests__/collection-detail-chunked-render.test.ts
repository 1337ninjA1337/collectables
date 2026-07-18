import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the chunked-rendering wiring in `app/collection/[id].tsx`.
 * Without these, a future refactor could silently revert any of the three
 * render branches (drag / selection / masonry) back to `items.map(...)` and
 * the iOS memory regression would return undetected.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("app/collection/[id].tsx — chunked item rendering", () => {
  const src = read("app/collection/[id].tsx");

  it("imports useChunkedList from the shared hook module", () => {
    assert.match(src, /import\s*\{\s*useChunkedList\s*\}\s*from\s*"@\/lib\/use-chunked-list"/);
  });

  it("instantiates exactly one useChunkedList(items) hook (single shared window across the 3 render branches)", () => {
    // Multiple instances would each maintain their own count, so the
    // drag-mode branch and the selection-mode branch could be out of
    // sync — confusing behaviour and double the auto-reset cost.
    const calls = src.match(/useChunkedList\s*\(/g) ?? [];
    assert.equal(calls.length, 1, `expected exactly one useChunkedList call, got ${calls.length}`);
    assert.match(src, /useChunkedList\(\s*items\s*\)/);
  });

  it("memoizes getItemsForCollection so localItems reference is stable across renders", () => {
    // The bug this pin catches: `getItemsForCollection(id)` returns a
    // fresh `.filter().sort()` array on every call. Without useMemo
    // around it, `localItems` (and therefore `allItems` and the `items`
    // useMemo that depends on `allItems`) get a new reference every
    // render. That re-triggers the `useChunkedList` identity-reset
    // effect after every `loadMore` press — count goes 20 → 40 → 20,
    // visibly nothing changes BUT the 20 newly-mounted item cards kick
    // off image fetches before being unmounted by the reset. Symptom
    // is "Load more does nothing but I see network traffic each press".
    assert.match(
      src,
      /const\s+localItems\s*=\s*useMemo\([\s\S]*?getItemsForCollection\(\s*params\.id\s*\)[\s\S]*?\[\s*getItemsForCollection\s*,\s*params\.id\s*\]\s*,?\s*\)/,
    );
  });

  it("destructures visibleItems + hasMore + loadMore from the hook", () => {
    assert.match(
      src,
      /const\s*\{\s*visibleItems\s*,\s*hasMore\s*,\s*loadMore\s*\}\s*=\s*useChunkedList/,
    );
  });

  it("drag-mode branch feeds visibleItems (not items) into NestableDraggableFlatList", () => {
    assert.match(src, /NestableDraggableFlatList[\s\S]*?data=\{\s*visibleItems\s*\}/);
  });

  it("drag-end remaps the visible slice + unrendered tail to preserve the full-list order", () => {
    // Without this remap, dragging within the first 20 items would
    // re-sortOrder items 21..N to 0..N-1 alongside the visible slice
    // and shuffle them relative to each other.
    assert.match(src, /const\s+visibleIds\s*=\s*new\s+Set\(\s*visibleItems\.map/);
    assert.match(
      src,
      /const\s+tail\s*=\s*items\.filter\(\s*\(\s*i\s*\)\s*=>\s*!\s*visibleIds\.has\(\s*i\.id\s*\)\s*\)/,
    );
    assert.match(
      src,
      /reorderItemsInCollection\(\s*activeCollection\.id\s*,\s*\[\s*\.\.\.data\s*,\s*\.\.\.tail\s*\]\.map\(\s*\(\s*i\s*\)\s*=>\s*i\.id\s*\)\s*\)/,
    );
  });

  it("selection-mode branch feeds visibleItems into a FlatList (VM-E — not items, not a .map)", () => {
    // Post VM-E the owner+selection-mode branch renders a `<FlatList>` with
    // `data={visibleItems}` (NOT `data={items}` — the chunked-window mount
    // bound from VM-A/B must still apply). The pre-VM-E `.map()` over
    // visibleItems is gone — FlatList's renderItem handles the iteration
    // and React.memo can actually skip unchanged rows. The data source
    // MUST stay on `visibleItems` so the chunked window still bounds the
    // mount count in selection mode too. Post VM-F the renderItem is the
    // hoisted `renderSelectableRow` useCallback (the `<SelectableItemRow>`
    // JSX lives inside that callback rather than inline) — both shapes are
    // valid; the file just has to reference SelectableItemRow somewhere.
    assert.match(src, /<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}/);
    assert.match(src, /<SelectableItemRow/);
    // The selection-mode FlatList lives inside the ternary `: isOwner && selectionMode ?`
    // branch — pin the structural shape so a regression that swaps `data`
    // back to `items` fails loudly.
    assert.match(
      src,
      /if\s*\(isOwner\s*&&\s*selectionMode\s*&&\s*allItems\.length\s*>\s*0\)\s*\{[\s\S]*?<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}/,
    );
  });

  it("masonry branch feeds visibleItems into a FlatList numColumns={masonryColumnCount} (VM-C)", () => {
    // Post VM-C the viewer/read-only branch renders a `<FlatList>` with
    // `numColumns` and `data={visibleItems}` — FlatList itself handles
    // the column distribution, so the previous `distributeIntoMasonryColumns`
    // helper + inline modulo split are gone. The data source MUST stay on
    // `visibleItems` (not `items`) so the chunked window still bounds the
    // mount count, and `numColumns={masonryColumnCount}` MUST consume the
    // shared responsive value (2 mobile / 3 tablet / 4 desktop) so it can't
    // drift from getMasonryRowLayout's divisor.
    assert.match(src, /<FlatList[\s\S]*?data=\{\s*visibleItems\s*\}[\s\S]*?\/>/);
    assert.match(src, /<FlatList[\s\S]*?numColumns=\{\s*masonryColumnCount\s*\}[\s\S]*?\/>/);
    assert.match(src, /<FlatList[\s\S]*?keyExtractor=\{\s*\(item\)\s*=>\s*item\.id\s*\}[\s\S]*?\/>/);
  });

  it("no list renderer ever passes an unbounded array as data (only the chunked visibleItems window)", () => {
    // The negative companion to the positive `data={visibleItems}` pins
    // above: the positive assertions prove SOME list uses the window, but a
    // future contributor swapping ONE of the three renderers (viewer
    // FlatList, selection FlatList, drag NestableDraggableFlatList) to
    // `data={items}` (or the wider allItems/filteredItems arrays) would
    // silently re-introduce the unbounded mount the whole VM series was
    // designed to prevent — and the positive pins would still pass because
    // the OTHER renderers still match. The blanket doesNotMatch closes that
    // per-renderer regression vector.
    assert.doesNotMatch(src, /data=\{\s*items\s*\}/);
    assert.doesNotMatch(src, /data=\{\s*allItems\s*\}/);
    assert.doesNotMatch(src, /data=\{\s*filteredItems\s*\}/);
  });

  it("EmptyState branches still gate off items.length / allItems.length — NOT visibleItems.length", () => {
    // The "no items" + "no filter matches" empty-state cards must fire
    // when the underlying list is empty, not when the visible window is
    // empty (the window is bounded — visibleItems.length === 0 only
    // when items.length === 0, but pinning the original condition
    // closes the regression vector).
    assert.match(src, /allItems\.length\s*===\s*0\s*\?\s*\(\s*<EmptyState[\s\S]*?icon="✨"/);
    assert.match(src, /:\s*items\.length\s*===\s*0\s*\?\s*\(\s*<EmptyState[\s\S]*?icon="🔎"/);
  });

  it("renders the Load more CTA gated on hasMore", () => {
    // VM-D extracted the inline `{hasMore ? <Pressable .../> : null}` JSX
    // into a `const loadMoreCta = hasMore ? (<Pressable .../>) : null` so
    // both the viewer-FlatList ListFooterComponent path and the nestable
    // path can reuse the same node. The gating condition is still on
    // `hasMore`, the click target is still `loadMore`, and the renderer is
    // still a `<Pressable>` — the `{` JSX-expression brace is gone because
    // the conditional now lives in a `const` declaration, not in JSX.
    // HM-A wrapped the declaration in a useMemo factory (stable element
    // identity), so the conditional now sits inside `useMemo(() => ...)`.
    assert.match(
      src,
      /loadMoreCta\s*=\s*useMemo\(\s*\(\)\s*=>\s*\n?\s*hasMore\s*\?\s*\(\s*\n\s*<Pressable[\s\S]*?onPress=\{\s*loadMore\s*\}/,
    );
  });

  it("Load more CTA passes the remaining count (items.length - visibleItems.length) to the t() formatter", () => {
    assert.match(
      src,
      /t\(\s*"loadMoreItems"\s*,\s*\{\s*count:\s*items\.length\s*-\s*visibleItems\.length\s*\}\s*\)/,
    );
  });

  it("Load more CTA wires accessibilityLabel + accessibilityHint for VoiceOver", () => {
    assert.match(src, /accessibilityLabel=\{\s*t\(\s*"loadMoreItemsA11y"/);
    assert.match(src, /accessibilityHint=\{\s*t\(\s*"loadMoreItemsHint"\s*\)\s*\}/);
  });

  it("declares loadMore / loadMoreText styles for the CTA", () => {
    assert.match(src, /loadMore:\s*\{[\s\S]*?borderRadius:[\s\S]*?\}/);
    assert.match(src, /loadMoreText:\s*\{[\s\S]*?fontFamily:\s*FONT_BODY_BOLD/);
  });
});

describe("i18n — loadMoreItems key across all 6 supported languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares loadMoreItems + loadMoreItemsA11y + loadMoreItemsHint in the en base table", () => {
    // The en table defines the TranslationKey union (keyof typeof en),
    // so all three keys MUST land here — otherwise the other languages
    // can't override them.
    assert.match(src, /loadMoreItems:\s*\(params\?:\s*TranslationParams\)\s*=>/);
    assert.match(src, /loadMoreItemsA11y:\s*\(params\?:\s*TranslationParams\)\s*=>/);
    assert.match(src, /loadMoreItemsHint:\s*"[^"]+"/);
  });

  it("overrides loadMoreItems in ru / be / pl / de / es so each language has a native string", () => {
    // The `...en` spread guarantees fallback, but localized overrides
    // matter for the user-facing CTA (the user's primary language is
    // ru). The overrides must include the `{count}` placeholder so the
    // remaining-count formatting works.
    for (const lang of ["ru", "be", "pl", "de", "es"]) {
      const re = new RegExp(`const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?loadMoreItems:[\\s\\S]*?params\\?\\.count[\\s\\S]*?\\};`);
      assert.match(src, re, `${lang} table is missing a localized loadMoreItems override with a count placeholder`);
    }
  });

  it("loadMoreItems formatter routes the count placeholder through params?.count ?? 0", () => {
    // Without the `?? 0` fallback, a stray `undefined` would render
    // "Load more (undefined remaining)" in production.
    const matches = src.match(/loadMoreItems:[\s\S]*?params\?\.count\s*\?\?\s*0/g) ?? [];
    // 6 languages (en + 5 overrides).
    assert.equal(matches.length, 6, `expected 6 loadMoreItems formatters with count fallback, got ${matches.length}`);
  });
});
