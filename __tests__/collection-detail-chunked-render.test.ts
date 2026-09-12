import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertMatchesInEveryNonBaseLocaleBody,
  assertValueInEveryLocale,
} from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural pins for the chunked-rendering wiring in `app/collection/[id].tsx`.
 * Without these, a future refactor could silently revert any of the three
 * render branches (drag / selection / masonry) back to `items.map(...)` and
 * the iOS memory regression would return undetected.
 */

describe("app/collection/[id].tsx — chunked item rendering", () => {
  const src = read("app/collection/[id].tsx");

  it("imports useChunkedList from the shared hook module", () => {
    assert.match(src, /import\s*\{[^}]*\buseChunkedList\b[^}]*\}\s*from\s*"@\/lib\/use-chunked-list"/);
  });

  it("instantiates exactly one useChunkedList(items) hook (single shared window across the 3 render branches)", () => {
    // Multiple instances would each maintain their own count, so the
    // drag-mode branch and the selection-mode branch could be out of
    // sync — confusing behaviour and double the auto-reset cost.
    const calls = src.match(/useChunkedList\s*\(/g) ?? [];
    assert.equal(calls.length, 1, `expected exactly one useChunkedList call, got ${calls.length}`);
    assert.match(src, /useChunkedList\(\s*items\s*,\s*CHUNK_PAGE_SIZE_CARDS\s*\)/);
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
      /const\s*\{\s*visibleItems\s*,\s*hasMore\s*,\s*remaining\s*,\s*loadMore\s*\}\s*=\s*useChunkedList/,
    );
  });

  it("drag-mode branch feeds visibleItems (not items) into NestableDraggableFlatList", () => {
    assert.match(src, /NestableDraggableFlatList[\s\S]*?data=\{\s*visibleItems\s*\}/);
  });

  it("drag-end remaps the visible slice + unrendered tail to preserve the full-list order", () => {
    // Without this remap, dragging within the first 20 items would
    // re-sortOrder items 21..N to 0..N-1 alongside the visible slice
    // and shuffle them relative to each other.
    //
    // The rule was three inline lines in `onDragEnd` until 2026-09-10, when the
    // row's keyboard actions needed the same one and it moved to
    // `orderWithUnrenderedTail` in `lib/drag-reorder.ts`. What this case pins
    // is unchanged — that the drag commits the page AND the tail — but the
    // rule itself is now behaviour a suite can run, in
    // `keyboard-reorder-items.test.ts`, rather than a regex over a literal.
    //
    // What the drag hands `commitItemOrder` changed again on 2026-09-11: not
    // `data` (the list's snapshot of what it drew) but `planDragCommit`'s
    // rows, resolved against the visible list as it is NOW. The tail rule is
    // untouched by that — it still runs on whatever page it is given.
    assert.match(
      src,
      /const commitItemOrder = \(page: CollectableItem\[\]\) => \{\s*\n\s*reorderItemsInCollection\(\s*activeCollection\.id\s*,\s*orderWithUnrenderedTail\(\s*page\s*,\s*items\s*\)\s*\);/,
    );
    assert.match(src, /onDragEnd=\{\(\{ data, to \}\) => \{[\s\S]*?commitItemOrder\(plan\.rows\);/);
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

  it("renders the Load more CTA, and it is the shared button", () => {
    // VM-D extracted the inline `{hasMore ? <Pressable .../> : null}` JSX
    // into a `const loadMoreCta` so both the viewer-FlatList
    // ListFooterComponent path and the nestable path could reuse one node.
    // On 2026-09-11 the `<Pressable>` itself left: it was the third screen
    // carrying a copy of the same button, so `<LoadMoreButton>` owns the
    // markup, the three strings and the two style rules. The memo stays —
    // stable element identity is a claim about THIS screen's two render
    // paths, not about the button.
    assert.match(
      src,
      /loadMoreCta\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(\s*\n\s*<LoadMoreButton[\s\S]*?onPress=\{loadMore\}/,
    );
    assert.match(src, /import \{ LoadMoreButton \} from "@\/components\/load-more-button";/);
  });

  it("Load more CTA passes the remaining count (items.length - visibleItems.length) to the button", () => {
    // The count used to reach `t("loadMoreItems", …)` here and reaches
    // `remaining` now. Same arithmetic, and it is still this screen's, because
    // only this screen knows which list the window is over.
    assert.match(
      src,
      /remaining=\{remaining\}/,
    );
  });

  it("no longer carries its own copy of the button", () => {
    // The three i18n keys and the two style rules were the whole duplicated
    // surface; naming either again means an inline copy came back.
    assert.doesNotMatch(src, /loadMoreItemsA11y/);
    assert.doesNotMatch(src, /loadMoreItemsHint/);
    assert.doesNotMatch(src, /styles\.loadMoreText/);
    assert.doesNotMatch(src, /^\s*loadMore:\s*\{/m);
  });
});

describe("i18n — loadMoreItems key across all 6 supported languages", () => {
  const src = readI18nSource();

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
    // Per body — the slice this replaces crossed `};` and so was satisfied by
    // any later map carrying the key.
    assertMatchesInEveryNonBaseLocaleBody(
      src,
      /\bloadMoreItems:/,
      "loadMoreItems is overridden",
    );
    assertValueInEveryLocale(
      src,
      "loadMoreItems",
      /params\?\.count/,
      "loadMoreItems carries a count placeholder",
    );
  });

  it("loadMoreItems formatter routes the count placeholder through params?.count ?? 0", () => {
    // Without the `?? 0` fallback, a stray `undefined` would render
    // "Load more (undefined remaining)" in production.
    // Asked of each locale map, so a language missing the fallback is named
    // rather than hidden behind another language declaring the key twice.
    // Against the key's own VALUE, so the `?? 0` cannot be supplied by a later
    // key in the same map.
    assertValueInEveryLocale(
      src,
      "loadMoreItems",
      /params\?\.count\s*\?\?\s*0/,
      "loadMoreItems routes count through a `?? 0` fallback",
    );
  });
});
