import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  clampCount,
  DEFAULT_CHUNK_PAGE_SIZE,
  resolvePageSize,
} from "@/lib/use-chunked-list";

/**
 * `useChunkedList` returns a windowed slice of an in-memory array so the
 * collection-detail screen mounts only ~20 item cards (+ their remote
 * images) at first instead of all 500. The React hook itself can't run
 * under node-tests (no React renderer wired here); we cover the pure
 * helpers behaviourally and the hook structurally.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("clampCount (pure window math)", () => {
  it("returns current when it sits inside [pageSize, total]", () => {
    assert.equal(clampCount(20, 20, 100), 20);
    assert.equal(clampCount(40, 20, 100), 40);
    assert.equal(clampCount(99, 20, 100), 99);
  });

  it("pins current to total when current > total", () => {
    // loadMore() past the end of the list must not produce a visible
    // window larger than items.length — otherwise the slice math
    // overshoots and the "load more" CTA flickers back into view.
    assert.equal(clampCount(120, 20, 100), 100);
    assert.equal(clampCount(1_000_000, 20, 3), 3);
  });

  it("falls back to min(pageSize, total) for non-positive / non-finite current", () => {
    assert.equal(clampCount(0, 20, 100), 20);
    assert.equal(clampCount(-5, 20, 100), 20);
    assert.equal(clampCount(Number.NaN, 20, 100), 20);
    assert.equal(clampCount(Number.POSITIVE_INFINITY, 20, 100), 100);
  });

  it("handles total < pageSize by returning total (one short page)", () => {
    // A collection with 3 items shows 3, not 20 — the "Load more" CTA
    // gates on hasMore, so a short list should already be fully visible.
    assert.equal(clampCount(20, 20, 3), 3);
    assert.equal(clampCount(0, 20, 3), 3);
  });

  it("handles empty list (total = 0) by returning 0", () => {
    assert.equal(clampCount(20, 20, 0), 0);
    assert.equal(clampCount(0, 20, 0), 0);
  });

  it("floors fractional current/total inputs (slice() needs integers)", () => {
    assert.equal(clampCount(20.7, 20, 100), 20);
    assert.equal(clampCount(50, 20, 100.9), 50);
  });
});

describe("resolvePageSize (pure pageSize clamp)", () => {
  it("returns the input when it's a positive finite integer", () => {
    assert.equal(resolvePageSize(20), 20);
    assert.equal(resolvePageSize(1), 1);
    assert.equal(resolvePageSize(500), 500);
  });

  it("falls back to the default for non-finite / non-positive overrides", () => {
    // A caller passing 0 would render forever-empty windows; NaN/Infinity
    // would break the slice math. The clamp returns the default in every
    // case so the hook can't be turned into a stall.
    assert.equal(resolvePageSize(0), DEFAULT_CHUNK_PAGE_SIZE);
    assert.equal(resolvePageSize(-1), DEFAULT_CHUNK_PAGE_SIZE);
    assert.equal(resolvePageSize(Number.NaN), DEFAULT_CHUNK_PAGE_SIZE);
    assert.equal(resolvePageSize(Number.POSITIVE_INFINITY), DEFAULT_CHUNK_PAGE_SIZE);
  });

  it("floors fractional page sizes (slice() needs integers)", () => {
    assert.equal(resolvePageSize(20.9), 20);
    assert.equal(resolvePageSize(1.5), 1);
  });

  it("the default page size is 20 (one screen of item cards)", () => {
    // Pinned so a future "let's try 100" mistake fails CI loudly — the
    // whole point of the hook is bounded mount-count and 100 image-heavy
    // rows is the threshold where iOS starts dropping frames.
    assert.equal(DEFAULT_CHUNK_PAGE_SIZE, 20);
  });
});

describe("useChunkedList hook contract (structural)", () => {
  const src = read("lib/use-chunked-list.ts");

  it("imports useState + useEffect + useMemo from react", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*"react"/,
    );
    assert.match(
      src,
      /import\s*\{[^}]*\buseState\b[^}]*\}\s*from\s*"react"/,
    );
    assert.match(
      src,
      /import\s*\{[^}]*\buseMemo\b[^}]*\}\s*from\s*"react"/,
    );
  });

  it("seeds the count state lazily (function form, not eager)", () => {
    // `useState(safePageSize)` would re-evaluate the expression every
    // render even though only the first matters. `useState(() => ...)`
    // runs the initializer exactly once.
    assert.match(src, /useState<number>\(\s*\(\s*\)\s*=>\s*safePageSize\s*\)/);
  });

  it("memoizes the visible slice via useMemo so identity is stable across renders", () => {
    // Without useMemo, every render produces a new array reference for
    // `visibleItems`, which would re-trigger any child useEffect that
    // depends on it (e.g. a FlatList's data prop comparison).
    assert.match(src, /useMemo\(\s*\(\s*\)\s*=>\s*items\.slice\(/);
  });

  it("auto-resets the window when `items` identity changes (via useEffect dep array)", () => {
    // The identity reset is THE invariant of the hook: a user who scrolled
    // to "show 200" then filtered down to 3 matches must NOT see 200 worth
    // of stale rows. The effect is keyed on [items, safePageSize] so a
    // filter swap (new array reference) snaps the count back to one page.
    assert.match(
      src,
      /useEffect\([\s\S]*?setCount\(\s*safePageSize\s*\)[\s\S]*?\},\s*\[\s*items\s*,\s*safePageSize\s*\]\s*\)/,
    );
  });

  it("loadMore clamps via clampCount so it can't overshoot total", () => {
    assert.match(
      src,
      /setCount\(\s*\(\s*current\s*\)\s*=>\s*clampCount\(\s*current\s*\+\s*safePageSize/,
    );
  });

  it("threads resolvePageSize so non-finite/non-positive pageSize falls back to default", () => {
    assert.match(src, /const\s+safePageSize\s*=\s*resolvePageSize\(pageSize\)/);
  });

  it("hasMore compares items.length against the slice length, not the raw count", () => {
    // Comparing against `count` would be wrong once clampCount pins
    // count to total — hasMore would falsely stay true for a moment.
    // Comparing against the slice length is the safe shape.
    assert.match(src, /hasMore\s*=\s*items\.length\s*>\s*visibleItems\.length/);
  });

  it("exports the ChunkedList<T> result type so callers can annotate the hook return", () => {
    assert.match(src, /export\s+type\s+ChunkedList<T>\s*=\s*\{/);
  });
});
