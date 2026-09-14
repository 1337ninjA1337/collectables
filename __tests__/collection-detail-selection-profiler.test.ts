import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { walkJsx } from "@/lib/jsx-open-tag";

import { readRepoFile } from "./helpers/repo-file";

/**
 * __DEV__-only Profiler telemetry pins for the selection-mode FlatList:
 * VM-F's structural tests pin the memoization *shape* but nothing measures
 * the actual perf win. The Profiler wrapper logs per-commit actualDuration
 * to Metro so an accidentally re-introduced unmemoized renderItem surfaces
 * immediately in dev. The logging must stay double-gated: `__DEV__` (dead-
 * code-eliminated from prod bundles) and `selectedIds.size > 0` (quiet
 * while just browsing).
 */
function readCollectionSrc(): string {
  return readRepoFile("app/collection/[id].tsx");
}

describe("selection-mode FlatList Profiler telemetry", () => {
  it("imports Profiler and ProfilerOnRenderCallback from react", () => {
    const src = readCollectionSrc();
    assert.match(src, /import\s*\{[^}]*\bProfiler\b[^}]*\}\s*from\s*"react"/);
    assert.match(src, /type\s+ProfilerOnRenderCallback/);
  });

  it("declares onSelectionProfilerRender as a useCallback double-gated on __DEV__ and selection size", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /const\s+onSelectionProfilerRender\s*=\s*useCallback(?:<[^>]+>)?\(\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*,?\s*\)/,
    );
    assert.ok(m, "onSelectionProfilerRender useCallback not found");
    const body = m[1];
    assert.match(body, /__DEV__\s*&&\s*selectedIds\.size\s*>\s*0/, "log must be gated on __DEV__ && selectedIds.size > 0");
    assert.match(body, /actualDuration/, "log must include actualDuration");
    // Hoisted above the early returns like every other hook in this file.
    const declIdx = src.indexOf("const onSelectionProfilerRender");
    const earlyReturnIdx = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(declIdx !== -1 && earlyReturnIdx !== -1 && declIdx < earlyReturnIdx);
  });

  it("wraps the selection-mode FlatList in <Profiler id=\"selection-flatlist\">", () => {
    const src = readCollectionSrc();
    const m = src.match(
      /if\s*\(isOwner\s*&&\s*selectionMode\s*&&\s*allItems\.length\s*>\s*0\)\s*\{[\s\S]*?<\/Screen>\s*\)\s*;\s*\}/,
    );
    assert.ok(m, "selection-mode branch not found");
    const block = m[0];
    assert.match(block, /<Profiler\s+id="selection-flatlist"\s+onRender=\{\s*onSelectionProfilerRender\s*\}\s*>/);
    // The FlatList is the Profiler's immediate child, and the wrapper closes
    // inside the same ternary block. Read through `walkJsx` since
    // `lint:jsx-walk` landed: the `/<Profiler[^>]*>/` this used to be ends at
    // the first `>` in the tag, which here is the one inside
    // `onRender={onSelectionProfilerRender}`'s neighbours the day one arrives —
    // and the case above already asserts this tag has an expression prop.
    const profiler = [...walkJsx(block, { seed: null, inherit: () => null })].find(
      (tag) => tag.name === "Profiler",
    );
    assert.ok(profiler, "no <Profiler> in the selection-mode branch");
    assert.match(
      block.slice(profiler.tagEnd + 1),
      /^\s*<FlatList\b/,
      "Profiler must wrap the FlatList",
    );
    assert.match(block, /<\/Profiler>/);
  });
});
