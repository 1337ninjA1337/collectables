import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Files migrated off the inline `borderRadius: 22` / `borderRadius: 24`
 * literals onto RADIUS_CARD / RADIUS_CARD_LG. Extend this list batch by
 * batch (see the RADIUS_CARD batches in .tasks/.tasks.md); once all four
 * batches land, the lint:radius scanner extension takes over as the
 * tree-wide guard and this per-file list pins the history.
 *
 * `usesLg` records whether the file had any 24s — the dead-import guard
 * only checks RADIUS_CARD_LG usage where the token was actually adopted.
 */
const MIGRATED_FILES: ReadonlyArray<{ rel: string; usesLg: boolean }> = [
  // batch A/4
  { rel: "app/collection/[id].tsx", usesLg: false },
  { rel: "app/item/[id].tsx", usesLg: true },
];

describe("RADIUS_CARD adoption — migrated files", () => {
  for (const { rel, usesLg } of MIGRATED_FILES) {
    describe(rel, () => {
      const src = read(rel);

      it("imports the card radius tokens from lib/design-tokens", () => {
        assert.match(src, /from\s+"@\/lib\/design-tokens"/);
        assert.match(src, /\bRADIUS_CARD\b/);
        if (usesLg) assert.match(src, /\bRADIUS_CARD_LG\b/);
      });

      it("has no inline borderRadius: 22 / 24 literals left", () => {
        const leftovers = src.match(/borderRadius:\s*2[24]\b/g) ?? [];
        assert.deepEqual(
          leftovers,
          [],
          `${rel} still has ${leftovers.length} inline card radii — use RADIUS_CARD / RADIUS_CARD_LG`,
        );
      });

      it("actually uses the token(s) (imports aren't dead)", () => {
        assert.match(src, /borderRadius:\s*RADIUS_CARD\b/);
        if (usesLg) assert.match(src, /borderRadius:\s*RADIUS_CARD_LG\b/);
      });
    });
  }
});
