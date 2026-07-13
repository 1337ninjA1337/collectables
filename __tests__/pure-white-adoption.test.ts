import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Files migrated off the quoted 3-digit shorthand ("#fff" → PURE_WHITE,
 * plus search-overlay's shadowColor "#000" → HERO_DARK per the SHADOW_SOFT
 * doc convention). The lint:hex short-pattern extension is the tree-wide
 * guard going forward; this per-file list pins the migration history so a
 * revert in any single file fails loudly with the file's name.
 */
const PURE_WHITE_FILES: ReadonlyArray<string> = [
  "app/collection/[id].tsx",
  "app/wishlist.tsx",
  "app/settings.tsx",
  "app/item/[id].tsx",
  "app/chats.tsx",
  "app/friends.tsx",
  "app/create.tsx",
  "components/item-card.tsx",
];

describe("PURE_WHITE adoption — migrated files", () => {
  for (const rel of PURE_WHITE_FILES) {
    describe(rel, () => {
      const src = read(rel);

      it("imports PURE_WHITE from lib/design-tokens", () => {
        assert.match(src, /from\s+"@\/lib\/design-tokens"/);
        assert.match(src, /\bPURE_WHITE\b/);
      });

      it("carries no quoted 3/4-digit hex shorthand", () => {
        assert.doesNotMatch(src, /(["'`])#[0-9a-fA-F]{3,4}\1/);
      });
    });
  }

  it("components/search-overlay.tsx routes its shadow through HERO_DARK", () => {
    const src = read("components/search-overlay.tsx");
    assert.match(src, /shadowColor:\s*HERO_DARK\b/);
    assert.doesNotMatch(src, /(["'`])#[0-9a-fA-F]{3,4}\1/);
  });
});
