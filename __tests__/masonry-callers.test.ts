import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/env-inlining";

/**
 * Repo-wide masonry-caller sweep (the VM-A guardrail bullet): no screen or
 * component may re-introduce an inline modulo column split — the
 * `.filter((_, i) => i % 2 === N)` shape (or any subtle re-roll of it)
 * that `distributeIntoMasonryColumns` / FlatList `numColumns` replaced.
 * Mirrors the design-tokens hex-gate idea at test level: the per-file pin
 * in `collection-detail-flatlist-viewer.test.ts` covers the one historic
 * offender; this walk covers everywhere else the shape could land next.
 *
 * Sources are comment-stripped (shared `stripComments`) so prose like
 * "the old i % 2 split" can't false-positive.
 */
const ROOTS = ["app", "components"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) => walk(path.join(process.cwd(), root)));
}

describe("masonry callers — no inline modulo column split anywhere in app/ or components/", () => {
  it("walks a sane file set (scanner self-guard)", () => {
    // A broken walker returning [] would make the sweep pass vacuously.
    const files = sourceFiles();
    assert.ok(files.length >= 40, `expected >= 40 source files, walked ${files.length}`);
    assert.ok(files.some((f) => f.endsWith(path.join("collection", "[id].tsx"))));
  });

  it("no identifier-mod-2 in any screen or component", () => {
    // The column-split re-rolls all reduce to <identifier> % 2 (`i % 2
    // === 0`, `i % 2 !== 0`, `idx % 2 < 1`, …). Nothing in the tree mods
    // by 2 legitimately today; if something ever must, rewriting this pin
    // is the deliberate act the guard exists to force.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (/[A-Za-z_$][\w$]*\s*%\s*2\b/.test(src)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("no index-filter modulo split of ANY stride (.filter((_, i) => i % N ...))", () => {
    // Broader than mod-2: a 3- or 4-column re-roll (`i % 3 === 0`) is the
    // same bug wearing the responsive column counts. Column distribution
    // belongs to FlatList numColumns or lib/masonry's distributors.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (/\.filter\(\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w$]*\s*%\s*\d/.test(src)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(offenders, []);
  });
});
