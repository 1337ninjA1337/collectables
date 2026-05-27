import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { upsertListing } from "@/lib/marketplace-helpers";
import { MarketplaceListing, MarketplaceMode } from "@/lib/types";

/**
 * Guards the realtime cross-device sync for marketplace listings.
 *
 * The cloud wrapper subscribes to BOTH INSERT and UPDATE postgres-changes on
 * `marketplace_listings`, and the marketplace context upserts (not skip-if-
 * present) so a buyer claim on device A causes the listing to drop out of
 * device B's `activeListings` immediately rather than after a manual refresh.
 *
 * The realtime wrapper transitively imports React Native peers via
 * `@/lib/supabase`, so we mix structural (source-grep) checks for the
 * wrapper with a pure runtime test for the upsert reducer behaviour.
 */

const SUPABASE_MARKETPLACE_PATH = path.join(
  process.cwd(),
  "lib",
  "supabase-marketplace.ts",
);
const MARKETPLACE_CONTEXT_PATH = path.join(
  process.cwd(),
  "lib",
  "marketplace-context.tsx",
);

function readSrc(p: string): string {
  return readFileSync(p, "utf8");
}

function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-1",
    itemId: "item-1",
    ownerUserId: "alice",
    mode: "sell" as MarketplaceMode,
    askingPrice: 100,
    currency: "USD",
    notes: "",
    createdAt: "2026-05-01T10:00:00.000Z",
    soldAt: null,
    buyerUserId: null,
    ...overrides,
  };
}

describe("subscribeToListings — UPDATE event wiring (structural)", () => {
  const src = readSrc(SUPABASE_MARKETPLACE_PATH);

  it("registers an INSERT postgres-changes handler", () => {
    assert.match(
      src,
      /event:\s*REALTIME_POSTGRES_CHANGES_LISTEN_EVENT\.INSERT/,
      "subscribeToListings must still receive new listings",
    );
  });

  it("ALSO registers an UPDATE postgres-changes handler so buyer claims propagate", () => {
    assert.match(
      src,
      /event:\s*REALTIME_POSTGRES_CHANGES_LISTEN_EVENT\.UPDATE/,
      "subscribeToListings must add an UPDATE listener for buyerUserId/soldAt transitions",
    );
  });

  it("the UPDATE listener targets marketplace_listings without a sold_at filter", () => {
    // The INSERT branch filters to fresh rows (`sold_at=is.null`); the UPDATE
    // branch must NOT carry that filter, otherwise the very transition we
    // care about (sold_at becoming non-null) would be dropped server-side.
    const updateBlock = src.match(
      /UPDATE,\s*\n[\s\S]*?table:\s*"marketplace_listings",\s*\n\s*\}/,
    );
    assert.ok(updateBlock, "could not locate UPDATE config block");
    assert.doesNotMatch(
      updateBlock![0],
      /filter:\s*["']sold_at=is\.null["']/,
      "UPDATE listener must not carry the sold_at=is.null filter — that would drop the very transition we care about",
    );
  });

  it("uses a single shared channel topic for both event types", () => {
    // One channel with two .on() registrations is cheaper than two channels
    // and keeps subscribeShared ref-counting tractable.
    const topicMatches = src.match(/"marketplace-listings-[a-z]+"/g) ?? [];
    assert.equal(
      new Set(topicMatches).size,
      1,
      `expected exactly one topic name, found ${JSON.stringify(topicMatches)}`,
    );
  });

  it("both branches funnel through the same `emit(row)` fan-out", () => {
    // The UPDATE branch must reuse the same emit closure so consumers see one
    // logical stream; duplicating the rowToListing/captureException wrapper
    // would risk drift between INSERT and UPDATE handling.
    const emitCalls = src.match(/emit\(row\)/g) ?? [];
    assert.ok(
      emitCalls.length >= 2,
      `expected emit(row) in both INSERT and UPDATE branches, found ${emitCalls.length}`,
    );
  });
});

describe("MarketplaceProvider — upsert on realtime payload", () => {
  it("uses upsertListing inside the subscribeToListings callback", () => {
    const src = readSrc(MARKETPLACE_CONTEXT_PATH);
    // The legacy callback skipped when the listing was already present, so an
    // UPDATE that flips soldAt/buyerUserId never reached state. Replacing it
    // with upsertListing is the contract we want to lock in.
    assert.match(
      src,
      /subscribeToListings\(\(?[\s\S]*?upsertListing\(prev,\s*normalizeListing\(/,
      "the subscribeToListings callback must upsert (replace by id) so UPDATEs propagate",
    );
  });

  it("does not skip-on-present (the regression we just fixed)", () => {
    const src = readSrc(MARKETPLACE_CONTEXT_PATH);
    // The previous shape was `if (prev.some(...)) return prev` — re-adding
    // that branch would silently swallow every UPDATE payload.
    const callbackBlock = src.match(
      /subscribeToListings\(\([^)]*\)\s*=>\s*\{[\s\S]*?setListings\([\s\S]*?\}\);?/,
    );
    assert.ok(callbackBlock, "could not locate subscribeToListings callback");
    assert.doesNotMatch(
      callbackBlock![0],
      /\.some\(\(l\)\s*=>\s*l\.id\s*===\s*[^)]+\)\)\s*return\s+prev/,
      "the skip-if-present early return must stay gone — it would drop UPDATEs",
    );
  });
});

describe("upsertListing — runtime contract verification", () => {
  it("replaces a sold listing's row when an UPDATE-style payload arrives", () => {
    const before = listing({ id: "l-7", soldAt: null, buyerUserId: null });
    const after = listing({
      id: "l-7",
      soldAt: "2026-05-12T09:00:00.000Z",
      buyerUserId: "buyer-3",
    });
    const next = upsertListing([before], after);
    assert.equal(next.length, 1);
    assert.equal(next[0].soldAt, "2026-05-12T09:00:00.000Z");
    assert.equal(next[0].buyerUserId, "buyer-3");
  });

  it("appends an INSERT-style payload when the id is novel", () => {
    const existing = listing({ id: "l-7" });
    const fresh = listing({ id: "l-8" });
    const next = upsertListing([existing], fresh);
    assert.equal(next.length, 2);
    assert.deepEqual(next.map((l) => l.id).sort(), ["l-7", "l-8"]);
  });
});
