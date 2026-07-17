import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("IconBadge — concentric-ring extraction", () => {
  const src = read("components/icon-badge.tsx");

  it("exports a named IconBadge component", () => {
    assert.match(src, /export function IconBadge\(/);
  });

  it("keeps the intentional 96 → 76 → 56 concentric step (20px per ring)", () => {
    const sizes = [...src.matchAll(/width:\s*(\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(sizes, [96, 76, 56]);
    // Perfect circles: each borderRadius is half its ring's size.
    const radii = [...src.matchAll(/borderRadius:\s*(\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(radii, [48, 38, 28]);
  });

  it("renders the cream-to-amber gradient outer → middle → inner", () => {
    assert.match(src, /outer:[\s\S]*?backgroundColor:\s*CARD_BG_2/);
    assert.match(src, /middle:[\s\S]*?backgroundColor:\s*CARD_BG_3/);
    assert.match(src, /inner:[\s\S]*?backgroundColor:\s*CARD_BG_14/);
  });

  it("forwards a style prop onto the outermost ring only", () => {
    assert.match(src, /style\?\:\s*StyleProp<ViewStyle>/);
    assert.match(src, /<View style=\{\[styles\.outer, style\]\}>/);
  });

  it("EmptyState adopts <IconBadge> and drops its private ring styles", () => {
    const empty = read("components/empty-state.tsx");
    assert.match(empty, /from\s+"@\/components\/icon-badge"/);
    assert.match(empty, /<IconBadge icon=\{icon\} style=\{styles\.iconBadge\} \/>/);
    for (const gone of ["iconOuter", "iconMiddle", "iconInner"]) {
      assert.doesNotMatch(
        empty,
        new RegExp(gone),
        `${gone} must live in icon-badge.tsx now`,
      );
    }
    // The caller-side spacing the old iconOuter carried stays with the caller.
    assert.match(empty, /iconBadge:\s*\{\s*marginBottom:\s*4,?\s*\}/);
  });
});
