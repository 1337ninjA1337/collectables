import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Locks the seller-side "your listing was claimed" prompt:
 *
 *   1. `MarketplaceContext` exposes a `sellerNotifications` queue keyed off
 *      the realtime UPDATE diff (was unsold, now sold by someone else),
 *      plus a `dismissSellerNotification` helper.
 *   2. The `<SoldListingPrompt />` component is mounted once in the app
 *      shell after every provider it consumes (auth, collections, social,
 *      marketplace) so it can read state without re-rendering routes.
 *   3. The prompt's three CTAs map to `archiveItem`, `deleteItem`, and a
 *      pure dismiss — the seller must be able to either soft-archive the
 *      original (keep stats history) or hard-delete it from the collection.
 *   4. `CollectionsContext.archiveItem` exists and stamps `archivedAt`
 *      (not a hard delete).
 *
 * The provider's realtime callback transitively imports React Native
 * peers, so we use source-grep here rather than instantiating it.
 */

const MARKETPLACE_CONTEXT_PATH = path.join(
  process.cwd(),
  "lib",
  "marketplace-context.tsx",
);
const COLLECTIONS_CONTEXT_PATH = path.join(
  process.cwd(),
  "lib",
  "collections-context.tsx",
);
const SOLD_PROMPT_PATH = path.join(
  process.cwd(),
  "components",
  "sold-listing-prompt.tsx",
);
const APP_LAYOUT_PATH = path.join(process.cwd(), "app", "_layout.tsx");

function readSrc(p: string): string {
  return readFileSync(p, "utf8");
}

describe("MarketplaceContext — sellerNotifications queue", () => {
  const src = readSrc(MARKETPLACE_CONTEXT_PATH);

  it("declares a sellerNotifications state slot", () => {
    assert.match(
      src,
      /setSellerNotifications/,
      "context must expose a setSellerNotifications setter",
    );
    assert.match(
      src,
      /sellerNotifications:\s*string\[\]/,
      "the context value type must include sellerNotifications: string[]",
    );
  });

  it("declares a dismissSellerNotification helper", () => {
    assert.match(src, /dismissSellerNotification:\s*\(/);
    assert.match(src, /const dismissSellerNotification = useCallback/);
  });

  it("calls isListingClaimedFromOwner inside the realtime callback", () => {
    // The seller-side detection must live in the realtime path so prompts
    // fire when the buyer's claim arrives from another device.
    assert.match(src, /isListingClaimedFromOwner\(/);
  });

  it("queues by listing id without duplicating", () => {
    // Dedupe so a re-emit on the same row can't stack two prompts.
    assert.match(
      src,
      /setSellerNotifications\(\s*\(q\)\s*=>\s*\n?\s*q\.includes\([^)]+\)\s*\?\s*q\s*:/,
    );
  });
});

describe("CollectionsContext — archiveItem method", () => {
  const src = readSrc(COLLECTIONS_CONTEXT_PATH);

  it("exposes archiveItem on the context type", () => {
    assert.match(src, /archiveItem:\s*\(itemId:\s*string\)\s*=>\s*Promise<void>/);
  });

  it("archiveItem stamps `archivedAt` (no hard delete)", () => {
    // The whole point of "archive" vs "delete" is to keep the row in storage.
    const archiveBlock = src.match(/archiveItem:\s*async \(itemId\)\s*=>\s*\{[\s\S]*?\},/);
    assert.ok(archiveBlock, "could not locate archiveItem implementation");
    assert.match(archiveBlock![0], /archivedAt/);
    assert.doesNotMatch(
      archiveBlock![0],
      /current\.filter\(\(item\)\s*=>\s*item\.id\s*!==\s*itemId\)/,
      "archiveItem must NOT filter the item out of localItems — that would be a hard delete",
    );
  });

  it("getItemsForCollection skips archived items", () => {
    assert.match(
      src,
      /getItemsForCollection:[\s\S]{0,400}!item\.archivedAt/,
      "getItemsForCollection must filter archived rows",
    );
  });

  it("getCollectionTotalCost skips archived items", () => {
    const block = src.match(
      /getCollectionTotalCost:\s*\(collectionId\)\s*=>\s*\{[\s\S]*?^\s{6}\}/m,
    );
    assert.ok(block, "could not locate getCollectionTotalCost implementation");
    assert.match(
      block![0],
      /!item\.archivedAt/,
      "getCollectionTotalCost must filter archived rows so totals reflect the live collection",
    );
  });
});

describe("SoldListingPrompt — component wiring", () => {
  const src = readSrc(SOLD_PROMPT_PATH);

  it("consumes the marketplace seller-notifications queue", () => {
    assert.match(src, /sellerNotifications/);
    assert.match(src, /dismissSellerNotification/);
  });

  it("wires Archive → archiveItem", () => {
    assert.match(
      src,
      /archiveItem\(/,
      "Archive CTA must call collectionsContext.archiveItem",
    );
  });

  it("wires Delete → deleteItem (after a confirm dialog)", () => {
    assert.match(src, /deleteItem\(/);
    assert.match(src, /confirmDialog\(/);
  });

  it("dismisses on each terminal action (archive/delete/keep)", () => {
    const dismissCalls = src.match(/dismissSellerNotification\(/g) ?? [];
    // 3 explicit handlers + 1 cleanup fallback when the listing vanishes
    assert.ok(
      dismissCalls.length >= 3,
      `expected ≥3 dismiss calls, found ${dismissCalls.length}`,
    );
  });

  it("only renders the head of the queue (one modal at a time)", () => {
    assert.match(
      src,
      /sellerNotifications\[0\]/,
      "head-of-queue rendering keeps stacked prompts impossible",
    );
  });
});

describe("App shell — SoldListingPrompt is mounted once", () => {
  const src = readSrc(APP_LAYOUT_PATH);

  it("imports SoldListingPrompt", () => {
    assert.match(src, /from\s+"@\/components\/sold-listing-prompt"/);
  });

  it("renders <SoldListingPrompt /> inside the shell", () => {
    assert.match(src, /<SoldListingPrompt\s*\/>/);
  });
});
