import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Files migrated off the inline `borderRadius: 999` literal onto RADIUS_PILL.
 * Extend this list batch by batch (see the RADIUS_PILL batches in
 * .tasks/.tasks.md); once all five batches land, the lint:radius scanner
 * takes over as the tree-wide guard and this per-file list pins the history.
 */
const MIGRATED_FILES = [
  // batch 1/5
  "app/settings.tsx",
  "app/item/[id].tsx",
  // batch 2/5
  "app/wishlist.tsx",
  "app/profile/[id].tsx",
  // batch 3/5
  "app/index.tsx",
  "app/marketplace.tsx",
  // app/collection/[id].tsx left the registry with the HM-C2/C3 modal
  // extractions — its last RADIUS_PILL consumers (share buttons, visibility
  // chips) moved into these components; lint:radius still guards the page.
  "components/collection-share-sheet.tsx",
  "components/edit-collection-modal.tsx",
  // batch 4/5 — app/ now greps clean for `borderRadius: 999`
  "app/people.tsx",
  "app/listing/[id].tsx",
  "app/_layout.tsx",
  "app/friends.tsx",
  "app/create.tsx",
  "app/create-collection.tsx",
  "app/chat/[id].tsx",
  // batch 5/5 — the whole tree now greps clean for `borderRadius: 999`
  "components/item-filters.tsx",
  "components/search-overlay.tsx",
  "components/item-card.tsx",
  "components/visibility-badge.tsx",
  "components/sync-status-pill.tsx",
  "components/swipe-tabs.tsx",
  "components/realtime-status-pill.tsx",
  "components/reaction-bar.tsx",
  "components/empty-state.tsx",
  "components/currency-input.tsx",
] as const;

describe("RADIUS_PILL adoption — migrated files", () => {
  for (const rel of MIGRATED_FILES) {
    describe(rel, () => {
      const src = read(rel);

      it("imports RADIUS_PILL from lib/design-tokens", () => {
        assert.match(src, /from\s+"@\/lib\/design-tokens"/);
        assert.match(src, /\bRADIUS_PILL\b/);
      });

      it("has no inline borderRadius: 999 literals left", () => {
        const leftovers = src.match(/borderRadius:\s*999\b/g) ?? [];
        assert.deepEqual(
          leftovers,
          [],
          `${rel} still has ${leftovers.length} inline pill radii — use RADIUS_PILL`,
        );
      });

      it("actually uses the token (import isn't dead)", () => {
        assert.match(src, /borderRadius:\s*RADIUS_PILL\b/);
      });
    });
  }
});
