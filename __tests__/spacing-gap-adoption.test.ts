import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Files migrated off the inline `gap: 10` / `gap: 12` / `gap: 8` literals
 * onto SPACING_LIST / SPACING_CARD / SPACING_INLINE. Extend this list batch
 * by batch (see the SPACING gap batches in .tasks/.tasks.md); once all six
 * batches land, the lint:radius scanner extension takes over as the
 * tree-wide guard and this per-file list pins the history.
 *
 * The `list` / `card` / `inline` flags record which gap values the file
 * actually had — the token-usage (dead-import) guards only run for tokens
 * the file adopted, mirroring radius-card-adoption's usesLg/cardless flags.
 */
const MIGRATED_FILES: ReadonlyArray<{
  rel: string;
  list: boolean;
  card: boolean;
  inline: boolean;
}> = [
  // batch 1/6
  { rel: "app/collection/[id].tsx", list: true, card: true, inline: true },
  { rel: "app/item/[id].tsx", list: true, card: true, inline: true },
  // batch 2/6
  { rel: "app/create.tsx", list: true, card: true, inline: true },
  { rel: "app/settings.tsx", list: true, card: true, inline: true },
  { rel: "app/index.tsx", list: true, card: true, inline: true },
  // batch 3/6
  { rel: "app/listing/[id].tsx", list: true, card: false, inline: true },
  { rel: "app/wishlist.tsx", list: true, card: true, inline: true },
  { rel: "app/profile/[id].tsx", list: true, card: true, inline: true },
  { rel: "app/chat/[id].tsx", list: true, card: true, inline: true },
  { rel: "app/chats.tsx", list: true, card: false, inline: true },
  { rel: "app/marketplace.tsx", list: true, card: true, inline: true },
];

const TOKEN_BY_GAP = [
  { flag: "list", literal: 10, token: "SPACING_LIST" },
  { flag: "card", literal: 12, token: "SPACING_CARD" },
  { flag: "inline", literal: 8, token: "SPACING_INLINE" },
] as const;

describe("SPACING gap adoption — migrated files", () => {
  for (const entry of MIGRATED_FILES) {
    describe(entry.rel, () => {
      const src = read(entry.rel);

      it("imports from lib/design-tokens", () => {
        assert.match(src, /from\s+"@\/lib\/design-tokens"/);
      });

      it("has no inline gap: 10 / 12 / 8 literals left", () => {
        const leftovers = src.match(/\bgap:\s*(?:10|12|8)\b/g) ?? [];
        assert.deepEqual(
          leftovers,
          [],
          `${entry.rel} still has ${leftovers.length} inline gap literals — use the SPACING_* tokens`,
        );
      });

      for (const { flag, token } of TOKEN_BY_GAP) {
        if (!entry[flag]) continue;
        it(`actually uses ${token} (import isn't dead)`, () => {
          assert.match(src, new RegExp(`\\bgap:\\s*${token}\\b`));
          assert.match(src, new RegExp(`\\b${token}\\b[\\s\\S]*?from\\s+"@/lib/design-tokens"`));
        });
      }
    });
  }
});
