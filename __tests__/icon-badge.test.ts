import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  RING_INNER_SIZE,
  RING_MIDDLE_SIZE,
  RING_OUTER_SIZE,
} from "../lib/design-tokens";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("IconBadge — concentric-ring extraction", () => {
  const src = read("components/icon-badge.tsx");

  it("exports a named IconBadge component", () => {
    assert.match(src, /export function IconBadge\(/);
  });

  it("keeps the intentional 96 → 76 → 56 concentric step (20px per ring)", () => {
    assert.equal(RING_OUTER_SIZE, 96);
    assert.equal(RING_MIDDLE_SIZE, 76);
    assert.equal(RING_INNER_SIZE, 56);
    assert.equal(RING_OUTER_SIZE - RING_MIDDLE_SIZE, 20);
    assert.equal(RING_MIDDLE_SIZE - RING_INNER_SIZE, 20);
  });

  it("sizes every ring from the RING_* tokens, circles derived as size / 2", () => {
    for (const token of ["RING_OUTER_SIZE", "RING_MIDDLE_SIZE", "RING_INNER_SIZE"]) {
      assert.match(src, new RegExp(`width:\\s*${token}`));
      assert.match(src, new RegExp(`height:\\s*${token}`));
      assert.match(src, new RegExp(`borderRadius:\\s*${token} / 2`));
    }
    // No stray ring-size literals left behind in the StyleSheet.
    assert.doesNotMatch(src, /(?:width|height|borderRadius):\s*(?:96|76|56|48|38|28)\b/);
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
