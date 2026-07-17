import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * onEndReached pagination pins: the two scroll-owning FlatList branches in
 * `app/collection/[id].tsx` (viewer VM-D, selection BB-B) auto-extend the
 * chunked window via `onEndReached={hasMore ? loadMore : undefined}` +
 * `onEndReachedThreshold={0.5}` instead of the manual Load-more CTA. The CTA
 * itself survives ONLY for the nestable drag-mode fallback, where the
 * NestableDraggableFlatList doesn't own scroll (the outer ScrollView does)
 * so `onEndReached` can't fire reliably.
 *
 * The source file pulls in react-native peers and can't be loaded under
 * `node --test`, so the assertions are regex-based.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("app/collection/[id].tsx — onEndReached pagination", () => {
  it("both scroll-owning FlatLists wire onEndReached gated on hasMore", () => {
    const src = readSrc();
    // Exactly two sites: viewer branch + selection branch. The `hasMore ?
    // loadMore : undefined` gate matters — once the window covers every
    // item, FlatList must stop invoking the callback (an ungated loadMore
    // would keep firing a state set per end-scroll).
    const gated = src.match(/onEndReached=\{\s*hasMore\s*\?\s*loadMore\s*:\s*undefined\s*\}/g) ?? [];
    assert.equal(gated.length, 2, `expected 2 gated onEndReached sites, got ${gated.length}`);
    const thresholds = src.match(/onEndReachedThreshold=\{\s*0\.5\s*\}/g) ?? [];
    assert.equal(thresholds.length, 2, `expected 2 onEndReachedThreshold sites, got ${thresholds.length}`);
  });

  it("never passes an ungated loadMore to onEndReached", () => {
    const src = readSrc();
    assert.doesNotMatch(
      src,
      /onEndReached=\{\s*loadMore\s*\}/,
      "onEndReached must be gated on hasMore so a fully-extended window stops the callback",
    );
  });

  it("the manual Load-more CTA renders ONLY in the nestable drag-mode fallback", () => {
    const src = readSrc();
    // The const declaration + exactly one render site ({loadMoreCta} in the
    // fallback return). The viewer/selection early-returns must not render
    // it — their pagination is scroll-driven.
    assert.match(src, /const\s+loadMoreCta\s*=\s*hasMore\s*\?/);
    const renders = src.match(/\{\s*loadMoreCta\s*\}/g) ?? [];
    assert.equal(renders.length, 1, `expected exactly 1 {loadMoreCta} render (drag fallback), got ${renders.length}`);
    // And that one render site lives in the nestable fallback return, after
    // the drag-mode ternary chain.
    assert.match(
      src,
      /<Screen\s+nestable[\s\S]*?NestableDraggableFlatList[\s\S]*?\{\s*loadMoreCta\s*\}/,
    );
  });

  it("neither scroll-owning branch carries a ListFooterComponent CTA", () => {
    const src = readSrc();
    // Selection keeps a footer (the bulk-bar spacer) but it must not wrap
    // the CTA; the viewer branch has no footer at all.
    assert.doesNotMatch(src, /ListFooterComponent=\{[\s\S]{0,200}?loadMoreCta/);
  });

  it("drag-mode CTA still routes through the hook's loadMore with the a11y strings", () => {
    const src = readSrc();
    // The surviving CTA keeps its press target + i18n a11y contract so the
    // drag-mode path (no onEndReached) still paginates accessibly.
    assert.match(src, /loadMoreCta\s*=\s*hasMore\s*\?\s*\(\s*\n\s*<Pressable[\s\S]*?onPress=\{\s*loadMore\s*\}/);
    assert.match(src, /accessibilityLabel=\{t\("loadMoreItemsA11y"/);
    assert.match(src, /accessibilityHint=\{t\("loadMoreItemsHint"\)\}/);
  });
});
