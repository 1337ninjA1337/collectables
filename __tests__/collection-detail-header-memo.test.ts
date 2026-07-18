import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HM-A/HM-B header-fragment memoization pins: `listTitleAndFilters`,
 * `loadMoreCta` (HM-A) and `pageHeader` (HM-B) in `app/collection/[id].tsx`
 * are `useMemo`'d so the ListHeaderComponent's children keep a stable element
 * identity across scroll-driven parent re-renders — React bails out of
 * reconciling a subtree whose element reference didn't change between passes.
 * All three memos are hoisted ABOVE the loading/not-found early returns
 * (hooks must run unconditionally), which is only legal because none of them
 * touches the post-narrow `activeCollection` — HM-A's fragments don't need
 * it, and HM-B's pageHeader factory guards on the still-nullable
 * `collection` and derives ownership locally. The handlers pageHeader closes
 * over (`confirmAndDeleteCollection` / `handleDeleteCollection` /
 * `handleExportPdf` / `openEditModal`) were promoted to nullable-guarded
 * useCallbacks above the returns for the same reason (modalsBlock stays
 * un-memoized — HM-C).
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

describe("app/collection/[id].tsx — HM-B pageHeader memoization", () => {
  it("pageHeader is a useMemo whose factory guards on the nullable collection", () => {
    const src = readScreenSrc();
    assert.match(
      src,
      /const\s+pageHeader\s*=\s*useMemo\(\(\)\s*=>\s*\{\s*\n\s*if\s*\(!collection\)\s*return\s+null;/,
      "pageHeader must be a useMemo that returns null while collection is unresolved",
    );
  });

  it("pageHeader factory derives ownership locally instead of reading post-narrow bindings", () => {
    const src = readScreenSrc();
    assert.match(
      src,
      /const\s+owner\s*=\s*user\?\.id\s*===\s*collection\.ownerUserId;/,
      "the factory must compute `owner` from the nullable-guarded collection",
    );
    const block = extractPageHeaderMemo(src);
    assert.doesNotMatch(block, /activeCollection/);
    assert.doesNotMatch(block, /\bisOwner\b/);
  });

  it("pageHeader memo is hoisted ABOVE the early returns and declared exactly once", () => {
    const src = readScreenSrc();
    const firstEarlyReturn = src.indexOf("if (loadingRemote && !collection)");
    const decl = src.indexOf("const pageHeader = useMemo(");
    assert.ok(decl > 0 && decl < firstEarlyReturn, "pageHeader memo must sit above the early returns (hook-order invariant)");
    const decls = src.match(/const\s+pageHeader\s*=/g) ?? [];
    assert.equal(decls.length, 1, `expected exactly 1 pageHeader declaration, got ${decls.length}`);
  });

  it("pageHeader deps carry the values the fragment renders", () => {
    const src = readScreenSrc();
    const block = extractPageHeaderMemo(src);
    // Spot-check the load-bearing deps rather than pinning the full array
    // order: collection (all chrome), allItems (summary counts), theme
    // (summary cards), exporting/selectionMode (action buttons), and the
    // four promoted handlers.
    for (const dep of [
      "collection,",
      "allItems,",
      "theme,",
      "user?.id,",
      "exporting,",
      "selectionMode,",
      "openEditModal,",
      "enterSelectionMode,",
      "handleExportPdf,",
      "handleDeleteCollection,",
    ]) {
      assert.ok(block.includes(dep), `pageHeader dep array must include ${dep.replace(/,$/, "")}`);
    }
  });

  it("the four handlers pageHeader closes over are nullable-guarded useCallbacks above the returns", () => {
    const src = readScreenSrc();
    const firstEarlyReturn = src.indexOf("if (loadingRemote && !collection)");
    assert.match(src, /const\s+confirmAndDeleteCollection\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{\s*\n\s*if\s*\(!collection\)\s*return;/);
    assert.match(src, /const\s+handleDeleteCollection\s*=\s*useCallback\(/);
    assert.match(src, /const\s+handleExportPdf\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{\s*\n\s*if\s*\(!collection\)\s*return;/);
    assert.match(src, /const\s+openEditModal\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*\n\s*if\s*\(!collection\)\s*return;/);
    for (const name of ["confirmAndDeleteCollection", "handleDeleteCollection", "handleExportPdf", "openEditModal"]) {
      const decl = src.indexOf(`const ${name} = useCallback(`);
      assert.ok(decl > 0 && decl < firstEarlyReturn, `${name} must be declared above the early returns`);
      // No plain-function shadow left behind below the returns.
      assert.doesNotMatch(src, new RegExp(`(?:async\\s+)?function\\s+${name}\\b`));
    }
  });
});

function extractPageHeaderMemo(src: string): string {
  const start = src.indexOf("const pageHeader = useMemo(");
  assert.ok(start > 0, "pageHeader useMemo declaration not found");
  // The memo ends at the first `]);` at 2-space indentation after the dep
  // array — the multi-line dep list closes with `  ]);`.
  const end = src.indexOf("\n  ]);", start);
  assert.ok(end > start, "pageHeader memo closing `]);` not found");
  return src.slice(start, end + 6);
}

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
