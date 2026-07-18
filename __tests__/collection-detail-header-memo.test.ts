import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HM-A header-fragment memoization pins: `listTitleAndFilters` and
 * `loadMoreCta` in `app/collection/[id].tsx` are `useMemo`'d so the
 * ListHeaderComponent's children keep a stable element identity across
 * scroll-driven parent re-renders — React bails out of reconciling a subtree
 * whose element reference didn't change between passes. Both memos are
 * hoisted ABOVE the loading/not-found early returns (hooks must run
 * unconditionally), which is only legal because neither fragment touches the
 * post-narrow `activeCollection` (pageHeader/modalsBlock stay un-memoized —
 * HM-B/HM-C).
 *
 * The memo is only effective if `loadMore` is referentially stable while the
 * `items` identity is unchanged, so `lib/use-chunked-list.ts`'s callbacks are
 * pinned to their `useCallback` form here too.
 *
 * The source files pull in react-native peers and can't be loaded under
 * `node --test`, so the assertions are regex-based.
 */
function readScreenSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

function readHookSrc(): string {
  return readFileSync(path.join(process.cwd(), "lib", "use-chunked-list.ts"), "utf8");
}

describe("app/collection/[id].tsx — HM-A header-fragment memoization", () => {
  it("listTitleAndFilters is a useMemo with honest deps", () => {
    const src = readScreenSrc();
    assert.match(
      src,
      /const\s+listTitleAndFilters\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(/,
      "listTitleAndFilters must be declared via useMemo",
    );
    // Dep array carries exactly what the fragment reads: the items count
    // (empty-state gate), the filter state, and the translator. The
    // `setItemFilters` setter is React-stable and deliberately absent.
    assert.match(
      src,
      /listTitleAndFilters\s*=\s*useMemo\([\s\S]*?\[allItems\.length,\s*itemFilters,\s*t\],?\s*\n\s*\)/,
      "listTitleAndFilters deps must be [allItems.length, itemFilters, t]",
    );
  });

  it("loadMoreCta is a useMemo with honest deps", () => {
    const src = readScreenSrc();
    assert.match(
      src,
      /const\s+loadMoreCta\s*=\s*useMemo\(\s*\(\)\s*=>\s*\n?\s*hasMore\s*\?/,
      "loadMoreCta must be declared via useMemo, gated on hasMore inside the factory",
    );
    assert.match(
      src,
      /loadMoreCta\s*=\s*useMemo\([\s\S]*?\[hasMore,\s*loadMore,\s*items\.length,\s*visibleItems\.length,\s*t\],?\s*\n\s*\)/,
      "loadMoreCta deps must be [hasMore, loadMore, items.length, visibleItems.length, t]",
    );
  });

  it("both memos are hoisted ABOVE the loading/not-found early returns", () => {
    const src = readScreenSrc();
    const firstEarlyReturn = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(firstEarlyReturn > 0, "expected the loadingRemote early return to exist");
    const titleDecl = src.indexOf("const listTitleAndFilters = useMemo(");
    const ctaDecl = src.indexOf("const loadMoreCta = useMemo(");
    assert.ok(titleDecl > 0 && titleDecl < firstEarlyReturn, "listTitleAndFilters memo must sit above the early returns (hook-order invariant)");
    assert.ok(ctaDecl > 0 && ctaDecl < firstEarlyReturn, "loadMoreCta memo must sit above the early returns (hook-order invariant)");
  });

  it("neither memoized fragment touches the post-narrow activeCollection", () => {
    const src = readScreenSrc();
    // Both factories live above `const activeCollection = collection;` where
    // the narrowed binding doesn't exist yet — referencing it would be a TDZ
    // crash at runtime. Pin the invariant so a future edit that folds
    // collection chrome into these memos fails loudly.
    const titleBlock = src.match(/const\s+listTitleAndFilters\s*=\s*useMemo\([\s\S]*?\[allItems\.length,\s*itemFilters,\s*t\],?\s*\n\s*\);/)?.[0] ?? "";
    const ctaBlock = src.match(/const\s+loadMoreCta\s*=\s*useMemo\([\s\S]*?\[hasMore,\s*loadMore,\s*items\.length,\s*visibleItems\.length,\s*t\],?\s*\n\s*\);/)?.[0] ?? "";
    assert.ok(titleBlock.length > 0 && ctaBlock.length > 0, "expected to extract both memo blocks");
    assert.doesNotMatch(titleBlock, /activeCollection/);
    assert.doesNotMatch(ctaBlock, /activeCollection/);
  });

  it("no plain-const shadow re-declares either fragment below the early returns", () => {
    const src = readScreenSrc();
    const titleDecls = src.match(/const\s+listTitleAndFilters\s*=/g) ?? [];
    const ctaDecls = src.match(/const\s+loadMoreCta\s*=/g) ?? [];
    assert.equal(titleDecls.length, 1, `expected exactly 1 listTitleAndFilters declaration, got ${titleDecls.length}`);
    assert.equal(ctaDecls.length, 1, `expected exactly 1 loadMoreCta declaration, got ${ctaDecls.length}`);
  });
});

describe("lib/use-chunked-list.ts — stable loadMore/reset callbacks", () => {
  it("loadMore is a useCallback keyed on [items, safePageSize]", () => {
    const src = readHookSrc();
    // The functional setCount + clampCount body reads `items.length`, so the
    // deps carry the `items` identity (an identity swap already resets the
    // window via the effect, so the fresh closure is never stale).
    assert.match(
      src,
      /const\s+loadMore\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*\n\s*setCount\(\(current\)\s*=>\s*clampCount\(current\s*\+\s*safePageSize,\s*safePageSize,\s*items\.length\)\);\s*\n\s*\},\s*\[items,\s*safePageSize\]\)/,
    );
  });

  it("reset is a useCallback keyed on [safePageSize]", () => {
    const src = readHookSrc();
    assert.match(
      src,
      /const\s+reset\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*\n\s*setCount\(safePageSize\);\s*\n\s*\},\s*\[safePageSize\]\)/,
    );
  });

  it("useCallback is imported from react", () => {
    const src = readHookSrc();
    assert.match(src, /import\s*\{[^}]*useCallback[^}]*\}\s*from\s*"react"/);
  });
});
