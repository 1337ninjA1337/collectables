import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const src = readFileSync(path.join(ROOT, "components/empty-state.tsx"), "utf8");

describe("EmptyState tone prop", () => {
  it("exports the EmptyStateTone union with exactly the three tones", () => {
    assert.match(
      src,
      /export type EmptyStateTone = "neutral" \| "premium" \| "danger";/,
    );
  });

  it("maps each tone to its token pair (MUTED_4 / AMBER_ACCENT / DANGER_DEEP_2)", () => {
    assert.match(src, /neutral:\s*\{\s*borderColor:\s*MUTED_4,\s*actionBg:\s*MUTED_4\s*\}/);
    assert.match(src, /premium:\s*\{\s*borderColor:\s*AMBER_ACCENT,\s*actionBg:\s*AMBER_ACCENT\s*\}/);
    assert.match(src, /danger:\s*\{\s*borderColor:\s*DANGER_DEEP_2,\s*actionBg:\s*DANGER_DEEP_2\s*\}/);
  });

  it("keeps the classic warm treatment when tone is unset", () => {
    // tone is optional and the override only applies when set…
    assert.match(src, /tone\?\:\s*EmptyStateTone;/);
    assert.match(src, /const toneStyle = tone \? TONE_STYLES\[tone\] : undefined;/);
    assert.match(src, /toneStyle && \{ borderColor: toneStyle\.borderColor \}/);
    assert.match(src, /toneStyle && \{ backgroundColor: toneStyle\.actionBg \}/);
    // …so the StyleSheet defaults every existing call site renders stay put.
    assert.match(src, /wrap:[\s\S]*?borderColor:\s*AMBER_SOFT_3/);
    assert.match(src, /action:[\s\S]*?backgroundColor:\s*AMBER_ACCENT/);
  });

  it("keeps the dashed border across tones (tone swaps color only)", () => {
    assert.match(src, /borderStyle:\s*"dashed"/);
    assert.doesNotMatch(src, /toneStyle[\s\S]{0,80}?borderStyle/);
  });
});
