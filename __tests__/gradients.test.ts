import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { HERO_DARK, HERO_DARK_4, HERO_DARK_5 } from "@/lib/design-tokens";
import { HERO_DARK_GRADIENT, PHOTO_SCRIM_GRADIENT } from "@/lib/gradients";

/**
 * Pins for `lib/gradients.ts` — the shared `<LinearGradient>` recipes.
 *
 * Two duplicated recipes existed before this file: the dark hero banner
 * (home / settings / login, 3 copies) and the cover-photo scrim (collection
 * card / collection detail, 2 copies). Both were byte-identical everywhere,
 * which is what made them safe to hoist.
 *
 * The value-level tests below matter less than the ADOPTION tests: the whole
 * point is that no sixth site re-declares the recipe inline, and that is a
 * property of the repo, not of the constant.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(process.cwd(), rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const UI_FILES = ["app", "components"].flatMap(walk);

describe("lib/gradients.ts — HERO_DARK_GRADIENT", () => {
  it("keeps the three stops in dark → mid → light order", () => {
    assert.deepEqual(HERO_DARK_GRADIENT.colors, [HERO_DARK_4, HERO_DARK, HERO_DARK_5]);
  });

  it("carries the angle, not just the colours", () => {
    // This is the reason the export is a prop bundle rather than an array: a
    // copy that kept the colours and dropped start/end renders a visibly
    // different banner while still reading as correct in a diff.
    assert.deepEqual(HERO_DARK_GRADIENT.start, { x: 0.2, y: 0.6 });
    assert.deepEqual(HERO_DARK_GRADIENT.end, { x: 1, y: 0 });
  });

  it("satisfies the upstream 'at least two stops' contract", () => {
    assert.ok(HERO_DARK_GRADIENT.colors.length >= 2);
  });
});

describe("lib/gradients.ts — PHOTO_SCRIM_GRADIENT", () => {
  it("runs transparent-ish → dark so text at the bottom stays legible", () => {
    const [top, bottom] = PHOTO_SCRIM_GRADIENT.colors;
    const alpha = (c: string) => Number(c.match(/([\d.]+)\)$/)?.[1] ?? NaN);
    assert.ok(alpha(top) < alpha(bottom), `scrim must darken downward: ${top} → ${bottom}`);
  });

  it("declares no start/end, since the default top-to-bottom axis IS the recipe", () => {
    // Adding an angle here would silently re-aim every cover-photo scrim.
    assert.ok(!("start" in PHOTO_SCRIM_GRADIENT));
    assert.ok(!("end" in PHOTO_SCRIM_GRADIENT));
  });
});

describe("gradients — adoption across the UI", () => {
  it("no file re-declares the hero colour triplet inline", () => {
    const offenders = UI_FILES.filter((f) =>
      /colors=\{\[\s*HERO_DARK_4\s*,\s*HERO_DARK\s*,\s*HERO_DARK_5\s*\]\}/.test(read(f)),
    );
    assert.deepEqual(offenders, [], "these files should spread HERO_DARK_GRADIENT instead");
  });

  it("no file re-declares the cover-photo scrim inline", () => {
    const offenders = UI_FILES.filter((f) =>
      /colors=\{\[\s*"rgba\(34, 24, 17, 0\.08\)"/.test(read(f)),
    );
    assert.deepEqual(offenders, [], "these files should spread PHOTO_SCRIM_GRADIENT instead");
  });

  it("every <LinearGradient> in the repo either spreads a shared recipe or is genuinely one-off", () => {
    // The skeleton shimmer is the one legitimate local gradient — it is
    // animation chrome, not a surface, and its colours come from the
    // component's own highlight value.
    const ALLOWED_LOCAL = new Set(["components/skeleton.tsx"]);
    const inline: string[] = [];
    for (const file of UI_FILES) {
      const src = read(file);
      for (const m of src.matchAll(/<LinearGradient[\s\S]{0,400}?>/g)) {
        if (!/colors=\{/.test(m[0])) continue;
        if (!ALLOWED_LOCAL.has(file)) inline.push(file);
      }
    }
    assert.deepEqual(
      [...new Set(inline)],
      [],
      "a new inline gradient appeared — hoist it into lib/gradients.ts or allow-list it",
    );
  });

  it("the three hero screens all spread the shared bundle", () => {
    for (const file of ["app/index.tsx", "app/settings.tsx", "components/login-screen.tsx"]) {
      const src = read(file);
      assert.match(src, /import \{ HERO_DARK_GRADIENT \} from "@\/lib\/gradients";/, file);
      assert.match(src, /<LinearGradient \{\.\.\.HERO_DARK_GRADIENT\}/, file);
    }
  });

  it("both cover-photo surfaces spread the shared scrim", () => {
    for (const file of ["components/collection-card.tsx", "app/collection/[id].tsx"]) {
      const src = read(file);
      assert.match(src, /import \{ PHOTO_SCRIM_GRADIENT \} from "@\/lib\/gradients";/, file);
      assert.match(src, /<LinearGradient \{\.\.\.PHOTO_SCRIM_GRADIENT\}/, file);
    }
  });

  it("the hero screens no longer import the tokens that left with the recipe", () => {
    // A leftover HERO_DARK_4/_5 import is the tell that a second inline copy
    // is being reintroduced.
    for (const file of ["app/index.tsx", "app/settings.tsx", "components/login-screen.tsx"]) {
      const src = read(file);
      assert.doesNotMatch(src, /\bHERO_DARK_4\b/, `${file} still references HERO_DARK_4`);
      assert.doesNotMatch(src, /\bHERO_DARK_5\b/, `${file} still references HERO_DARK_5`);
    }
  });
});
