import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VM-B structural pins: `app/collection/[id].tsx` routes its viewer-masonry
 * render through the pure `distributeIntoMasonryColumns` helper from
 * `lib/masonry.ts` (added in VM-A) instead of the inline
 * `.filter((_, i) => i % 2 === N)` pair. The source file pulls in
 * `@expo/vector-icons` + react-native peers and can't be loaded under
 * `node --test`, so the assertions are regex-based — the behavioural
 * coverage lives in `masonry.test.ts`.
 */
function readSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("app/collection/[id].tsx — masonry helper migration (VM-B)", () => {
  it("imports distributeIntoMasonryColumns from @/lib/masonry", () => {
    const src = readSrc();
    // The import line is the single source of truth that the helper is
    // wired through; without it a future contributor could revert the
    // inline modulo and only the (regex-based) assertions below would
    // catch it. Pin the import too so a stale `import` after a manual
    // deletion fails loudly.
    assert.match(
      src,
      /import\s+\{\s*distributeIntoMasonryColumns\s*\}\s+from\s+["']@\/lib\/masonry["']/,
    );
  });

  it("computes a memoized masonryColumns slice via useMemo", () => {
    const src = readSrc();
    // The memo keeps column references stable when `visibleItems` doesn't
    // change — without it every render allocates fresh column arrays and
    // ItemCard (memo-equality sensitive) would re-render gratuitously.
    assert.match(
      src,
      /const\s+masonryColumns\s*=\s*useMemo\(\s*\(\)\s*=>\s*distributeIntoMasonryColumns\(\s*visibleItems\s*,\s*2\s*\)\s*,\s*\[\s*visibleItems\s*\]\s*\)/,
    );
  });

  it("renders masonryColumns[0] in the first column", () => {
    const src = readSrc();
    assert.match(
      src,
      /\{\s*masonryColumns\[0\]\.map\(\(item\)\s*=>\s*<ItemCard\s+key=\{item\.id\}\s+item=\{item\}\s+compact\s*\/>\)\s*\}/,
    );
  });

  it("renders masonryColumns[1] in the second column", () => {
    const src = readSrc();
    assert.match(
      src,
      /\{\s*masonryColumns\[1\]\.map\(\(item\)\s*=>\s*<ItemCard\s+key=\{item\.id\}\s+item=\{item\}\s+compact\s*\/>\)\s*\}/,
    );
  });

  it("no longer carries the inline `i % 2 === N` modulo split", () => {
    const src = readSrc();
    // The whole point of VM-B is to centralise the round-robin math
    // inside `distributeIntoMasonryColumns`. A regression here means
    // someone re-introduced the inline shape — fail loudly.
    assert.doesNotMatch(src, /i\s*%\s*2\s*===\s*0/);
    assert.doesNotMatch(src, /i\s*%\s*2\s*===\s*1/);
  });

  it("masonry render branch still uses styles.masonryGrid / masonryCol", () => {
    const src = readSrc();
    // The migration is purely about WHERE the round-robin runs, not the
    // visual styling — pin the style wrappers so the helper swap can't
    // accidentally drop the two-column flex layout.
    assert.match(src, /styles\.masonryGrid/);
    assert.match(src, /styles\.masonryCol\b/);
    assert.match(src, /styles\.masonryColOffset/);
  });
});
