import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { CARD_BG_10, DANGER_DEEP_4, DANGER_SOFT_2 } from "@/lib/design-tokens";
import {
  SOFT_DESTRUCTIVE_FOREGROUND,
  SOFT_DESTRUCTIVE_SURFACE,
} from "@/lib/danger-surface";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * `<SoftDestructiveChip>` is the chip half of the "reversible destructive
 * action" treatment; `<DangerSection tone="soft">` is the block-button half.
 * They share three tokens and nothing else, so the split under test is:
 * colours centralised, geometry local. A future edit that pulls the padding
 * into the shared constant, or that re-inlines the colours into one of the two,
 * is what these assertions are here to stop.
 */

describe("SOFT_DESTRUCTIVE_SURFACE", () => {
  it("is the CARD_BG_10 / DANGER_SOFT_2 / DANGER_DEEP_4 trio and nothing else", () => {
    assert.deepEqual(SOFT_DESTRUCTIVE_SURFACE, {
      backgroundColor: CARD_BG_10,
      borderWidth: 1,
      borderColor: DANGER_SOFT_2,
    });
    assert.equal(SOFT_DESTRUCTIVE_FOREGROUND, DANGER_DEEP_4);
  });

  it("carries no geometry, so the two consumers keep their own sizes", () => {
    // The chip is a 12pt inline affordance and the soft button a 15pt block.
    // Folding padding or radius in here would silently resize one of them.
    for (const key of ["paddingHorizontal", "paddingVertical", "borderRadius", "gap"]) {
      assert.ok(
        !(key in SOFT_DESTRUCTIVE_SURFACE),
        `${key} belongs to the component, not the shared surface`,
      );
    }
  });
});

describe("<SoftDestructiveChip> component", () => {
  const src = read("components/soft-destructive-chip.tsx");

  it("spreads the shared surface rather than repeating the tokens", () => {
    assert.match(src, /chip: \{[\s\S]*?\.\.\.SOFT_DESTRUCTIVE_SURFACE,/);
    assert.match(src, /label: \{\s*color: SOFT_DESTRUCTIVE_FOREGROUND,/);
  });

  it("keeps the pill geometry the reset chip shipped with", () => {
    // Lifted verbatim from `resetChip` — this is a refactor, not a redesign.
    assert.match(src, /borderRadius: RADIUS_PILL,/);
    assert.match(src, /paddingHorizontal: 12,/);
    assert.match(src, /paddingVertical: 8,/);
    assert.match(src, /gap: 4,/);
    assert.match(src, /fontSize: 12,/);
    assert.match(src, /fontWeight: "700",/);
  });

  it("tints the icon with the foreground token, not a second literal", () => {
    assert.match(src, /<Ionicons name=\{icon\} size=\{14\} color=\{SOFT_DESTRUCTIVE_FOREGROUND\} \/>/);
  });

  it("defaults the icon to close-circle, which is what every caller wanted", () => {
    assert.match(src, /icon = "close-circle"/);
  });

  it("is announced as a button and falls back to its label for a11y", () => {
    // The reset chip shipped with no accessibilityLabel while the sort and
    // query chips beside it had one; centralising the chip closes that gap for
    // every future caller rather than one at a time.
    assert.match(src, /accessibilityRole="button"/);
    assert.match(src, /accessibilityLabel=\{accessibilityLabel \?\? label\}/);
  });

  it("is memoized, like the other chip-row components", () => {
    assert.match(src, /memo\(function SoftDestructiveChip/);
  });
});

describe("adoption", () => {
  it("components/item-filters.tsx renders the chip instead of its own recipe", () => {
    const src = read("components/item-filters.tsx");
    assert.match(src, /<SoftDestructiveChip label=\{t\("filterReset"\)\} onPress=\{reset\} \/>/);
    assert.doesNotMatch(src, /resetChip/, "the inline resetChip styles should be gone");
  });

  it("components/danger-section.tsx derives its soft tone from the shared surface", () => {
    const src = read("components/danger-section.tsx");
    assert.match(src, /\.\.\.SOFT_DESTRUCTIVE_SURFACE,/);
    assert.match(src, /color: SOFT_DESTRUCTIVE_FOREGROUND,/);
  });

  it("leaves one screen importing the trio directly, and it is a known exception", () => {
    // The point of the extraction: a component importing the pair straight
    // from the palette is one that should be reaching for a widget instead.
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    }
    const importers: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of walk(path.join(process.cwd(), dir))) {
        const source = readFileSync(file, "utf8");
        const importBlock = source.match(/import \{[\s\S]*?\} from "@\/lib\/design-tokens";/)?.[0] ?? "";
        if (/\bCARD_BG_10\b/.test(importBlock) && /\bDANGER_SOFT_2\b/.test(importBlock)) {
          importers.push(path.relative(process.cwd(), file));
        }
      }
    }
    // `app/collection/[id].tsx` is the one holdout: its delete button is the
    // block form at RADIUS_CARD rather than the pill both widgets use, so
    // adopting <DangerSection> there would round its corners. That is a design
    // decision, not a refactor, so it stays — filed as a suggestion instead.
    // Both widgets now go through `lib/danger-surface.ts`, so neither appears.
    assert.deepEqual(importers.sort(), ["app/collection/[id].tsx"]);
  });
});
