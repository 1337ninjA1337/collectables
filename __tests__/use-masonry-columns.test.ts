import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for `lib/use-masonry-columns.ts`. The hook can't be
 * CALLED under `node --test` (useMemo requires a React render — no
 * mounting harness in this repo, see the [needs-dev-dep] tasks), so the
 * contract is pinned at the source level; the distribution math itself is
 * functionally covered by `masonry.test.ts`.
 */
function readHookSrc(): string {
  return readFileSync(path.join(process.cwd(), "lib", "use-masonry-columns.ts"), "utf8");
}

describe("lib/use-masonry-columns.ts — useMasonryColumns hook", () => {
  it("delegates to distributeIntoMasonryColumns inside a useMemo", () => {
    const src = readHookSrc();
    assert.match(src, /import\s*\{\s*useMemo\s*\}\s*from\s*"react"/);
    assert.match(src, /import\s*\{\s*distributeIntoMasonryColumns\s*\}\s*from\s*"\.\/masonry"/);
    assert.match(
      src,
      /return\s+useMemo\(\s*\(\)\s*=>\s*distributeIntoMasonryColumns\(items,\s*columnCount\)/,
      "the hook body must be a single useMemo over the pure distributor",
    );
  });

  it("dep array is exactly [items, columnCount] — the VM-B memoization contract", () => {
    const src = readHookSrc();
    // A wider dep (a source array, a filters object) would re-allocate the
    // columns on renders where the visible slice didn't change; a narrower
    // one would serve stale columns. Both directions are bugs.
    assert.match(src, /useMemo\([\s\S]*?,\s*\[\s*items\s*,\s*columnCount\s*\]\s*\)/);
  });

  it("columnCount defaults to 2, matching distributeIntoMasonryColumns' own default", () => {
    const src = readHookSrc();
    assert.match(src, /columnCount:\s*number\s*=\s*2/);
  });
});
