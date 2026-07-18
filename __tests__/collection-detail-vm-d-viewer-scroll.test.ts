import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-D structural pins: the viewer/read-only branch in
 * `app/collection/[id].tsx` no longer renders its `<FlatList numColumns={2}>`
 * nested inside a `<Screen nestable>` ScrollView with `scrollEnabled={false}`.
 * Instead the screen branches at the top of `return` — when the viewer-
 * FlatList branch is active, the early-return mounts `<Screen scroll={false}>`
 * with a SINGLE `<FlatList>` that owns the outer scroll. iOS-only row
 * recycling depends on the FlatList being the scrollable surface, so the
 * `initialNumToRender` / `maxToRenderPerBatch` / `windowSize` props are now
 * load-bearing — without them no virtualization happens.
 *
 * The source file pulls in `@expo/vector-icons` + react-native peers and
 * can't be loaded under `node --test`, so the assertions are regex-based.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("app/collection/[id].tsx — VM-D viewer-branch scroll hoist", () => {
  it("declares the isViewerFlatListBranch flag with the documented gate", () => {
    const src = readSrc();
    // The flag must gate on items.length > 0 (FlatList only useful when
    // there are items) AND (!isOwner OR (!selectionMode && sort !== "default")).
    // - !isOwner: any non-owner viewer falls into this branch.
    // - isOwner && sort !== "default": owners viewing a sorted list also
    //   fall through because drag-mode is locked behind sort === "default"
    //   (see VM-D and sort-gate.test).
    // - isOwner && selectionMode: stays on the inline selection path because
    //   selection renders a non-virtualized vertical list (VM-E).
    assert.match(
      src,
      /const\s+isViewerFlatListBranch\s*=\s*\n?\s*items\.length\s*>\s*0\s*&&\s*\(\s*!\s*isOwner\s*\|\|\s*\(\s*!\s*selectionMode\s*&&\s*itemFilters\.sort\s*!==\s*"default"\s*\)\s*\)/,
    );
  });

  it("early-returns when isViewerFlatListBranch is true", () => {
    const src = readSrc();
    // The `if (isViewerFlatListBranch) { return (...) }` form is the marker
    // that VM-D actually wires the conditional branching at the top of the
    // returned JSX — without it the FlatList would never own the scroll.
    assert.match(
      src,
      /if\s*\(\s*isViewerFlatListBranch\s*\)\s*\{\s*\n\s*return\s*\(/,
    );
  });

  it("viewer-branch FlatList is wrapped in <Screen scroll={false}>", () => {
    const src = readSrc();
    // VM-D replaces `<Screen nestable>` with `<Screen scroll={false}>` for the
    // viewer FlatList path so the Screen doesn't render its own ScrollView —
    // the FlatList becomes the scrollable surface.
    assert.match(
      src,
      /if\s*\(\s*isViewerFlatListBranch\s*\)[\s\S]*?<Screen\s+scroll=\{\s*false\s*\}\s*>/,
    );
  });

  it("non-viewer return keeps <Screen nestable> for the drag-mode + selection paths", () => {
    const src = readSrc();
    // The nestable Screen is still needed for owner drag-mode (it requires
    // NestableScrollContainer's gesture coordination) and selection-mode
    // (VM-E target). Without this branch they'd lose their outer scroll.
    assert.match(src, /<Screen\s+nestable\s+refreshing=\{\s*refreshing\s*\}\s+onRefresh=\{\s*handleRefresh\s*\}\s*>/);
  });

  it("viewer FlatList wires virtualization props (initialNumToRender / maxToRenderPerBatch / windowSize)", () => {
    const src = readSrc();
    // These are the props that actually unlock row recycling. Each one is a
    // load-bearing literal — a missing prop falls back to the React Native
    // default which is far too high (10/10/21 → ~210 mounted rows). The
    // values match the task spec.
    assert.match(src, /<FlatList[\s\S]*?initialNumToRender=\{\s*10\s*\}[\s\S]*?\/>/);
    assert.match(src, /<FlatList[\s\S]*?maxToRenderPerBatch=\{\s*8\s*\}[\s\S]*?\/>/);
    assert.match(src, /<FlatList[\s\S]*?windowSize=\{\s*5\s*\}[\s\S]*?\/>/);
  });

  it("viewer FlatList enables removeClippedSubviews on iOS only", () => {
    const src = readSrc();
    // `removeClippedSubviews` is a known performance footgun on Android (it
    // can hide rows that should still render) but a major win on iOS for
    // long lists. The Platform.OS gate matches RN community guidance.
    assert.match(
      src,
      /<FlatList[\s\S]*?removeClippedSubviews=\{\s*Platform\.OS\s*===\s*"ios"\s*\}[\s\S]*?\/>/,
    );
  });

  it("viewer FlatList passes the page-header chrome via ListHeaderComponent", () => {
    const src = readSrc();
    // The hero + summary + total + reactions + owner-actions + listWrap
    // (title + filters) all move into ListHeaderComponent so the FlatList is
    // the outermost scrollable element. Without this hoist the chrome would
    // sit outside the FlatList and the FlatList would only scroll the items
    // — broken UX.
    assert.match(src, /<FlatList[\s\S]*?ListHeaderComponent=\{[\s\S]*?pageHeader[\s\S]*?\}/);
    assert.match(src, /<FlatList[\s\S]*?ListHeaderComponent=\{[\s\S]*?listTitleAndFilters[\s\S]*?\}/);
  });

  it("viewer FlatList paginates via onEndReached (no Load-more CTA in the footer)", () => {
    const src = readSrc();
    // The manual Load-more CTA was the nested-ScrollView era's pagination
    // trigger. Now that the viewer FlatList owns scroll, `onEndReached`
    // auto-extends the chunked window as the user approaches the end —
    // `hasMore ? loadMore : undefined` so a fully-extended window stops
    // the callback entirely. The 0.5 threshold means "half a viewport
    // before the end", per the task spec.
    const viewerBlock = src.match(/<FlatList[\s\S]*?numColumns=\{\s*2\s*\}[\s\S]*?\/>/);
    assert.ok(viewerBlock, "viewer FlatList (numColumns={2}) not found");
    assert.match(viewerBlock[0], /onEndReached=\{\s*hasMore\s*\?\s*loadMore\s*:\s*undefined\s*\}/);
    assert.match(viewerBlock[0], /onEndReachedThreshold=\{\s*0\.5\s*\}/);
    assert.doesNotMatch(viewerBlock[0], /ListFooterComponent/);
  });

  it("viewer FlatList carries its own RefreshControl (Screen scroll=false doesn't pass it through)", () => {
    const src = readSrc();
    // When Screen.scroll=false the Screen renders a plain View — no
    // ScrollView, no refreshControl prop forwarding. The viewer-FlatList
    // path must mount its own RefreshControl directly on the FlatList so
    // pull-to-refresh keeps working.
    assert.match(src, /import\s*\{[^}]*\bRefreshControl\b[^}]*\}\s*from\s*"react-native"/);
    assert.match(
      src,
      /<FlatList[\s\S]*?refreshControl=\{\s*\n?\s*<RefreshControl[\s\S]*?refreshing=\{\s*!!refreshing\s*\}[\s\S]*?onRefresh=\{\s*handleRefresh\s*\}[\s\S]*?\/>[\s\S]*?\}/,
    );
  });

  it("viewer FlatList gets flex:1 via the viewerFlatList style", () => {
    const src = readSrc();
    // Without `style={{flex:1}}` the FlatList shrinks to its content size
    // and the scrollable viewport collapses to ~0 — items pile up and
    // virtualization can't fire. The style indirection (viewerFlatList) is
    // there so the style can be tweaked from one place.
    assert.match(src, /<FlatList[\s\S]*?style=\{\s*styles\.viewerFlatList\s*\}[\s\S]*?\/>/);
    assert.match(src, /viewerFlatList:\s*\{[\s\S]*?flex:\s*1[\s\S]*?\}/);
  });

  it("declares pageHeader / listTitleAndFilters / loadMoreCta / modalsBlock consts so both paths share JSX", () => {
    const src = readSrc();
    // Pre-VM-D the return rendered every JSX node inline. VM-D introduces
    // these four shared consts so the early-return (viewer-FlatList) and
    // the inline return (drag/selection/empty) can reuse the same chrome
    // without duplicating the JSX. A regression where one of them gets
    // inlined again would mean only one path renders correctly.
    assert.match(src, /const\s+pageHeader\s*=\s*useMemo\(\(\)\s*=>\s*\{/);
    // HM-A memoized the two lightweight fragments (stable element identity
    // for the ListHeaderComponent children); the declaration shape moved
    // from a plain const to a useMemo factory.
    assert.match(src, /const\s+listTitleAndFilters\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(/);
    assert.match(src, /const\s+loadMoreCta\s*=\s*useMemo\(\s*\(\)\s*=>\s*\n?\s*hasMore\s*\?/);
    assert.match(src, /const\s+modalsBlock\s*=\s*\(/);
  });

  it("modalsBlock is rendered AS A SIBLING of FlatList (so move/share/edit/currency modals still mount on the viewer branch)", () => {
    const src = readSrc();
    // The modals must be siblings of the FlatList, not children — a Modal
    // inside FlatList's renderItem/header/footer would re-mount on every
    // scroll. The structural pin is `<FlatList ... /> </FlatList? no — />
    // {modalsBlock}` right before `</Screen>` inside the early-return.
    assert.match(
      src,
      /if\s*\(\s*isViewerFlatListBranch\s*\)[\s\S]*?<FlatList[\s\S]*?\/>\s*\n\s*\{\s*modalsBlock\s*\}\s*\n?\s*<\/Screen>/,
    );
  });

  it("modalsBlock is also rendered in the non-viewer fallback return so both branches share modals", () => {
    const src = readSrc();
    // Two `{modalsBlock}` references — one per return path. A regression
    // where the fallback path forgets `{modalsBlock}` would silently break
    // the move/share/edit modals when an owner enters selection mode (they
    // still need to be able to open the share or edit sheet).
    const refs = src.match(/\{\s*modalsBlock\s*\}/g) ?? [];
    // Three render sites since BB-B: viewer early-return, selection
    // early-return, and the nestable fallback.
    assert.equal(refs.length, 3, `expected exactly 3 {modalsBlock} renders, got ${refs.length}`);
  });

  it("Screen scroll=false path makes the inner View flex:1 (so the nested FlatList has a viewport to scroll inside)", () => {
    // Pinned in components/screen.tsx: when scroll=false the wrapping View
    // must apply `flex:1` so a child FlatList/SectionList can size its
    // scrollable viewport. Without flex:1 the View shrinks to its intrinsic
    // size, the FlatList renders with height 0, and nothing scrolls.
    const screenSrc = readFileSync(path.join(process.cwd(), "components", "screen.tsx"), "utf8");
    assert.match(screenSrc, /fillContent:\s*\{[\s\S]*?flex:\s*1[\s\S]*?\}/);
    assert.match(screenSrc, /<View\s+style=\{\s*staticInnerStyle\s*\}\s*>/);
    assert.match(screenSrc, /staticInnerStyle\s*=\s*\[\s*innerStyle\s*,\s*styles\.fillContent\s*\]/);
  });

  it("non-viewer fallback no longer carries a dead masonry FlatList block", () => {
    const src = readSrc();
    // The pre-VM-D inline `<FlatList numColumns={2} scrollEnabled={false}>`
    // block lived inside the listWrap's ternary chain. VM-D removes it
    // because the viewer-FlatList branch handles all those cases via the
    // early-return — leaving it would be dead code AND would mismatch the
    // scrollEnabled={false} test pin. The viewer FlatList (the one that
    // OWNS the outer scroll post-VM-D) is identified by `numColumns={2}`,
    // and that block must NOT carry scrollEnabled={false}. The selection-
    // mode FlatList from VM-E lives in a different branch and intentionally
    // keeps scrollEnabled={false} because the outer ScrollView still owns
    // scroll for selection mode.
    const viewerFlatListBlock = src.match(/<FlatList[\s\S]*?numColumns=\{\s*2\s*\}[\s\S]*?\/>/);
    assert.ok(viewerFlatListBlock, "viewer FlatList (numColumns={2}) not found");
    assert.doesNotMatch(viewerFlatListBlock[0], /scrollEnabled=\{\s*false\s*\}/);
  });
});
