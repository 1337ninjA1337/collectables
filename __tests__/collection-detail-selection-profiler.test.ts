import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
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
      /isOwner\s*&&\s*selectionMode\s*\?\s*\(\s*\n?[\s\S]*?\n\s*\)\s*:\s*null\s*\}/,
    );
    assert.ok(m, "selection-mode block not found");
    const block = m[0];
    assert.match(block, /<Profiler\s+id="selection-flatlist"\s+onRender=\{\s*onSelectionProfilerRender\s*\}\s*>/);
    // The FlatList is the Profiler's immediate child, and the wrapper closes
    // inside the same ternary block. (String indexOf would false-positive on
    // the `<FlatList>` mention inside the VM-E comment, hence the regex.)
    assert.match(block, /<Profiler[^>]*>\s*<FlatList\b/, "Profiler must wrap the FlatList");
    assert.match(block, /<\/Profiler>/);
  });
});
