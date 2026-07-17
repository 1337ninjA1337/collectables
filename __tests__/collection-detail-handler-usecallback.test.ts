import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Handler-stack useCallback promotion pins: the five selection-mode
 * handlers (`enterSelectionMode`, `exitSelectionMode`, `performBulkDelete`,
 * `handleBulkDelete`, `handleOpenMove`) follow `toggleSelect`'s pattern —
 * `useCallback`s hoisted ABOVE the component's early returns (hooks must
 * run unconditionally), handing the bulk-bar buttons and header select chip
 * referentially stable callbacks.
 *
 * Two hazards this file guards:
 *   1. A handler reverting to a plain `function` re-allocates every render
 *      and silently defeats downstream memoization.
 *   2. A handler migrating BELOW the early returns turns the hook
 *      conditional — a Rules-of-Hooks violation React only surfaces at
 *      runtime when the loading/not-found branch flips.
 */
function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

const HANDLERS = [
  "enterSelectionMode",
  "exitSelectionMode",
  "performBulkDelete",
  "handleBulkDelete",
  "handleOpenMove",
] as const;

describe("collection detail — handler-stack useCallback promotion", () => {
  it("declares each selection-mode handler as a useCallback (no plain function form)", () => {
    const src = readCollectionSrc();
    for (const name of HANDLERS) {
      assert.match(
        src,
        new RegExp(`const\\s+${name}\\s*=\\s*useCallback\\s*\\(`),
        `${name} must be a useCallback`,
      );
      assert.doesNotMatch(
        src,
        new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`),
        `${name} must not also exist as a plain function declaration`,
      );
    }
  });

  it("hoists every handler (and otherOwnedCollections) above the early returns", () => {
    const src = readCollectionSrc();
    // The first early return is the loading-skeleton branch — every hook
    // must be declared before it.
    const earlyReturnIdx = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(earlyReturnIdx !== -1, "loading early-return sentinel not found");
    for (const name of HANDLERS) {
      const declIdx = src.indexOf(`const ${name} = useCallback`);
      assert.ok(
        declIdx !== -1 && declIdx < earlyReturnIdx,
        `${name} must be declared before the early returns`,
      );
    }
    const memoIdx = src.indexOf("const otherOwnedCollections = useMemo");
    assert.ok(
      memoIdx !== -1 && memoIdx < earlyReturnIdx,
      "otherOwnedCollections must be a useMemo declared before the early returns",
    );
  });

  it("otherOwnedCollections excludes via the nullable collection?.id (not activeCollection)", () => {
    const src = readCollectionSrc();
    // Above the early returns `collection` is still nullable — reaching for
    // `activeCollection` up there would be a TS error at best and a crash
    // at worst if the narrowing ever loosened.
    assert.match(
      src,
      /const\s+otherOwnedCollections\s*=\s*useMemo\(\s*\(\)\s*=>\s*collections\.filter\([\s\S]{0,120}?c\.id\s*!==\s*collection\?\.id/,
    );
  });

  it("performBulkDelete and handleBulkDelete keep honest deps", () => {
    const src = readCollectionSrc();
    const grab = (name: string): string => {
      const m = src.match(
        new RegExp(`const\\s+${name}\\s*=\\s*useCallback\\([\\s\\S]*?\\},\\s*\\[([^\\]]*)\\]\\s*\\)`),
      );
      assert.ok(m, `${name} useCallback with dep array not found`);
      return m![1].replace(/\s+/g, "");
    };
    const bulkDeps = grab("performBulkDelete");
    for (const dep of ["selectedIds", "deleteItems", "exitSelectionMode"]) {
      assert.ok(bulkDeps.includes(dep), `performBulkDelete deps must include ${dep}, got "${bulkDeps}"`);
    }
    const confirmDeps = grab("handleBulkDelete");
    for (const dep of ["selectedIds", "performBulkDelete"]) {
      assert.ok(confirmDeps.includes(dep), `handleBulkDelete deps must include ${dep}, got "${confirmDeps}"`);
    }
    const openMoveDeps = grab("handleOpenMove");
    for (const dep of ["selectedIds", "otherOwnedCollections"]) {
      assert.ok(openMoveDeps.includes(dep), `handleOpenMove deps must include ${dep}, got "${openMoveDeps}"`);
    }
  });
});
